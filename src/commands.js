const configStore = require('./configStore');
const alertServer = require('./alertServer');
const state = require('./state');
const twitchApi = require('./twitchApi');
const logger = require('./logger');

const startTime = Date.now();
const PREFIX = process.env.BOT_PREFIX || '!';
const MOD_ONLY = new Set(['so', 'title', 'game']);

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// Shared by !so and twitchBot.js's auto-shoutout-on-raid, so a raid gets
// the exact same message a mod would get from typing !so themselves.
async function buildShoutoutMessage(target) {
  const info = await twitchApi.getChannelInfo(target).catch((err) => {
    logger.action('twitch-api', `shoutout lookup for "${target}" failed: ${err.message}`, false);
    return null;
  });
  if (info) {
    return info.game
      ? `Go check out ${info.displayName} at twitch.tv/${info.login}. They were last streaming ${info.game}!`
      : `Go check out ${info.displayName} at twitch.tv/${info.login}!`;
  }
  return `Go check out ${target}!`;
}

const BUILTINS = {
  uptime: () => `Bot has been running for ${formatUptime(Date.now() - startTime)}.`,
  commands: () => {
    const custom = Object.keys(configStore.get('commands') || {});
    const builtin = Object.keys(BUILTINS);
    const all = [...builtin, ...custom].map((c) => PREFIX + c);
    return `Available commands: ${all.join(', ')}`;
  },
  joke: () => {
    const jokes = configStore.get('jokes') || [];
    if (jokes.length === 0) return 'No jokes loaded. Add some to config/jokes.json.';
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    // alert() (chime + visual popup) is what actually shows up in OBS --
    // speak() alone is not enough, since OBS's Browser Source generally has
    // no usable TTS voices and would otherwise produce nothing perceptible.
    alertServer.alert('joke', joke);
    alertServer.speak(joke);
    return joke;
  },
  pp: (message) => {
    const name = message.displayName || message.username;
    // Two independent rolls, and girth is capped well below length on purpose:
    // matching ranges produces results like "90 long and 90 around", which
    // stops reading as a joke and starts reading as a bug.
    const length = Math.floor(Math.random() * 100) + 1;
    const girth = Math.floor(Math.random() * 25) + 1;
    const reply = `${name}'s pp is ${length} inches long and ${girth} inches around!`;
    alertServer.alert('pp', reply);
    alertServer.speak(reply);
    return reply;
  },
  so: async (message, args) => {
    const targetRaw = args[0] || state.getLastRaider();
    if (!targetRaw) return 'No one to shout out yet. Try !so <username>.';
    const target = targetRaw.replace(/^@/, '');

    const reply = await buildShoutoutMessage(target);
    alertServer.alert('so', reply);
    alertServer.speak(reply);
    return reply;
  },
  lurk: (message) => {
    const name = message.displayName || message.username;
    return `${name} has gone into lurk mode. Thanks for hanging out!`;
  },
  unlurk: (message) => {
    const name = message.displayName || message.username;
    return `Welcome back, ${name}!`;
  },
  title: async (message, args) => {
    const newTitle = args.join(' ').trim();
    if (!newTitle) return 'Usage: !title <new stream title>';
    try {
      await twitchApi.updateChannelInfo(process.env.TWITCH_CHANNEL, { title: newTitle });
      return `Title updated to: ${newTitle}`;
    } catch (err) {
      logger.action('twitch-api', `!title failed: ${err.message}`, false);
      return `Could not update the title (${err.message}).`;
    }
  },
  game: async (message, args) => {
    const newGame = args.join(' ').trim();
    if (!newGame) return 'Usage: !game <category name>';
    try {
      await twitchApi.updateChannelInfo(process.env.TWITCH_CHANNEL, { gameName: newGame });
      return `Category updated to: ${newGame}`;
    } catch (err) {
      logger.action('twitch-api', `!game failed: ${err.message}`, false);
      return `Could not update the category (${err.message}).`;
    }
  },
};

// Per-user-per-command cooldown tracking. Without periodic cleanup this
// would grow forever, one entry per distinct (command, username) pair ever
// seen -- same class of leak fixed in moderation.js's userState, so it
// gets the same treatment here from the start.
const lastUsed = new Map(); // key: `${cmd}:${username}` -> last-used timestamp
const COOLDOWN_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const cooldownCleanupTimer = setInterval(() => {
  const cooldowns = configStore.get('cooldowns');
  const maxSeconds = Math.max(
    (cooldowns && cooldowns.defaultSeconds) || 0,
    ...Object.values((cooldowns && cooldowns.perCommand) || {}),
    0
  );
  const cutoff = Date.now() - maxSeconds * 1000;
  for (const [key, time] of lastUsed) {
    if (time < cutoff) lastUsed.delete(key);
  }
}, COOLDOWN_CLEANUP_INTERVAL_MS);
cooldownCleanupTimer.unref();

// Returns true if `cmd` is allowed to run for `username` right now (and
// records this as a use); false if it's still on cooldown. Silent by
// design -- replying "you're on cooldown" would itself need its own
// cooldown to avoid becoming the very spam it's meant to prevent.
function checkCooldown(cmd, username) {
  const cooldowns = configStore.get('cooldowns');
  if (!cooldowns || !cooldowns.enabled) return true;
  const seconds = (cooldowns.perCommand && cooldowns.perCommand[cmd]) ?? cooldowns.defaultSeconds ?? 0;
  if (seconds <= 0) return true;

  const key = `${cmd}:${username}`;
  const now = Date.now();
  const last = lastUsed.get(key);
  if (last && now - last < seconds * 1000) return false;

  lastUsed.set(key, now);
  return true;
}

// message: { text, username, displayName, isMod, isBroadcaster }
// ctx: { reply(text) }
async function handle(message, ctx) {
  const text = message.text.trim();
  if (!text.startsWith(PREFIX)) return false;

  const [rawCmd, ...args] = text.slice(PREFIX.length).split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  if (!cmd) return false;

  const custom = configStore.get('commands') || {};
  const isBuiltin = Boolean(BUILTINS[cmd]);
  const isCustom = Object.prototype.hasOwnProperty.call(custom, cmd);
  if (!isBuiltin && !isCustom) return false;

  const logWho = `user=${message.username}`;

  if (isBuiltin && MOD_ONLY.has(cmd) && !message.isMod && !message.isBroadcaster) {
    await safeReply(ctx, 'only mods can use that command.', `!${cmd}`, logWho);
    return true;
  }

  // Mods/broadcaster bypass cooldowns entirely -- matches how moderation
  // exempts them, and mods legitimately need to be able to re-run commands
  // (like !so) back-to-back.
  if (!message.isMod && !message.isBroadcaster && !checkCooldown(cmd, message.username)) {
    logger.info('command-cooldown', `!${cmd} ${logWho} ignored (on cooldown)`);
    return true;
  }

  if (isBuiltin) {
    let result;
    try {
      result = await BUILTINS[cmd](message, args);
    } catch (err) {
      logger.action('command', `!${cmd} ${logWho} threw an error: ${err.message}`, false);
      return true;
    }
    await safeReply(ctx, result, `!${cmd}`, logWho);
    return true;
  }

  await safeReply(ctx, custom[cmd], `!${cmd}`, logWho);
  return true;
}

async function safeReply(ctx, message, cmdLabel, logWho) {
  try {
    await ctx.reply(message);
    logger.action('command', `${cmdLabel} ${logWho}`);
  } catch (err) {
    logger.action('command', `${cmdLabel} ${logWho} reply failed: ${err.message}`, false);
  }
}

module.exports = { handle, BUILTINS, buildShoutoutMessage };
