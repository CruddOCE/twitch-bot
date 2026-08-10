// Decides where the bot's writable state lives: the .env, the config JSON,
// the action log and the generated TTS audio.
//
// This module exists because the installed app lands in Program Files,
// which is not writable by the user running it. Every one of those four
// things used to sit inside the project folder, so an installed bot would
// fail the first time it tried to save a Twitch token. They now go to
// %APPDATA%\twitch-bot instead. Per-user rather than ProgramData is
// deliberate: the .env holds one person's OAuth token, so two Windows
// accounts on one PC must not share it.
//
// A git checkout keeps the old in-repo paths exactly as they were, so
// development behaves the way it always has and nothing needs a special
// dev mode flag.

const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTALL_ROOT = path.join(__dirname, '..');

// Presence of .git is what separates "someone is working on the bot" from
// "someone installed the bot". A release zip unpacked by hand has no .git
// either, and that is correct: it gets the same %APPDATA% treatment as a
// proper install, so its state survives being replaced by the installer.
function detectInstalled() {
  return !fs.existsSync(path.join(INSTALL_ROOT, '.git'));
}

function resolveRoamingDir() {
  // APPDATA is absent under some service accounts and stripped shells, so
  // fall back rather than joining onto undefined and writing to "\twitch-bot".
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

function resolveDataDir(installed) {
  if (process.env.TWITCH_BOT_DATA_DIR) return process.env.TWITCH_BOT_DATA_DIR;
  return installed ? path.join(resolveRoamingDir(), 'twitch-bot') : INSTALL_ROOT;
}

const isInstalled = detectInstalled();
const dataDir = resolveDataDir(isInstalled);

const envPath = path.join(dataDir, '.env');
const configDir = path.join(dataDir, 'config');
const logsDir = path.join(dataDir, 'logs');
// TTS output stays under a "public"-shaped path so the overlay's audio URLs
// keep the same /tts/<file> shape they had when this lived in public/tts.
const ttsDir = path.join(dataDir, 'public', 'tts');

let dataDirEnsured = false;

function ensureDataDir() {
  if (dataDirEnsured) return dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  dataDirEnsured = true;
  return dataDir;
}

// Upgrading an install that predates this split leaves the only copy of the
// user's token in the install folder, where nothing looks for it any more.
// Moving it across on first use is the difference between a silent upgrade
// and every user having to reconnect their Twitch account.
function migrateLegacyEnv() {
  if (!isInstalled) return false;
  const legacy = path.join(INSTALL_ROOT, '.env');
  if (fs.existsSync(envPath) || !fs.existsSync(legacy)) return false;
  try {
    ensureDataDir();
    fs.copyFileSync(legacy, envPath);
    return true;
  } catch (err) {
    // A failed migration must not stop the bot booting: the setup screen
    // can still write a fresh .env, which costs a reconnect and no more.
    console.error(`[paths] Could not migrate existing .env: ${err.message}`);
    return false;
  }
}

module.exports = {
  installRoot: INSTALL_ROOT,
  isInstalled,
  dataDir,
  envPath,
  configDir,
  logsDir,
  ttsDir,
  ensureDataDir,
  migrateLegacyEnv,
};
