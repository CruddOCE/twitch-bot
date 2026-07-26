// Server-side text-to-speech using Windows' built-in SAPI voices, rendered
// to a WAV file the overlay plays with the Web Audio API. This exists
// specifically because OBS's Browser Source generally exposes zero voices
// to the browser's own Web Speech API -- generating the audio ourselves
// sidesteps that limitation entirely, since audio file playback doesn't
// depend on OBS exposing any voices.
//
// Uses the compiled native/TtsHelper.cs (tts-helper.exe) rather than
// shelling out to PowerShell -- spawning powershell.exe and Add-Type-
// loading System.Speech from a script string measured ~650ms per call
// versus ~200ms for the compiled helper, just in host startup and
// reflection. Text and paths also arrive as real process arguments
// (execFile array) instead of being embedded in a PowerShell script
// string, so there's no shell-quoting to get right either.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TTS_DIR = path.join(__dirname, '..', 'public', 'tts');
const HELPER_PATH = path.join(__dirname, '..', 'tts-helper.exe');
const FILE_LIFETIME_MS = 30000;

let cachedVoices = null;
let voicesPromise = null;

function ensureDir() {
  if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true });
}

// The process can be restarted before a file's 30s self-delete timer
// fires (common during development) -- sweep out anything left over from
// a previous run on startup, rather than letting public/tts/ accumulate
// orphaned WAV files forever.
function cleanupStaleFiles() {
  if (!fs.existsSync(TTS_DIR)) return;
  try {
    for (const file of fs.readdirSync(TTS_DIR)) {
      fs.unlinkSync(path.join(TTS_DIR, file));
    }
  } catch (err) {
    // Best-effort; a leftover file or two isn't worth failing startup over.
  }
}
cleanupStaleFiles();

// Async so it never blocks the event loop (Twitch polling, the alert
// server, everything) -- the in-flight promise is cached too, so
// concurrent calls before the first one resolves don't spawn duplicate
// helper processes.
function getInstalledVoices() {
  if (cachedVoices) return Promise.resolve(cachedVoices);
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      execFile(HELPER_PATH, ['--list-voices'], { timeout: 10000 }, (err, stdout) => {
        cachedVoices = err ? [] : stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        resolve(cachedVoices);
      });
    });
  }
  return voicesPromise;
}

async function pickRandomVoice() {
  const voices = await getInstalledVoices();
  if (voices.length === 0) return null;
  return voices[Math.floor(Math.random() * voices.length)];
}

// Synthesizes `text` to a WAV file using a randomly chosen installed voice.
// Resolves with { url, voice }; the file is served at that URL via the
// existing public/ static route and deleted a bit after it should have
// finished playing.
async function synthesize(text) {
  ensureDir();
  const voice = await pickRandomVoice();
  const id = crypto.randomBytes(8).toString('hex');
  const filePath = path.join(TTS_DIR, `${id}.wav`);

  return new Promise((resolve, reject) => {
    execFile(HELPER_PATH, [filePath, text, voice || ''], { timeout: 15000 }, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ url: `/tts/${id}.wav`, voice });
      setTimeout(() => fs.unlink(filePath, () => {}), FILE_LIFETIME_MS);
    });
  });
}

module.exports = { synthesize, getInstalledVoices };
