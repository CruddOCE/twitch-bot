// Polls Twitch for the four channel stats the control panel shows: live
// viewers, people present in chat, total followers and active subscribers.
//
// One shared layer rather than one timer per stat, and deliberately not
// wired straight into the /status request handler. The panel reads /status
// every 5 seconds, so answering each of those with live Helix calls would
// be roughly 17 requests a minute per endpoint from a single open window.
// The cache below decouples the two cadences: the panel reads as often as
// it likes, Twitch is asked once a minute.
//
// Every call here uses the broadcaster's own user token. Followers,
// subscriptions and chatters are all scoped reads that an app token cannot
// make, and the token was authorised with all three on 2026-08-09.

const logger = require('./logger');

const REFRESH_MS = 60000;

// A revoked token or a Twitch outage should not cost a request a minute
// for as long as the bot is up, so failures back off to one every ten
// minutes and snap back to normal on the first success.
const MAX_BACKOFF_MS = 600000;

let timer = null;
let broadcasterId = null;
let currentDelayMs = REFRESH_MS;
let snapshot = emptySnapshot();

function emptySnapshot() {
  return {
    live: false,
    viewers: null,
    chatters: null,
    followers: null,
    subscribers: null,
    updatedAt: null,
    error: null,
  };
}

// Returns whether polling actually started, so a caller (and the test)
// can tell "running" apart from "declined for want of credentials".
function start() {
  if (timer) return true;

  // An install that has not been through setup has neither of these, and
  // the right behaviour there is blank readouts rather than a log full of
  // failures. This is also what keeps the offline test suite from
  // reaching for the network when it starts the alert server.
  const channel = process.env.TWITCH_CHANNEL;
  const token = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/, '');
  if (!channel || !token) return false;

  schedule(0);
  return true;
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  currentDelayMs = REFRESH_MS;
}

// Returned by value so a caller holding the object cannot edit the cache
// underneath the next refresh.
function getSnapshot() {
  return Object.assign({}, snapshot);
}

// A setTimeout chain rather than setInterval, because the gap changes when
// the backoff kicks in. unref() so this alone can never hold the process
// open.
function schedule(delayMs) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(runRefresh, delayMs);
  timer.unref();
}

async function runRefresh() {
  const succeeded = await refresh();
  currentDelayMs = nextDelayMs(currentDelayMs, succeeded);
  schedule(currentDelayMs);
}

// Pure, and exported, so the escalation can be tested without sitting
// through ten minutes of real waiting.
function nextDelayMs(currentMs, succeeded) {
  if (succeeded) return REFRESH_MS;
  return Math.min(currentMs * 2, MAX_BACKOFF_MS);
}

async function refresh() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const token = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/, '');
  const channel = process.env.TWITCH_CHANNEL;
  if (!clientId || !token || !channel) return false;

  const headers = { 'Client-Id': clientId, Authorization: `Bearer ${token}` };

  try {
    if (!broadcasterId) broadcasterId = await fetchBroadcasterId(channel, headers);
  } catch (err) {
    snapshot.error = errorKind(err);
    logger.action('channel-stats', `Could not resolve the channel ID: ${err.message}`, false);
    return false;
  }

  // allSettled, not all: one endpoint failing (a scope revoked, a single
  // 500 from Twitch) must not blank the three that answered.
  const results = await Promise.allSettled([
    fetchStream(channel, headers),
    fetchTotal(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=1`, headers),
    fetchTotal(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}&first=1`, headers),
    fetchTotal(`https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}&first=1`, headers),
  ]);

  const [stream, followers, subscribers, chatters] = results;
  const failures = results.filter((r) => r.status === 'rejected');

  if (stream.status === 'fulfilled') {
    snapshot.live = stream.value.live;
    // Not zero when offline. Helix returns an empty array for a channel
    // that is not live, so there is no viewer count to read, and
    // rendering that as 0 would be a lie that looks like a measurement.
    snapshot.viewers = stream.value.live ? stream.value.viewers : null;
  }

  // A rejected call keeps whatever was last known rather than dropping to
  // a dash, so a single blip does not blink the readout.
  snapshot.followers = settled(followers, snapshot.followers);
  snapshot.subscribers = settled(subscribers, snapshot.subscribers);
  snapshot.chatters = settled(chatters, snapshot.chatters);

  if (failures.length === 0) {
    snapshot.error = null;
    snapshot.updatedAt = new Date().toISOString();
    return true;
  }

  snapshot.error = errorKind(failures[0].reason);
  logger.action(
    'channel-stats',
    `${failures.length} of 4 stat lookups failed: ${failures.map((f) => f.reason.message).join('; ')}`,
    false
  );
  return false;
}

function settled(result, previous) {
  return result.status === 'fulfilled' ? result.value : previous;
}

// The panel shows a different word for each of these, because they need
// different things from the user: 'auth' means press Reconnect, anything
// else means wait.
function errorKind(err) {
  if (err && err.status === 401) return 'auth';
  if (err && err.status === 429) return 'ratelimit';
  return 'unavailable';
}

async function fetchBroadcasterId(channel, headers) {
  const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, { headers });
  if (!res.ok) throw helixError(`Could not look up channel "${channel}"`, res.status);
  const data = await res.json();
  const id = data.data && data.data[0] && data.data[0].id;
  if (!id) throw helixError(`Unknown channel "${channel}"`, res.status);
  return id;
}

async function fetchStream(channel, headers) {
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, { headers });
  if (!res.ok) throw helixError('Get Streams failed', res.status);
  const data = await res.json();
  const stream = data.data && data.data[0];
  if (!stream) return { live: false, viewers: null };
  return { live: true, viewers: Number(stream.viewer_count) };
}

// Follows, subs and chatters all answer the same shape: the paged list
// carries a `total` that is the whole count, so `first=1` asks Twitch for
// one row and reads the number off the envelope instead of paging through
// thousands of names to count them.
async function fetchTotal(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw helixError(`${url.split('?')[0].split('/helix/')[1]} failed`, res.status);
  const data = await res.json();
  if (typeof data.total !== 'number') throw helixError('Twitch returned no total', res.status);
  return data.total;
}

function helixError(message, status) {
  const err = new Error(`${message} (${status})`);
  err.status = status;
  return err;
}

module.exports = { start, stop, getSnapshot, refresh, nextDelayMs, REFRESH_MS, MAX_BACKOFF_MS };
