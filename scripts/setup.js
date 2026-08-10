// Guided setup wizard: installs dependencies and walks you through getting
// Twitch credentials, printing (and opening) the exact page you need at
// every step. Writes the result to .env for you. Safe to re-run any time
// to redo a step or refresh an expired login.

const fs = require('fs');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { spawnSync } = require('child_process');

const { openUrl } = require('../src/openBrowser');
const paths = require('../src/paths');
const twitchAuth = require('../src/twitchAuth');

const ROOT = paths.installRoot;
const ENV_PATH = paths.envPath;

const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(question, { default: def } = {}) {
  const suffix = def ? ` (${def})` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || def || '';
}

function step(n, title) {
  console.log(`\n--- Step ${n}: ${title} ---`);
}

// Prints the exact page needed for this step and opens it in the default
// browser. This is the "link at every step" the wizard promises.
function link(url) {
  console.log(`  -> ${url}`);
  openUrl(url);
}

function writeEnvFile(env) {
  paths.ensureDataDir();
  const lines = Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, `${lines.join('\n')}\n`);
}

async function confirm(question, defaultYes = false) {
  const suffix = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = (await rl.question(`${question} ${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith('y');
}

async function main() {
  console.log('twitch-bot setup wizard');
  console.log('Installs dependencies and walks you through getting Twitch credentials, opening the exact page you need at each step.\n');

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await confirm('.env already exists. Overwrite it with new values from this wizard?', false);
    if (!overwrite) {
      console.log('Leaving your existing .env untouched. Exiting.');
      rl.close();
      return;
    }
  }

  // An installed copy ships node_modules inside the program folder, so
  // there is nothing to fetch and npm may not even be present. Only a
  // checkout needs this step.
  if (paths.isInstalled) {
    console.log('\nDependencies are bundled with this install, skipping npm install.');
  } else {
    console.log('\nInstalling dependencies (npm install)...');
    // Passing a single command string (not an args array) with shell:true
    // avoids Node's DEP0190 warning, which only fires for the array-args
    // form since that requires Node to join arguments into a shell command
    // internally. shell:true itself is still needed here so Windows
    // resolves npm.cmd correctly.
    const install = spawnSync('npm install', { stdio: 'inherit', shell: true, cwd: ROOT });
    if (install.status !== 0) {
      console.error('\nnpm install failed. Fix that first, then re-run: npm run setup');
      rl.close();
      process.exit(1);
    }
  }

  const env = {
    BOT_PREFIX: '!',
    ALERT_SERVER_PORT: '8090',
  };

  console.log('\n=== Twitch setup ===');

  env.TWITCH_BOT_USERNAME = await ask('Twitch username the bot logs in as');
  env.TWITCH_CHANNEL = (await ask('Your channel name (lowercase, no #)')).toLowerCase();

  const useOwnApp = await confirm(
    '\nUse your own Twitch app instead of the built-in one? (advanced -- most people can say no)',
    false
  );

  if (useOwnApp) {
    step(1, 'Create a Twitch application');
    console.log('Name it anything, set OAuth Redirect URL to http://localhost:3940/callback, category "Chat Bot".');
    link('https://dev.twitch.tv/console/apps/create');
    env.TWITCH_CLIENT_ID = await ask('Paste the Client ID');

    step(2, 'Generate a Client Secret (optional, enables !so game lookups)');
    console.log('On the same app\'s page, click "New Secret". Press Enter to skip this.');
    link('https://dev.twitch.tv/console/apps');
    const secret = await ask('Paste the Client Secret (optional)');
    if (secret) env.TWITCH_CLIENT_SECRET = secret;
  } else {
    env.TWITCH_CLIENT_ID = twitchAuth.DEFAULT_CLIENT_ID;
    console.log('\nUsing the built-in shared Twitch app -- no app to register, just sign in below.');
    console.log('(!so\'s optional "last streaming <game>" extra needs its own Client ID + Secret --');
    console.log(' add TWITCH_CLIENT_SECRET to .env yourself later if you want that specific bonus.)');
  }

  step(useOwnApp ? 3 : 1, 'Log in as the bot account');
  console.log('A browser tab will open. Log in with the BOT account (not your streamer account, unless you want it posting as you) and approve access.');
  await ask('Press Enter when you\'re ready');

  try {
    const token = await twitchAuth.getChatToken(env.TWITCH_CLIENT_ID, { onAuthUrl: link });
    env.TWITCH_OAUTH_TOKEN = `oauth:${token}`;
    console.log('Twitch chat token acquired.');
  } catch (err) {
    console.error(`Twitch login failed: ${err.message}`);
    console.error('You can retry later with: npm run twitch-auth');
  }

  console.log(`\nReminder: in your own Twitch chat, run "/mod ${env.TWITCH_BOT_USERNAME || '<botname>'}" so the bot can time out/delete messages.`);

  writeEnvFile(env);
  console.log(`\nSetup complete! Wrote ${ENV_PATH}`);
  console.log('Start the bot with: npm start');
  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
