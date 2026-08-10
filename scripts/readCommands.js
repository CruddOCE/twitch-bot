// Prints every command the bot answers to, for the control panel's Commands
// view to render.
//
// One line per command, with the free-text fields base64-encoded for the same
// reason src/chatEmit.js does it: a response can contain the "|" delimiter, or
// anything else, and escaping it would mean the panel needed an unescaper.
//
//   @@CMD@@|<b64 name>|<b64 response>|<cooldown or empty>|<1 if built in>
//
// Built-in commands are listed too, locked on the panel side. A list showing
// only half the commands that exist sends someone to the JSON file to find out
// why !uptime is missing from it, which is the trip this feature exists to
// save. Their cooldowns are still editable, because checkCooldown() in
// src/commands.js applies perCommand to builtins exactly as it does to custom
// ones.
//
// Reads the files directly rather than going through configStore.get(), which
// would need init() and leave a file watcher running in a one-shot script.
//
// Usage: node scripts/readCommands.js

const fs = require('fs');
const path = require('path');
const configStore = require('../src/configStore');
const { BUILTINS } = require('../src/commands');

// Descriptions live here rather than next to each builtin, because they are a
// display concern the bot itself has no use for. Names still come from
// BUILTINS, so a builtin added without a description here still shows up in
// the panel; it just describes itself as built in and nothing worse.
const DESCRIPTIONS = {
  uptime: 'How long the bot has been running.',
  commands: 'Lists every command, built in and custom.',
  joke: 'Random line from config/jokes.json, with an alert and TTS.',
  pp: 'The joke roll. Announces a length and a girth.',
  so: 'Shouts out a channel. Mods only. Also fires automatically on a raid.',
  lurk: 'Marks someone as lurking.',
  unlurk: 'Welcomes them back.',
  title: 'Sets the stream title. Mods only.',
  game: 'Sets the stream category. Mods only.',
};

function b64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function readJson(file, fallback) {
  const target = path.join(configStore.CONFIG_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    // A missing cooldowns.json is survivable and means "no cooldowns". A
    // missing or corrupt commands.json is not, and is reported by the caller.
    if (fallback === undefined) throw err;
    return fallback;
  }
}

function emit(name, response, cooldown, isBuiltin) {
  const seconds = cooldown === undefined || cooldown === null ? '' : cooldown;
  console.log(`@@CMD@@|${b64(name)}|${b64(response)}|${seconds}|${isBuiltin ? 1 : 0}`);
}

function main() {
  let custom;
  try {
    custom = readJson('commands.json');
  } catch (err) {
    console.log(`COMMANDS_READ_FAILED=${err.message}`);
    process.exit(1);
    return;
  }

  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
    console.log('COMMANDS_READ_FAILED=commands.json is not a { "name": "response" } object');
    process.exit(1);
    return;
  }

  const cooldowns = readJson('cooldowns.json', {});
  const perCommand = (cooldowns && cooldowns.perCommand) || {};

  let count = 0;

  // Builtins first and in their own order, so the list opens on the commands
  // that are always there rather than on whatever the JSON happens to hold.
  for (const name of Object.keys(BUILTINS)) {
    emit(name, DESCRIPTIONS[name] || 'Built in.', perCommand[name], true);
    count += 1;
  }

  for (const name of Object.keys(custom).sort()) {
    emit(name, custom[name], perCommand[name], false);
    count += 1;
  }

  console.log(`COMMANDS_READ_OK=${count}`);
}

main();
