// Offline smoke test: exercises config loading, commands, and the
// moderation engine without needing any real Twitch credentials or
// network access. Run with: npm test

process.env.BOT_PREFIX = '!';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

// Point the config store at a scratch copy so this test never touches
// the real config/ files.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-test-'));
fs.mkdirSync(path.join(scratchDir, 'config'));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'commands.json'), path.join(scratchDir, 'config', 'commands.json'));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'jokes.json'), path.join(scratchDir, 'config', 'jokes.json'));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'alerts.json'), path.join(scratchDir, 'config', 'alerts.json'));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'cooldowns.json'), path.join(scratchDir, 'config', 'cooldowns.json'));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'timers.json'), path.join(scratchDir, 'config', 'timers.json'));
fs.writeFileSync(
  path.join(scratchDir, 'config', 'moderation.json'),
  JSON.stringify({
    enabled: true,
    bannedWords: ['badword'],
    linkFilter: { enabled: true, action: 'delete', allowlist: ['clips.twitch.tv'] },
    capsFilter: { enabled: true, minLength: 10, maxCapsRatio: 0.7, action: 'warn' },
    spamFilter: { enabled: true, repeatedMessageThreshold: 3, windowSeconds: 30, action: 'timeout', timeoutSeconds: 60 },
    warnBeforeTimeout: true,
    maxWarnings: 2,
    escalatedTimeoutSeconds: 300,
  })
);

process.env.TWITCH_BOT_CONFIG_DIR = path.join(scratchDir, 'config');
const configStore = require('../src/configStore');
configStore.init();

const commands = require('../src/commands');
const moderation = require('../src/moderation');
const state = require('../src/state');

// The batch installer previously broke because it had Unix-style LF-only
// line endings, which cmd.exe's parser handles unreliably (it silently
// fragments and misexecutes parts of the script, especially around CALLing
// other batch files like npm.cmd). Catch that regression here instead of
// discovering it by double-clicking a broken installer.
function checkBatchFileLineEndings() {
  const binDir = path.join(__dirname, '..', 'bin');
  const batFiles = fs.readdirSync(binDir).filter((f) => f.endsWith('.bat'));
  assert.ok(batFiles.length > 0, 'expected at least one .bat file to check');
  for (const file of batFiles) {
    const text = fs.readFileSync(path.join(binDir, file), 'utf8');
    const hasLoneLF = /(?<!\r)\n/.test(text);
    assert.ok(!hasLoneLF, `${file} has LF-only line endings somewhere; must be CRLF throughout for cmd.exe to parse it reliably`);
  }
  console.log(`batch file line endings (${batFiles.join(', ')}): ok`);
}

