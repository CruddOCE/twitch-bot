// Reads the four channel stats once and prints them.
//
// Exists mainly to verify the Helix calls in src/channelStats.js without
// going through the control panel, since the panel only ever shows the
// cached numbers and a wrong call there looks identical to a stale one.
// Also the quickest way to check a scope is really working after a
// Reconnect.
//
// Prints machine-readable lines, the same contract readChannelInfo.js and
// checkUpdate.js use:
//   CHANNEL_LIVE=<true|false>
//   CHANNEL_VIEWERS=<number|offline>
//   CHANNEL_CHATTERS=<number|unavailable>
//   CHANNEL_FOLLOWERS=<number|unavailable>
//   CHANNEL_SUBSCRIBERS=<number|unavailable>
//   CHANNEL_STATS_FAILED=<reason>
//
// Read-only, and it does not start the polling timer: one pass, then exit.
//
// Usage: node scripts/readChannelStats.js

require('dotenv').config({ path: require('../src/paths').envPath });
const channelStats = require('../src/channelStats');

function show(value, absent) {
  return value === null || value === undefined ? absent : value;
}

async function main() {
  if (!process.env.TWITCH_CHANNEL) {
    console.log('CHANNEL_STATS_FAILED=TWITCH_CHANNEL is not set');
    process.exit(1);
  }

  const ok = await channelStats.refresh();
  const stats = channelStats.getSnapshot();

  console.log(`CHANNEL_LIVE=${stats.live}`);
  console.log(`CHANNEL_VIEWERS=${show(stats.viewers, 'offline')}`);
  console.log(`CHANNEL_CHATTERS=${show(stats.chatters, 'unavailable')}`);
  console.log(`CHANNEL_FOLLOWERS=${show(stats.followers, 'unavailable')}`);
  console.log(`CHANNEL_SUBSCRIBERS=${show(stats.subscribers, 'unavailable')}`);

  // A partial answer still prints every line above, so you can see which
  // one endpoint is the problem rather than losing the whole read to it.
  if (!ok) {
    console.log(`CHANNEL_STATS_FAILED=${stats.error || 'unknown'}`);
    process.exit(1);
  }
}

main();
