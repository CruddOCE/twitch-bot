// Reads the channel's current title and category.
//
// Exists so the control panel can prefill its edit fields. Empty fields would
// be a trap: pressing Update with a blank title box reads as "clear the
// title", so the panel has to know what is already there before it can offer
// to change it.
//
// Prints machine-readable lines for the panel to parse, one per line, the same
// contract checkUpdate.js uses:
//   CHANNEL_TITLE=<current title>
//   CHANNEL_CATEGORY=<current category name>
//   CHANNEL_INFO_FAILED=<reason>
//
// Read-only. The panel runs it unprompted on launch, so it must never write
// anything.
//
// Usage: node scripts/readChannelInfo.js

require('dotenv').config();
const twitchApi = require('../src/twitchApi');

async function main() {
  const channel = process.env.TWITCH_CHANNEL;
  if (!channel) {
    console.log('CHANNEL_INFO_FAILED=TWITCH_CHANNEL is not set');
    process.exit(1);
  }

  try {
    const info = await twitchApi.getChannelSettings(channel);
    // One line each, values unescaped and unquoted: a Twitch title is single
    // line and capped at 140 characters, so it cannot break the line-based
    // contract. The panel anchors its match to end-of-line, which keeps a
    // title containing "=" intact.
    console.log(`CHANNEL_TITLE=${info.title}`);
    console.log(`CHANNEL_CATEGORY=${info.gameName}`);
  } catch (err) {
    console.log(`CHANNEL_INFO_FAILED=${err.message}`);
    process.exit(1);
  }
}

main();
