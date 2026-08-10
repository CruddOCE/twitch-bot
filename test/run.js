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

// The installed app lives in Program Files, which it cannot write to, so
// everything it saves has to resolve somewhere else. This suite runs from
// a git checkout, where the answer must still be the project folder: get
// that wrong and development starts silently reading a different .env from
// the one on screen.
function checkPathsInCheckout() {
  const paths = require('../src/paths');
  const root = path.join(__dirname, '..');
  assert.strictEqual(paths.isInstalled, false, 'a checkout with .git must not be treated as an install');
  assert.strictEqual(path.resolve(paths.dataDir), path.resolve(root));
  assert.strictEqual(path.resolve(paths.envPath), path.resolve(root, '.env'));
  assert.strictEqual(path.resolve(paths.configDir), path.resolve(root, 'config'));
  assert.strictEqual(path.resolve(paths.logsDir), path.resolve(root, 'logs'));
  assert.strictEqual(path.resolve(paths.ttsDir), path.resolve(root, 'public', 'tts'));
  console.log('paths resolve to the project folder in a checkout: ok');
}

// The installed case, exercised through the data dir override so it can be
// tested without a second copy of the tree. What matters is that all four
// writable locations move together: one left behind in Program Files is an
// access-denied crash on a machine that is not this one.
function checkPathsWhenRelocated() {
  const relocated = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-data-'));
  const res = spawnSync(
    process.execPath,
    ['-e', 'const p = require("./src/paths"); console.log(JSON.stringify(p));'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: Object.assign({}, process.env, { TWITCH_BOT_DATA_DIR: relocated }),
    }
  );
  assert.strictEqual(res.status, 0, `paths.js failed to load: ${res.stderr}`);
  const p = JSON.parse(res.stdout);

  for (const key of ['envPath', 'configDir', 'logsDir', 'ttsDir']) {
    assert.ok(
      path.resolve(p[key]).startsWith(path.resolve(relocated)),
      `${key} (${p[key]}) must sit under the data dir, not the program folder`
    );
  }
  fs.rmSync(relocated, { recursive: true, force: true });
  console.log('every writable path follows the data dir: ok');
}

// A fresh install has an empty data dir, so the config it ships has to be
// copied across on first run. The half that matters more is the second
// assertion: an upgrade must never overwrite commands the user has written.
function checkConfigSeeding() {
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-seed-'));
  const configPath = path.join(seedDir, 'config');
  const seed = () => spawnSync(
    process.execPath,
    ['-e', 'require("./src/configStore").seedDefaults();'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: Object.assign({}, process.env, { TWITCH_BOT_CONFIG_DIR: configPath }),
    }
  );

  let res = seed();
  assert.strictEqual(res.status, 0, `seedDefaults failed: ${res.stderr}`);
  for (const file of ['commands.json', 'moderation.json', 'jokes.json', 'alerts.json', 'cooldowns.json', 'timers.json']) {
    assert.ok(fs.existsSync(path.join(configPath, file)), `${file} should have been seeded`);
  }
  console.log('a fresh data dir gets the shipped config: ok');

  const mine = '{"!mycommand":"mine"}';
  fs.writeFileSync(path.join(configPath, 'commands.json'), mine);
  res = seed();
  assert.strictEqual(res.status, 0, `second seedDefaults failed: ${res.stderr}`);
  assert.strictEqual(
    fs.readFileSync(path.join(configPath, 'commands.json'), 'utf8'),
    mine,
    'seeding must never overwrite a config file the user already has'
  );
  fs.rmSync(seedDir, { recursive: true, force: true });
  console.log('seeding leaves existing config alone: ok');
}

