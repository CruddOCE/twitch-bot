// One-time helper: gets a chat OAuth token for your bot account via
// Twitch's implicit-grant flow, and prints it for you to paste into .env.
//
// Uses the built-in shared Twitch app by default -- no app to register
// yourself. If you've set your own TWITCH_CLIENT_ID in .env, that's used
// instead.
//
// Prefer a fully guided setup? Run: npm run setup

require('dotenv').config();
const { getChatToken, DEFAULT_CLIENT_ID } = require('../src/twitchAuth');

const clientId = process.env.TWITCH_CLIENT_ID;
console.log(
  clientId
    ? 'Opening your browser to log in with your BOT account (not your streamer account, unless you want the bot to post as you).\n'
    : 'Opening your browser to log in with your BOT account, using the built-in shared Twitch app.\n'
);

getChatToken(clientId || DEFAULT_CLIENT_ID)
  .then((token) => {
    console.log('\nYour Twitch chat token:\n');
    console.log(`TWITCH_OAUTH_TOKEN=oauth:${token}\n`);
    console.log('Paste that line into your .env file, then set TWITCH_BOT_USERNAME and TWITCH_CHANNEL.');
    if (!clientId) console.log(`(And TWITCH_CLIENT_ID=${DEFAULT_CLIENT_ID}, if it's not already there.)`);
  })
  .catch((err) => {
    console.error('Twitch login failed:', err.message);
    process.exit(1);
  });
