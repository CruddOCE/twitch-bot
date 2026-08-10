const paths = require('./src/paths');

// Must run before dotenv: an upgraded install still has its only .env in
// the program folder, and loading an absent one would drop the token.
paths.migrateLegacyEnv();
require('dotenv').config({ path: paths.envPath });

const configStore = require('./src/configStore');
const alertServer = require('./src/alertServer');
const twitchBot = require('./src/twitchBot');

configStore.init();

const channel = process.env.TWITCH_CHANNEL;
const username = process.env.TWITCH_BOT_USERNAME;
const token = process.env.TWITCH_OAUTH_TOKEN;

if (!channel || !username || !token) {
  console.error('Missing TWITCH_CHANNEL / TWITCH_BOT_USERNAME / TWITCH_OAUTH_TOKEN in .env. Run `npm run setup` first.');
  process.exit(1);
}

alertServer.start();
twitchBot.start();

process.on('SIGINT', () => {
  console.log('\nShutting down.');
  process.exit(0);
});
