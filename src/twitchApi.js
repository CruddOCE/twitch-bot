// Minimal Twitch Helix client for public channel lookups (used by !so).
// Uses an app access token via the client-credentials grant, which only
// needs a Client ID + Client Secret, with no per-user login required.

let appToken = null;
let tokenExpiry = 0;
let tokenPromise = null;

async function fetchAppToken(clientId, clientSecret) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    throw new Error(`Twitch app token request failed: ${res.status}`);
  }

  const data = await res.json();
  appToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return appToken;
}

async function getAppToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (appToken && Date.now() < tokenExpiry) return appToken;

  // Cache the in-flight request itself, not just the resolved token --
  // otherwise two !so calls landing close together (before the first
  // fetch resolves) would both see no valid token yet and each fire a
  // redundant request to Twitch's token endpoint.
  if (!tokenPromise) {
    tokenPromise = fetchAppToken(clientId, clientSecret).finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

// Returns { displayName, login, game } or null if unavailable (missing
// credentials, unknown user, API error).
async function getChannelInfo(username) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const token = await getAppToken().catch((err) => {
    console.error('[twitchApi]', err.message);
    return null;
  });
  if (!token || !clientId) return null;

  const headers = { 'Client-Id': clientId, Authorization: `Bearer ${token}` };

  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, { headers });
  if (!userRes.ok) return null;
  const userData = await userRes.json();
  const user = userData.data && userData.data[0];
  if (!user) return null;

  const channelRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${user.id}`, { headers });
  const channelData = channelRes.ok ? await channelRes.json() : null;
  const channel = channelData && channelData.data && channelData.data[0];

  return {
    displayName: user.display_name,
    login: user.login,
    game: channel ? channel.game_name : null,
  };
}

// Reads the channel's current title and category.
//
// Separate from getChannelInfo above, which serves !so: that one returns a
// different shape, has no title in it, and gives up silently when there is no
// client secret, which is the right call for a chat command and the wrong one
// here. The control panel prefills its edit fields from this, and a field that
// silently arrives empty is worse than an error, because submitting it would
// read as "clear the title".
//
// Throws rather than returning null, so the caller can say why it failed.
// Kept self-contained rather than sharing a broadcaster-ID helper with
// updateChannelInfo below: that function is confirmed working against the live
// API and is not worth disturbing to save six lines.
async function getChannelSettings(broadcasterLogin) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const userToken = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/, '');
  if (!clientId || !userToken) {
    throw new Error('Missing TWITCH_CLIENT_ID / TWITCH_OAUTH_TOKEN.');
  }
  if (!broadcasterLogin) {
    throw new Error('No channel given.');
  }

  // Both calls below are public reads, so the app token is preferred but the
  // user token works just as well -- which is what makes this usable without
  // a client secret configured.
  const readToken = (await getAppToken().catch(() => null)) || userToken;
  const headers = { 'Client-Id': clientId, Authorization: `Bearer ${readToken}` };

  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(broadcasterLogin)}`, {
    headers,
  });
  if (!userRes.ok) throw new Error(`Could not look up channel "${broadcasterLogin}" (${userRes.status}).`);
  const userData = await userRes.json();
  const broadcasterId = userData.data && userData.data[0] && userData.data[0].id;
  if (!broadcasterId) throw new Error(`Unknown channel "${broadcasterLogin}".`);

  const channelRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, { headers });
  if (!channelRes.ok) throw new Error(`Could not read channel information (${channelRes.status}).`);
  const channelData = await channelRes.json();
  const channel = channelData.data && channelData.data[0];
  if (!channel) throw new Error('Twitch returned no channel information.');

  return { title: channel.title || '', gameName: channel.game_name || '' };
}

// Updates the channel's title and/or category via Helix's "Modify Channel
// Information" endpoint. Twitch only allows a channel's own user token to
// change its info, so this only works when TWITCH_OAUTH_TOKEN belongs to
// the broadcaster's own account (i.e. TWITCH_BOT_USERNAME === the channel)
// and was issued with the channel:manage:broadcast scope -- re-run
// `npm run twitch-auth` after this scope was added if the token predates it.
async function updateChannelInfo(broadcasterLogin, { title, gameName } = {}) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const userToken = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/, '');
  if (!clientId || !userToken) {
    throw new Error('Missing TWITCH_CLIENT_ID / TWITCH_OAUTH_TOKEN.');
  }

  // Reading the broadcaster's ID and looking up a game by name are public
  // lookups -- the app token (or the user token, either works) is fine for
  // these; only the actual PATCH below requires the scoped user token.
  const readToken = (await getAppToken().catch(() => null)) || userToken;
  const readHeaders = { 'Client-Id': clientId, Authorization: `Bearer ${readToken}` };

  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(broadcasterLogin)}`, {
    headers: readHeaders,
  });
  if (!userRes.ok) throw new Error(`Could not look up channel "${broadcasterLogin}" (${userRes.status}).`);
  const userData = await userRes.json();
  const broadcasterId = userData.data && userData.data[0] && userData.data[0].id;
  if (!broadcasterId) throw new Error(`Unknown channel "${broadcasterLogin}".`);

  const body = {};
  if (title) body.title = title;
  if (gameName) {
    const gameRes = await fetch(`https://api.twitch.tv/helix/games?name=${encodeURIComponent(gameName)}`, {
      headers: readHeaders,
    });
    const gameData = gameRes.ok ? await gameRes.json() : null;
    const game = gameData && gameData.data && gameData.data[0];
    if (!game) throw new Error(`Could not find a game/category named "${gameName}".`);
    body.game_id = game.id;
  }

  const patchRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
    method: 'PATCH',
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!patchRes.ok) {
    const errBody = await patchRes.text().catch(() => '');
    throw new Error(`Twitch rejected the update (${patchRes.status}): ${errBody || 'no details'}`);
  }
}

module.exports = { getChannelInfo, getChannelSettings, updateChannelInfo };