// Mute is remote-controlled over HTTP by the control panel, so the thing
// worth testing is the endpoint and the state it leaves behind, not the
// flag on its own. Runs on the isolated test port so it can never collide
// with a real bot running on 8090.
async function checkMuteAlerts() {
  const http = require('http');
  const alertServer = require('../src/alertServer');

  const port = Number(process.env.ALERT_SERVER_PORT) || 8091;
  process.env.ALERT_SERVER_PORT = String(port);
  const server = alertServer.start();
  await new Promise((resolve) => server.once('listening', resolve));

  function get(urlPath) {
    return new Promise((resolve, reject) => {
      http
        .get(`http://localhost:${port}${urlPath}`, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve(JSON.parse(body)));
        })
        .on('error', reject);
    });
  }

  try {
    assert.strictEqual(alertServer.isMuted(), false, 'alerts should start unmuted');
    let status = await get('/status');
    assert.strictEqual(status.muted, false, '/status should report the unmuted state');
    console.log('mute defaults to off: ok');

    // The panel reads overlays, mute and all four stats out of this single
    // response. A field quietly disappearing from it kills a readout without
    // failing anything, so pin the whole shape rather than just mute.
    assert.strictEqual(typeof status.connectedOverlays, 'number');
    assert.strictEqual(status.port, port);
    assert.ok(status.stats, '/status must carry the channel stats block');
    for (const field of ['live', 'viewers', 'chatters', 'followers', 'subscribers']) {
      assert.ok(field in status.stats, `/status stats must include ${field}`);
    }
    console.log('/status carries overlays, mute and the stats block: ok');

    let muted = await get('/mute-alerts?muted=1');
    assert.strictEqual(muted.muted, true);
    assert.strictEqual(alertServer.isMuted(), true);
    status = await get('/status');
    assert.strictEqual(status.muted, true, '/status should carry the mute state for the panel to poll');
    console.log('mute on via /mute-alerts, reflected in /status: ok');

    const unmuted = await get('/mute-alerts?muted=0');
    assert.strictEqual(unmuted.muted, false);
    assert.strictEqual(alertServer.isMuted(), false);
    console.log('unmute via /mute-alerts: ok');

    // A bare /mute-alerts with no query should mute rather than silently
    // doing nothing, since that is the safe reading of the request.
    const bare = await get('/mute-alerts');
    assert.strictEqual(bare.muted, true, 'a bare /mute-alerts should mute');
    console.log('bare /mute-alerts mutes: ok');

    alertServer.setMuted(false);
  } finally {
    // Starting the server starts the stat poll, so stop it here too. Its
    // timer is unref'd and cannot hold the run open, but leaving it armed
    // would let a later test see a refresh it did not ask for.
    require('../src/channelStats').stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

// scripts/checkUpdate.js must never modify the working tree: a running
// .exe cannot be overwritten by git, so a check that quietly pulled would
// fail exactly when the control panel is open, which is always.
function checkUpdateScriptIsReadOnly() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'checkUpdate.js'), 'utf8');
  assert.ok(source.includes('UPDATE_AVAILABLE='), 'checkUpdate.js must print the marker the control panel parses');

  const mutating = ['pull', 'merge', 'reset', 'checkout', 'stash', 'clean'];
  for (const verb of mutating) {
    assert.ok(
      !new RegExp(`['"\`]${verb}['"\`]`).test(source),
      `checkUpdate.js must stay read-only, but it references git ${verb}`
    );
  }
  console.log('checkUpdate.js stays read-only: ok');
}

// The four channel stat readouts. The Helix calls themselves need network and
// a live token, so what is covered here is the part that has actually been got
// wrong before: reporting an absent number as zero, and hammering an endpoint
// that is failing.
function checkChannelStats() {
  const channelStats = require('../src/channelStats');

  // Offline is not zero. Twitch returns no viewer count for a channel that
  // is not live, and rendering that as 0 would be a measurement nobody took.
  const fresh = channelStats.getSnapshot();
  for (const field of ['viewers', 'chatters', 'followers', 'subscribers']) {
    assert.strictEqual(fresh[field], null, `${field} must start as null, never 0`);
  }
  assert.strictEqual(fresh.live, false);
  console.log('channel stats start as null rather than zero: ok');

  // The snapshot is handed out by value, so a caller cannot edit the cache.
  fresh.followers = 999;
  assert.strictEqual(channelStats.getSnapshot().followers, null, 'getSnapshot() must not expose the live cache');
  console.log('channel stats snapshot is a copy: ok');

  // No credentials means no timer, which is also what stops this very test
  // run from making live Twitch calls when it starts the alert server below.
  const saved = { channel: process.env.TWITCH_CHANNEL, token: process.env.TWITCH_OAUTH_TOKEN };
  delete process.env.TWITCH_CHANNEL;
  delete process.env.TWITCH_OAUTH_TOKEN;
  assert.strictEqual(channelStats.start(), false, 'polling must not start without credentials');
  channelStats.stop();
  if (saved.channel !== undefined) process.env.TWITCH_CHANNEL = saved.channel;
  if (saved.token !== undefined) process.env.TWITCH_OAUTH_TOKEN = saved.token;
  console.log('channel stats decline to poll without credentials: ok');

  // Backoff doubles and caps. Without this a revoked token costs a request a
  // minute for as long as the bot is up.
  const { REFRESH_MS, MAX_BACKOFF_MS } = channelStats;
  let delay = REFRESH_MS;
  delay = channelStats.nextDelayMs(delay, false);
  assert.strictEqual(delay, REFRESH_MS * 2, 'first failure should double the wait');
  for (let i = 0; i < 20; i++) delay = channelStats.nextDelayMs(delay, false);
  assert.strictEqual(delay, MAX_BACKOFF_MS, 'backoff must cap rather than growing without bound');
  assert.strictEqual(channelStats.nextDelayMs(delay, true), REFRESH_MS, 'success should return to the normal cadence');
  console.log('channel stats back off on failure and recover on success: ok');
}

