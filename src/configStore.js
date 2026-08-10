const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const CONFIG_DIR = process.env.TWITCH_BOT_CONFIG_DIR || paths.configDir;
// What the installer lays down in the program folder. On an installed copy
// this is a read-only template that seeds CONFIG_DIR once; in a checkout
// the two are the same directory and seeding does nothing.
const SHIPPED_CONFIG_DIR = path.join(paths.installRoot, 'config');

const FILES = {
  commands: 'commands.json',
  moderation: 'moderation.json',
  jokes: 'jokes.json',
  alerts: 'alerts.json',
  cooldowns: 'cooldowns.json',
  timers: 'timers.json',
};

const DEFAULTS = {
  commands: {},
  moderation: { enabled: false },
  jokes: [],
  alerts: { enabled: false, displaySeconds: 6, templates: {} },
  cooldowns: { enabled: false, defaultSeconds: 0, perCommand: {} },
  timers: { enabled: false, intervalMinutes: 15, messages: [] },
};

const state = {};
const listeners = { commands: [], moderation: [], jokes: [], alerts: [], cooldowns: [], timers: [] };
const watchers = [];

function loadFile(key) {
  const filePath = path.join(CONFIG_DIR, FILES[key]);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    state[key] = JSON.parse(raw);
  } catch (err) {
    console.error(`[config] Failed to load ${FILES[key]}: ${err.message}`);
    if (!state[key]) state[key] = DEFAULTS[key];
  }
}

// Copies any config file the user does not have yet from the shipped
// templates. Per-file rather than per-directory so a version that adds a
// new config file seeds just that one, and so an existing file is never
// overwritten: everything in here is user-edited and an upgrade that reset
// someone's commands would be worse than shipping no defaults at all.
function seedDefaults() {
  if (path.resolve(CONFIG_DIR) === path.resolve(SHIPPED_CONFIG_DIR)) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  for (const file of Object.values(FILES)) {
    const target = path.join(CONFIG_DIR, file);
    if (fs.existsSync(target)) continue;
    const source = path.join(SHIPPED_CONFIG_DIR, file);
    try {
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, target);
      } else {
        // No template shipped for this key, so write the in-code default.
        // Without a file on disk there is nothing for watchFile to watch.
        const key = Object.keys(FILES).find((k) => FILES[k] === file);
        fs.writeFileSync(target, `${JSON.stringify(DEFAULTS[key], null, 2)}\n`);
      }
    } catch (err) {
      console.error(`[config] Failed to seed ${file}: ${err.message}`);
    }
  }
}

function watchFile(key) {
  const filePath = path.join(CONFIG_DIR, FILES[key]);
  let debounce = null;
  let watcher;
  // Seeding can fail on a locked or unwritable directory, and fs.watch on
  // a file that is not there throws. Losing live reload for one file is
  // survivable; taking the whole bot down on startup is not.
  try {
    watcher = fs.watch(filePath, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        loadFile(key);
        console.log(`[config] Reloaded ${FILES[key]}`);
        listeners[key].forEach((cb) => cb(state[key]));
      }, 150);
    });
  } catch (err) {
    console.error(`[config] Not watching ${FILES[key]} for changes: ${err.message}`);
    return;
  }
  // A watched file can briefly disappear (e.g. an editor's save-via-rename),
  // which otherwise crashes the process with an unhandled 'error' event.
  watcher.on('error', (err) => console.error(`[config] Watcher error on ${FILES[key]}: ${err.message}`));
  watchers.push(watcher);
}

function init() {
  seedDefaults();
  Object.keys(FILES).forEach((key) => {
    loadFile(key);
    watchFile(key);
  });
}

function close() {
  watchers.forEach((w) => w.close());
  watchers.length = 0;
}

function get(key) {
  return state[key];
}

function onChange(key, cb) {
  listeners[key].push(cb);
}

module.exports = { init, get, onChange, close, seedDefaults, CONFIG_DIR };
