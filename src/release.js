// Looks up the newest published release on GitHub and downloads its
// installer.
//
// An installed copy has no .git, so the git pull path that updates a
// checkout has nothing to work with. This is the other half: ask the
// Releases API what the latest version is, and if it is newer than the one
// running, fetch that release's setup exe so the installer can lay it down
// over the top.
//
// Deliberately unauthenticated. The repo is public and the anonymous rate
// limit (60/hour/IP) is far more than a launch-time check needs.

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const REPO = 'CruddOCE/twitch-bot';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
// GitHub rejects API requests with no User-Agent, with a 403 that reads
// nothing like the real cause.
const USER_AGENT = 'twitch-bot-updater';
const TIMEOUT_MS = 15000;

// Where a downloaded installer lands. Fixed, because the control panel
// runs it from a cmd chain after this process has exited and can only do
// that if it already knows the name.
const UPDATE_DIR = path.join(os.tmpdir(), 'twitch-bot-update');
const INSTALLER_PATH = path.join(UPDATE_DIR, 'twitch-bot-setup.exe');

function currentVersion() {
  return require('../package.json').version;
}

// Compares two dotted version strings. Returns 1 when a is newer than b,
// -1 when older, 0 when equal. Missing parts count as 0, so 0.7 and 0.7.0
// compare equal rather than the shorter one losing.
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// Follows redirects itself: asset downloads always redirect off github.com
// to a signed object-storage URL, and node's https does not follow them.
function get(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } }, (res) => {
      const status = res.statusCode;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('too many redirects'));
          return;
        }
        resolve(get(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

function readAll(res) {
  return new Promise((resolve, reject) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve(body));
    res.on('error', reject);
  });
}

// Resolves with { version, tag, assetUrl, assetName, isNewer }. assetUrl is
// null when a release exists but publishes no installer, which is a real
// case worth reporting differently from "no release at all".
async function fetchLatest() {
  const res = await get(LATEST_URL);
  const data = JSON.parse(await readAll(res));
  const tag = data.tag_name || '';
  if (!tag) throw new Error('release has no tag');
  const version = tag.replace(/^v/, '');
  const asset = (data.assets || []).find((a) => /^twitch-bot-setup.*\.exe$/i.test(a.name || ''));
  return {
    version,
    tag,
    assetUrl: asset ? asset.browser_download_url : null,
    assetName: asset ? asset.name : null,
    isNewer: compareVersions(version, currentVersion()) > 0,
  };
}

// Downloads the installer and returns its path. Verifies the result is
// actually a Windows executable, because a proxy or a captive portal
// answering with an HTML error page still arrives as a 200 and would
// otherwise be handed to the shell to run.
//
// The path is fixed rather than derived from the asset name because the
// control panel's post-exit command chain has to name this file literally,
// with no way to read a path back out of this process.
async function downloadInstaller(assetUrl) {
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  const target = INSTALLER_PATH;
  if (fs.existsSync(target)) fs.unlinkSync(target);
  const res = await get(assetUrl);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });

  const handle = fs.openSync(target, 'r');
  const magic = Buffer.alloc(2);
  fs.readSync(handle, magic, 0, 2, 0);
  fs.closeSync(handle);
  if (magic.toString('latin1') !== 'MZ') {
    fs.unlinkSync(target);
    throw new Error('downloaded file is not a Windows installer');
  }

  return target;
}

module.exports = {
  REPO,
  RELEASES_PAGE,
  UPDATE_DIR,
  INSTALLER_PATH,
  currentVersion,
  compareVersions,
  fetchLatest,
  downloadInstaller,
};