// TTS audio moved out of public/ and into the data dir, so it needs its own
// static mount. Without it every alert renders silently: the overlay asks
// for /tts/<id>.wav and gets a 404, which nothing in the bot logs as an
// error because the alert itself succeeded.
//
// Runs in a child process with the data dir pointed somewhere else on
// purpose. In a checkout the TTS folder sits inside public/, so the main
// static mount answers for it and this passes whether or not the /tts mount
// exists at all. Moving the data dir outside public/ is what makes the test
// mean something, and it is also the installed layout being reproduced.
//
// Two ordering traps, both already paid for: the probe file has to be
// written after src/ttsEngine is required, because it sweeps the folder
// clean at load time, and the request needs agent:false, because Node keeps
// pooled sockets alive and an earlier test in this suite has already
// spoken to this port on a server that is now closed.
async function checkTtsIsServedFromDataDir() {
  const relocated = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-tts-'));
  const port = 8093;
  const probeScript = `
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const paths = require('./src/paths');
    const alertServer = require('./src/alertServer');
    const server = alertServer.start();
    server.once('listening', () => {
      fs.mkdirSync(paths.ttsDir, { recursive: true });
      fs.writeFileSync(path.join(paths.ttsDir, 'probe.wav'), 'probe');
      http.get({ host: 'localhost', port: ${port}, path: '/tts/probe.wav', agent: false }, (res) => {
        console.log('TTS_STATUS=' + res.statusCode);
        res.resume();
        require('./src/channelStats').stop();
        server.close(() => process.exit(0));
      }).on('error', (e) => { console.log('TTS_STATUS=error ' + e.message); process.exit(1); });
    });
  `;

  const res = spawnSync(process.execPath, ['-e', probeScript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      TWITCH_BOT_DATA_DIR: relocated,
      ALERT_SERVER_PORT: String(port),
    }),
  });

  assert.strictEqual(res.status, 0, `TTS probe failed: ${res.stderr}`);
  assert.ok(
    /TTS_STATUS=200/.test(res.stdout),
    `the TTS directory must be reachable at /tts/<file>, got: ${res.stdout.trim()}`
  );
  assert.ok(
    !path.resolve(relocated).startsWith(path.resolve(__dirname, '..', 'public')),
    'the probe must run against a TTS dir outside public/, or the main static mount answers for it'
  );
  fs.rmSync(relocated, { recursive: true, force: true });
  console.log('generated TTS is served from the data dir, outside public/: ok');
}

// The installed updater decides whether to offer an update by comparing
// version strings, so an off-by-one here either nags forever or never
// offers anything at all.
function checkVersionCompare() {
  const release = require('../src/release');
  assert.strictEqual(release.compareVersions('0.7.0', '0.6.0'), 1);
  assert.strictEqual(release.compareVersions('0.6.0', '0.7.0'), -1);
  assert.strictEqual(release.compareVersions('0.7.0', '0.7.0'), 0);
  assert.strictEqual(release.compareVersions('v0.7.0', '0.7.0'), 0, 'a leading v is a tag convention, not a version difference');
  assert.strictEqual(release.compareVersions('0.7', '0.7.0'), 0, 'missing parts count as zero');
  assert.strictEqual(release.compareVersions('0.10.0', '0.9.0'), 1, 'version parts are numbers, not text');
  console.log('release version comparison: ok');
}

// The version is written in two places: package.json, which the installer
// and the release check read, and a const in the panel's C# source, which
// is what a user actually sees in the corner of the window. They drifted
// apart once already, which is invisible until someone reports a bug
// against a version that was never released.
function checkVersionsAgree() {
  const root = path.join(__dirname, '..');
  const pkg = require('../package.json').version;
  const cs = fs.readFileSync(path.join(root, 'installer', 'ControlProgram.cs'), 'utf8');
  const match = cs.match(/private const string AppVersion = "([^"]+)"/);
  assert.ok(match, 'could not find AppVersion in ControlProgram.cs');
  assert.strictEqual(match[1], pkg, 'the control panel version must match package.json');
  console.log(`version agrees across package.json and the panel (${pkg}): ok`);
}

// The installer script names files by path. A renamed icon or a moved
// control panel breaks the build with an Inno Setup error that reads
// nothing like its cause, and only at release time.
function checkInstallerScriptReferences() {
  const root = path.join(__dirname, '..');
  const iss = fs.readFileSync(path.join(root, 'installer', 'twitch-bot.iss'), 'utf8');

  assert.ok(
    iss.includes('AppId={{A7F3C1E2-5B94-4D6A-9E31-2C8F0B7D4A15}'),
    'the AppId must not change: it is what makes a reinstall an upgrade rather than a second install'
  );
  assert.ok(fs.existsSync(path.join(root, 'native', 'icon.ico')), 'installer icon is missing');
  assert.ok(fs.existsSync(path.join(root, 'bin', 'twitch-bot-control.exe')), 'the control panel exe the shortcuts point at is missing');
  console.log('installer script references resolve: ok');
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

  // --- Installed layout ---
  checkPathsInCheckout();
  checkPathsWhenRelocated();
  checkConfigSeeding();
  await checkTtsIsServedFromDataDir();
  checkVersionCompare();
  checkVersionsAgree();
  checkInstallerScriptReferences();

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
