// Non-interactive version of the account-connection step in npm run setup,
// meant to be run as a child process from the control panel (see
// installer/ControlProgram.cs's "Connect Twitch Account" button) rather
// than a terminal. Takes the username/channel via env vars instead of
// readline prompts, and merges the result into .env instead of overwriting
// it, so it's safe to re-run without losing other settings (OBS password,
// alert config overrides, etc.) that were set some other way.
//
// Required env vars: TWITCH_BOT_USERNAME, TWITCH_CHANNEL
// Optional: TWITCH_CLIENT_ID (defaults to the shared built-in app)

const fs = require('fs');
const paths = require('../src/paths');
const twitchAuth = require('../src/twitchAuth');

const ENV_PATH = paths.envPath;

function readEnvFile() {
  paths.migrateLegacyEnv();
  if (!fs.existsSync(ENV_PATH)) return {};
  const result = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    result[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return result;
}

function writeEnvFile(env) {
  paths.ensureDataDir();
  const lines = Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, `${lines.join('\n')}\n`);
}

async function main() {
  const username = (process.env.TWITCH_BOT_USERNAME || '').trim();
  const channel = (process.env.TWITCH_CHANNEL || '').trim().toLowerCase();

  if (!username || !channel) {
    console.error('Missing bot username or channel name.');
    process.exit(1);
  }

  const env = readEnvFile();
  env.BOT_PREFIX = env.BOT_PREFIX || '!';
  env.ALERT_SERVER_PORT = env.ALERT_SERVER_PORT || '8090';
  env.TWITCH_BOT_USERNAME = username;
  env.TWITCH_CHANNEL = channel;
  env.TWITCH_CLIENT_ID = env.TWITCH_CLIENT_ID || twitchAuth.DEFAULT_CLIENT_ID;

  console.log('Opening your browser to sign in with the bot account...');
  try {
    const token = await twitchAuth.getChatToken(env.TWITCH_CLIENT_ID);
    env.TWITCH_OAUTH_TOKEN = `oauth:${token}`;
    writeEnvFile(env);
    console.log('SUCCESS: Twitch account connected.');
    console.log(`Reminder: in your own Twitch chat, run "/mod ${username}" so the bot can moderate.`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