// The scopes the token is requested with. A scope going missing here does not
// fail loudly: it surfaces later as a 401 from whichever Helix call needed it,
// a long way from the cause, so it is worth pinning.
function checkAuthScopes() {
  const { SCOPES } = require('../src/twitchAuth');

  const required = [
    'chat:read',
    'chat:edit',
    'moderator:manage:banned_users',
    'channel:manage:broadcast',
    'moderator:read:followers',
    'channel:read:subscriptions',
    'moderator:read:chatters',
    'channel:read:ads',
    'channel:read:redemptions',
    'bits:read',
  ];
  for (const scope of required) {
    assert.ok(SCOPES.includes(scope), `SCOPES must include ${scope}`);
  }

  // Not an oversight, a decision: starting an ad break is irreversible and
  // viewer-facing, and no code here runs ads yet. It gets added with item 35.
  assert.ok(
    !SCOPES.includes('channel:manage:ads'),
    'channel:manage:ads should not be requested until the feature that runs ads exists'
  );
  console.log('requested OAuth scopes: ok');
}

// setChannelInfo.js is the panel's write path. An empty submission must stop
// before the network, since "no fields filled in" is a mistake to name rather
// than a request to send.
function checkSetChannelInfoRejectsEmpty() {
  const script = path.join(__dirname, '..', 'scripts', 'setChannelInfo.js');
  const res = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      TWITCH_CHANNEL: 'someone',
      CHANNEL_TITLE: '',
      CHANNEL_CATEGORY: '   ',
    }),
  });

  assert.notStrictEqual(res.status, 0, 'an empty submission should exit non-zero');
  assert.ok(
    /Nothing to change/.test(res.stderr),
    `expected a "nothing to change" message, got: ${res.stderr.trim() || res.stdout.trim()}`
  );
  assert.ok(
    !/CHANNEL_UPDATE_OK/.test(res.stdout),
    'an empty submission must not report success'
  );
  console.log('setChannelInfo.js rejects an empty submission: ok');
}

// The credential guard on the write path. The suite does not load .env, so
// these variables are genuinely absent here.
async function checkUpdateChannelInfoNeedsCredentials() {
  const twitchApi = require('../src/twitchApi');
  const savedId = process.env.TWITCH_CLIENT_ID;
  const savedToken = process.env.TWITCH_OAUTH_TOKEN;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_OAUTH_TOKEN;

  try {
    await assert.rejects(
      () => twitchApi.updateChannelInfo('someone', { title: 'x' }),
      /Missing TWITCH_CLIENT_ID/
    );
    await assert.rejects(
      () => twitchApi.getChannelSettings('someone'),
      /Missing TWITCH_CLIENT_ID/
    );
    console.log('channel read/write refuse to run without credentials: ok');
  } finally {
    if (savedId !== undefined) process.env.TWITCH_CLIENT_ID = savedId;
    if (savedToken !== undefined) process.env.TWITCH_OAUTH_TOKEN = savedToken;
  }
}

