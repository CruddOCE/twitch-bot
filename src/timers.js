// Rotates through config/timers.json's messages, posting one to chat every
// intervalMinutes. Re-checks config on every cycle (including while
// disabled) so toggling it on/off or editing the message list hot-reloads
// like everything else here, without needing to restart the bot.

const configStore = require('./configStore');
const logger = require('./logger');

let timerHandle = null;
let messageIndex = 0;
let started = false;

function scheduleNext(sayFn) {
  const timers = configStore.get('timers');
  const enabled = Boolean(timers && timers.enabled && timers.messages && timers.messages.length > 0);
  const intervalMs = enabled ? Math.max((timers.intervalMinutes || 15) * 60000, 60000) : 60000;

  timerHandle = setTimeout(() => {
    const current = configStore.get('timers');
    if (current && current.enabled && current.messages && current.messages.length > 0) {
      const msg = current.messages[messageIndex % current.messages.length];
      messageIndex += 1;
      sayFn(msg);
      logger.action('timer', `Posted: ${msg}`);
    }
    scheduleNext(sayFn);
  }, intervalMs);
}

// Idempotent -- tmi.js can fire 'connected' again after a reconnect, and
// calling this twice would otherwise spawn a second overlapping schedule.
function start(sayFn) {
  if (started) return;
  started = true;
  scheduleNext(sayFn);
}

function stop() {
  if (timerHandle) clearTimeout(timerHandle);
  timerHandle = null;
  started = false;
}

module.exports = { start, stop };
