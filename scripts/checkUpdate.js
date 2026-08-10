// Reports whether this install is behind, without changing anything.
// Deliberately read-only: scripts/update.js is the only thing that touches
// the working tree, because a running .exe can't be overwritten by git and
// a surprise pull mid-stream is the worst possible time to find that out.
//
// Two ways to be behind, depending on how the bot got here:
//   - a git checkout compares against its upstream branch
//   - an installed copy has no .git, so it asks the GitHub Releases API
//     whether a newer version has been published
//
// Prints exactly one machine-readable line for the control panel to parse:
//   UPDATE_AVAILABLE=<n>   n commits (or 1 release) behind, 0 when up to date
//   UPDATE_CHECK_FAILED=<reason>
//
// Usage: node scripts/checkUpdate.js

const fs = require('fs');
const { execFileSync } = require('child_process');
const paths = require('../src/paths');
const release = require('../src/release');

const ROOT = paths.installRoot;

function resolveGit() {
  const candidates = ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'git';
}

function git(args) {
  return execFileSync(resolveGit(), args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function checkGit() {
  try {
    // Fetch first or the count below compares against a stale remote ref
    // and reports "up to date" forever.
    git(['fetch', '--quiet']);
  } catch (err) {
    // Offline is the common case here and is not an error worth shouting
    // about; the panel just says nothing.
    console.log(`UPDATE_CHECK_FAILED=fetch: ${err.message.split('\n')[0]}`);
    return;
  }

  try {
    const behind = git(['rev-list', '--count', 'HEAD..@{u}']);
    console.log(`UPDATE_AVAILABLE=${Number(behind) || 0}`);
  } catch (err) {
    console.log(`UPDATE_CHECK_FAILED=no upstream: ${err.message.split('\n')[0]}`);
  }
}

async function checkRelease() {
  let latest;
  try {
    latest = await release.fetchLatest();
  } catch (err) {
    console.log(`UPDATE_CHECK_FAILED=releases: ${err.message.split('\n')[0]}`);
    return;
  }

  if (!latest.isNewer) {
    console.log('UPDATE_AVAILABLE=0');
    return;
  }
  if (!latest.assetUrl) {
    // A newer version exists but has no installer attached, so pressing
    // Update could not do anything. Saying so beats offering a dead button.
    console.log(`UPDATE_CHECK_FAILED=release ${latest.tag} has no installer attached`);
    return;
  }
  // The panel only reads this as "something is available", so the count is
  // releases behind rather than commits: one newer version is one update.
  console.log('UPDATE_AVAILABLE=1');
}

function main() {
  if (paths.isInstalled) {
    checkRelease();
    return;
  }
  checkGit();
}

main();