async function run() {
  checkBatchFileLineEndings();

  // --- Commands ---
  let replied = '';
  const ctx = { reply: (msg) => { replied = msg; } };

  let handled = await commands.handle({ text: '!hello', username: 'viewer1' }, ctx);
  assert.strictEqual(handled, true);
  assert.strictEqual(replied, 'Hey there, welcome to the stream!');
  console.log('custom command (!hello): ok');

  handled = await commands.handle({ text: '!uptime', username: 'viewer1' }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('Bot has been running for'));
  console.log('builtin command (!uptime): ok');

  handled = await commands.handle({ text: 'no prefix here', username: 'viewer1' }, ctx);
  assert.strictEqual(handled, false);
  console.log('non-command message ignored: ok');

  const jokesList = JSON.parse(fs.readFileSync(path.join(scratchDir, 'config', 'jokes.json'), 'utf8'));
  handled = await commands.handle({ text: '!joke', username: 'viewer1' }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(jokesList.includes(replied), 'joke reply should come from config/jokes.json');
  console.log('builtin command (!joke): ok');

  handled = await commands.handle({ text: '!pp', username: 'weeb123', displayName: 'CoolViewer' }, ctx);
  assert.strictEqual(handled, true);
  assert.match(replied, /^CoolViewer's pp is \d+ inches long and \d+ inches around!$/);
  const ppLength = Number(replied.match(/is (\d+) inches/)[1]);
  assert.ok(ppLength >= 1 && ppLength <= 100, `pp length ${ppLength} should be between 1 and 100`);
  const ppGirth = Number(replied.match(/and (\d+) inches around/)[1]);
  assert.ok(ppGirth >= 1 && ppGirth <= 25, `pp girth ${ppGirth} should be between 1 and 25`);
  console.log('builtin command (!pp): ok');

  handled = await commands.handle({ text: '!so somestreamer', username: 'viewer1', isMod: false, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.toLowerCase().includes('only mods'), 'non-mods should be blocked from !so');
  console.log('!so blocked for non-mods: ok');

  handled = await commands.handle({ text: '!so', username: 'modUser', isMod: true, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('No one to shout out yet'), 'no target and no last raider should prompt for a username');
  console.log('!so with no target/raider: ok');

  handled = await commands.handle({ text: '!so somestreamer', username: 'modUser', isMod: true, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('somestreamer'), 'shoutout should mention the given username');
  console.log('!so with explicit target (no Twitch API creds): ok');

  state.setLastRaider('raiderperson');
  handled = await commands.handle({ text: '!so', username: 'modUser', isMod: true, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('raiderperson'), 'shoutout should fall back to the last raider when no target is given');
  console.log('!so falls back to last raider: ok');

  handled = await commands.handle({ text: '!lurk', username: 'lurkUser', displayName: 'LurkyMcLurkface' }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('LurkyMcLurkface'), '!lurk should mention the display name');
  console.log('builtin command (!lurk): ok');

  handled = await commands.handle({ text: '!unlurk', username: 'unlurkUser', displayName: 'BackNow' }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('BackNow'), '!unlurk should mention the display name');
  console.log('builtin command (!unlurk): ok');

  handled = await commands.handle({ text: '!title new title here', username: 'viewer1', isMod: false, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.toLowerCase().includes('only mods'), 'non-mods should be blocked from !title');
  console.log('!title blocked for non-mods: ok');

  handled = await commands.handle({ text: '!title', username: 'modUser2', isMod: true, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.startsWith('Usage:'), '!title with no argument should show usage');
  console.log('!title with no argument shows usage: ok');

  handled = await commands.handle({ text: '!title My New Title', username: 'modUser2', isMod: true, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.toLowerCase().includes('could not update'), '!title should fail gracefully without Twitch API creds');
  console.log('!title fails gracefully without Twitch API creds: ok');

  handled = await commands.handle({ text: '!game Just Chatting', username: 'modUser2', isMod: true, isBroadcaster: false }, ctx);
  assert.strictEqual(handled, true);
  assert.ok(replied.toLowerCase().includes('could not update'), '!game should fail gracefully without Twitch API creds');
  console.log('!game fails gracefully without Twitch API creds: ok');

  // --- Cooldowns ---
  handled = await commands.handle(
    { text: '!pp', username: 'cooldownTestUser', displayName: 'CDUser', isMod: false, isBroadcaster: false },
    ctx
  );
  assert.strictEqual(handled, true);
  const firstPpReply = replied;
  assert.match(firstPpReply, /inches around!$/);

  handled = await commands.handle(
    { text: '!pp', username: 'cooldownTestUser', displayName: 'CDUser', isMod: false, isBroadcaster: false },
    ctx
  );
  assert.strictEqual(handled, true);
  assert.strictEqual(replied, firstPpReply, 'repeating a command immediately should be blocked by cooldown (reply unchanged)');
  console.log('cooldown blocks a repeated command from the same user: ok');

  handled = await commands.handle(
    { text: '!uptime', username: 'cooldownTestUser', displayName: 'CDUser', isMod: false, isBroadcaster: false },
    ctx
  );
  assert.strictEqual(handled, true);
  assert.ok(replied.includes('Bot has been running for'), 'a different command for the same user should not share another command\'s cooldown');
  console.log('cooldown is tracked per-command, not per-user: ok');

  // --- Moderation ---
  let result = moderation.evaluate({ username: 'viewer2', text: 'this has a badword in it', isMod: false, isBroadcaster: false });
  assert.strictEqual(result.action, 'warn');
  assert.strictEqual(result.reason, 'banned word');
  console.log('banned word -> warn (1st offense): ok');

  result = moderation.evaluate({ username: 'viewer2', text: 'this has a badword in it', isMod: false, isBroadcaster: false });
  result = moderation.evaluate({ username: 'viewer2', text: 'this has a badword in it', isMod: false, isBroadcaster: false });
  assert.strictEqual(result.action, 'timeout');
  console.log('banned word -> timeout after max warnings: ok');

  result = moderation.evaluate({ username: 'viewer3', text: 'check this out totally-not-spam.com', isMod: false, isBroadcaster: false });
  assert.strictEqual(result.action, 'delete');
  assert.strictEqual(result.reason, 'unapproved link');
  console.log('unapproved link -> delete: ok');

  result = moderation.evaluate({ username: 'viewer3', text: 'clips.twitch.tv/some-clip', isMod: false, isBroadcaster: false });
  assert.strictEqual(result, null);
  console.log('allowlisted link -> clean: ok');

  result = moderation.evaluate({ username: 'viewer4', text: 'THIS IS WAY TOO LOUD FOR CHAT', isMod: false, isBroadcaster: false });
  assert.strictEqual(result.action, 'warn');
  assert.strictEqual(result.reason, 'excessive caps');
  console.log('excessive caps -> warn: ok');

  for (let i = 0; i < 3; i++) {
    result = moderation.evaluate({ username: 'viewer5', text: 'spam message', isMod: false, isBroadcaster: false });
  }
  assert.strictEqual(result.action, 'timeout');
  assert.strictEqual(result.reason, 'repeated message spam');
  console.log('repeated message spam -> timeout: ok');

  result = moderation.evaluate({ username: 'modUser', text: 'this has a badword in it', isMod: true, isBroadcaster: false });
  assert.strictEqual(result, null);
  console.log('mods exempt from moderation: ok');

  // --- Channel stats ---
  checkChannelStats();

  // --- Mute alerts ---
  await checkMuteAlerts();

  // --- Update check ---
  checkUpdateScriptIsReadOnly();

  // --- Channel title and category ---
  checkAuthScopes();
  checkSetChannelInfoRejectsEmpty();
  await checkUpdateChannelInfoNeedsCredentials();

  configStore.close();
  fs.rmSync(scratchDir, { recursive: true, force: true });
  console.log('\nAll tests passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  configStore.close();
  fs.rmSync(scratchDir, { recursive: true, force: true });
  process.exit(1);
});
