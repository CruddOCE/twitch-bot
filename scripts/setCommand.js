// Adds, edits, renames or deletes a custom command, and its cooldown with it.
//
// Driven by the control panel's Commands view, which passes everything as
// environment variables. A script rather than C# doing it directly, for two
// reasons. The panel is compiled by the OS-bundled csc against five framework
// references and none of them is a JSON library, so the alternative is a
// hand-rolled parser owning every escaping bug in it. And this is the only
// shape that can be tested: GUI text fields could not be driven by any
// automation tried on this project (see HANDOFF.md), so running the script
// with the same variables the button passes is how these paths get exercised.
//
// The write is deliberately a plain writeFileSync over the existing file, and
// must stay that way. An atomic write (temp file, rename over the target) is
// the usual correct answer and is the wrong answer here: configStore watches
// each config file with fs.watch, and renaming over a watched file on Windows
// drops the watch. Live reload would then die silently and stay dead until the
// bot restarted, which is precisely the failure that makes an editor feel
// broken. A test pins this.
//
// Usage:
//   COMMAND_ACTION=save   COMMAND_NAME=discord COMMAND_RESPONSE="..." node scripts/setCommand.js
//   COMMAND_ACTION=save   COMMAND_NAME=discord COMMAND_RESPONSE="..." COMMAND_COOLDOWN=30 node scripts/setCommand.js
//   COMMAND_ACTION=rename COMMAND_NAME=disc COMMAND_NEW_NAME=discord node scripts/setCommand.js
//   COMMAND_ACTION=delete COMMAND_NAME=discord node scripts/setCommand.js
//   COMMAND_ACTION=cooldown COMMAND_NAME=so COMMAND_COOLDOWN=15 node scripts/setCommand.js
//
// On save, an absent or empty COMMAND_COOLDOWN means "no override for this
// command", so it falls back to defaultSeconds. There is no third state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const configStore = require('../src/configStore');
const { BUILTINS } = require('../src/commands');

// Anything outside this is unreachable from chat: handle() lowercases the
// command and splits the message on whitespace, so a capital or a space means
// the command can never fire. Saving one would look like it worked and then
// never answer, which is worse than refusing it here.
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_NAME_LENGTH = 25;
// Twitch's own per-message cap.
const MAX_RESPONSE_LENGTH = 500;
const MAX_COOLDOWN_SECONDS = 3600;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function configPath(file) {
  return path.join(configStore.CONFIG_DIR, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(configPath(file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    fail(`Could not read ${file}: ${err.message}`);
    return fallback;
  }
}

// Matches whatever the file already uses rather than picking a side. In a
// checkout git has core.autocrlf on, so these arrive as CRLF; writing LF makes
// every edit from the panel show up as a modified file with an empty diff,
// which is exactly the kind of noise that trains someone to ignore git status.
// An installed copy has no git and no opinion, so preserving is safe there too.
function lineEndingOf(file) {
  try {
    return /\r\n/.test(fs.readFileSync(configPath(file), 'utf8')) ? '\r\n' : '\n';
  } catch (err) {
    return os.EOL;
  }
}

function writeJson(file, value) {
  const eol = lineEndingOf(file);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(configPath(file), eol === '\n' ? text : text.replace(/\n/g, '\r\n'));
}

// Returns the name lowercased, or exits. `label` names the field so a rename
// failure says which of the two names was the problem.
//
// allowBuiltin is set when the name is something being removed rather than
// created. A commands.json hand-edited to hold a builtin's name is exactly the
// entry someone needs to delete or rename away, and refusing to touch it would
// leave the panel unable to fix the one thing it is best placed to fix.
function requireValidName(raw, label, allowBuiltin) {
  const name = String(raw || '').trim().toLowerCase();
  if (!name) fail(`${label} is required.`);
  if (name.length > MAX_NAME_LENGTH) {
    fail(`${label} "${name}" is longer than ${MAX_NAME_LENGTH} characters.`);
  }
  if (!NAME_PATTERN.test(name)) {
    fail(`${label} "${name}" can only use letters, numbers, hyphens and underscores, and must start with a letter or number.`);
  }
  // handle() checks BUILTINS before the custom map, so a custom command with a
  // builtin's name is accepted by the file and then silently never fires.
  if (!allowBuiltin && Object.prototype.hasOwnProperty.call(BUILTINS, name)) {
    fail(`"${name}" is a built-in command. Pick a different name, since a custom one with this name would never run.`);
  }
  return name;
}

function requireValidResponse(raw) {
  const response = String(raw || '').trim();
  if (!response) fail('COMMAND_RESPONSE is required and cannot be blank.');
  if (response.length > MAX_RESPONSE_LENGTH) {
    fail(`COMMAND_RESPONSE is ${response.length} characters. Twitch caps a message at ${MAX_RESPONSE_LENGTH}.`);
  }
  // A chat message is one line. A newline here would either be dropped or
  // split the message, neither of which is what the person typing it meant.
  if (/[\r\n]/.test(response)) fail('COMMAND_RESPONSE cannot contain a line break: a chat message is a single line.');
  return response;
}

// Returns a number, or null for "no override". Empty and absent mean the same
// thing on purpose: the panel's field is blank when there is no override, and
// two ways to say nothing would need two ways to clear it.
function readCooldown() {
  const raw = String(process.env.COMMAND_COOLDOWN || '').trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) fail(`COMMAND_COOLDOWN must be a whole number of seconds, not "${raw}".`);
  const seconds = parseInt(raw, 10);
  if (seconds > MAX_COOLDOWN_SECONDS) {
    fail(`COMMAND_COOLDOWN is ${seconds}s. The ceiling is ${MAX_COOLDOWN_SECONDS}s (one hour).`);
  }
  return seconds;
}

// cooldowns.json is only rewritten when something in it actually changed, so
// an ordinary save does not touch a second file and trigger a second reload in
// the running bot.
function applyCooldown(name, seconds) {
  const cooldowns = readJson('cooldowns.json', { enabled: false, defaultSeconds: 0, perCommand: {} });
  if (!cooldowns.perCommand || typeof cooldowns.perCommand !== 'object') cooldowns.perCommand = {};

  const before = cooldowns.perCommand[name];
  if (seconds === null) {
    if (before === undefined) return false;
    delete cooldowns.perCommand[name];
  } else {
    if (before === seconds) return false;
    cooldowns.perCommand[name] = seconds;
  }

  writeJson('cooldowns.json', cooldowns);
  return true;
}

function moveCooldown(from, to) {
  const cooldowns = readJson('cooldowns.json', { enabled: false, defaultSeconds: 0, perCommand: {} });
  if (!cooldowns.perCommand || typeof cooldowns.perCommand !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(cooldowns.perCommand, from)) return false;

  cooldowns.perCommand[to] = cooldowns.perCommand[from];
  delete cooldowns.perCommand[from];
  writeJson('cooldowns.json', cooldowns);
  return true;
}

function loadCommands() {
  const commands = readJson('commands.json', {});
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    fail('commands.json is not a { "name": "response" } object. Fix it by hand before editing from the panel.');
  }
  return commands;
}

