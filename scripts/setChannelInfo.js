// Sets the channel's title and/or category.
//
// Driven by the control panel's Update Channel button, which passes the values
// as environment variables. A script rather than an endpoint on the alert
// server, because the token lives in .env rather than in the bot process:
// making this an endpoint would mean the bot had to be running before the
// title could be fixed, and fixing the title is something you do *before*
// pressing Start Bot.
//
// It is also the only shape that can be tested. GUI text fields could not be
// driven by any automation tried on this project (see HANDOFF.md), so the way
// to exercise this path is to run the script directly with the same variables
// the button passes.
//
// Usage:
//   CHANNEL_TITLE="new title" node scripts/setChannelInfo.js
//   CHANNEL_CATEGORY="Star Citizen" node scripts/setChannelInfo.js
//   both together sends one request
//
// Only works when the bot account IS the broadcaster, since Twitch only lets a
// channel's own token change its info, and the token needs
// channel:manage:broadcast.

require('dotenv').config({ path: require('../src/paths').envPath });
const twitchApi = require('../src/twitchApi');

async function main() {
  const channel = process.env.TWITCH_CHANNEL;
  if (!channel) {
    console.error('TWITCH_CHANNEL is not set.');
    process.exit(1);
  }

  const title = (process.env.CHANNEL_TITLE || '').trim();
  const category = (process.env.CHANNEL_CATEGORY || '').trim();

  // Bail before touching the network. An empty submission is a no-op worth
  // naming rather than a request worth sending.
  if (!title && !category) {
    console.error('Nothing to change. Set CHANNEL_TITLE and/or CHANNEL_CATEGORY.');
    process.exit(1);
  }

  // Only non-empty fields go in, so a blank category means "leave the category
  // alone" rather than "clear it". There is no way to clear either field from
  // here, which matches Twitch: a channel always has a title and a category.
  const changes = {};
  if (title) changes.title = title;
  if (category) changes.gameName = category;

  try {
    await twitchApi.updateChannelInfo(channel, changes);
    if (title) console.log(`Title set to: ${title}`);
    if (category) console.log(`Category set to: ${category}`);
    console.log('CHANNEL_UPDATE_OK=1');
  } catch (err) {
    console.error(`Could not update the channel: ${err.message}`);
    process.exit(1);
  }
}

main();