function save() {
  const typed = String(process.env.COMMAND_NAME || '').trim();
  const name = requireValidName(typed, 'COMMAND_NAME');
  const response = requireValidResponse(process.env.COMMAND_RESPONSE);
  const cooldown = readCooldown();

  // Lowercasing is a fix, not a rejection: handle() lowercases before it
  // looks the command up, so "MyCmd" would be saved as a key nothing can
  // ever match. Say so rather than doing it silently, or the command in the
  // list will not be the one that was typed into the box.
  if (typed !== name) console.log(`Saved as !${name}: commands are always lower case.`);

  const commands = loadCommands();
  const existed = Object.prototype.hasOwnProperty.call(commands, name);
  commands[name] = response;
  writeJson('commands.json', commands);

  const cooldownChanged = applyCooldown(name, cooldown);
  console.log(`${existed ? 'Updated' : 'Added'} !${name}`);
  if (cooldownChanged) {
    console.log(cooldown === null ? `Cleared the cooldown on !${name}` : `Cooldown on !${name} set to ${cooldown}s`);
  }
  console.log(`COMMAND_SAVE_OK=${name}`);
}

function rename() {
  const from = requireValidName(process.env.COMMAND_NAME, 'COMMAND_NAME', true);
  const to = requireValidName(process.env.COMMAND_NEW_NAME, 'COMMAND_NEW_NAME', false);
  if (from === to) fail('The new name is the same as the old one.');

  const commands = loadCommands();
  if (!Object.prototype.hasOwnProperty.call(commands, from)) fail(`There is no custom command called "${from}".`);
  if (Object.prototype.hasOwnProperty.call(commands, to)) fail(`There is already a command called "${to}".`);

  // Rebuilt in order rather than delete-then-add, so renaming a command does
  // not move it to the bottom of the file and make the diff look like a
  // reordering of everything under it.
  const renamed = {};
  for (const key of Object.keys(commands)) {
    if (key === from) renamed[to] = commands[from];
    else renamed[key] = commands[key];
  }
  writeJson('commands.json', renamed);

  // Without this the cooldown stays keyed to a command that no longer exists,
  // and the renamed one silently falls back to defaultSeconds.
  const moved = moveCooldown(from, to);
  console.log(`Renamed !${from} to !${to}`);
  if (moved) console.log(`Moved its cooldown across to !${to}`);
  console.log(`COMMAND_RENAME_OK=${from}->${to}`);
}

function remove() {
  const name = requireValidName(process.env.COMMAND_NAME, 'COMMAND_NAME', true);
  const commands = loadCommands();
  if (!Object.prototype.hasOwnProperty.call(commands, name)) fail(`There is no custom command called "${name}".`);

  delete commands[name];
  writeJson('commands.json', commands);

  const cooldownChanged = applyCooldown(name, null);
  console.log(`Deleted !${name}`);
  if (cooldownChanged) console.log('Removed its cooldown entry too');
  console.log(`COMMAND_DELETE_OK=${name}`);
}

// Cooldown-only, for a built-in command. Its reply lives in the bot's code so
// there is nothing in commands.json to save, but checkCooldown() applies
// perCommand to builtins exactly as it does to custom ones, so !so having a
// 10s cooldown is a real setting someone needs to be able to change. Routing
// this through `save` instead would hit the shadow guard, and correctly so.
function setCooldownOnly() {
  const name = requireValidName(process.env.COMMAND_NAME, 'COMMAND_NAME', true);
  const known = Object.prototype.hasOwnProperty.call(BUILTINS, name)
    || Object.prototype.hasOwnProperty.call(loadCommands(), name);
  if (!known) fail(`There is no command called "${name}".`);

  const cooldown = readCooldown();
  const changed = applyCooldown(name, cooldown);
  if (!changed) console.log(`Cooldown on !${name} is already what you asked for`);
  else if (cooldown === null) console.log(`Cleared the cooldown on !${name}`);
  else console.log(`Cooldown on !${name} set to ${cooldown}s`);
  console.log(`COMMAND_COOLDOWN_OK=${name}`);
}

function main() {
  const action = String(process.env.COMMAND_ACTION || '').trim().toLowerCase();
  if (action === 'save') return save();
  if (action === 'rename') return rename();
  if (action === 'delete') return remove();
  if (action === 'cooldown') return setCooldownOnly();
  return fail('COMMAND_ACTION must be save, rename, delete or cooldown.');
}

main();
