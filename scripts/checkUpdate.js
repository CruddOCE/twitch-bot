// Reports whether this install is behind GitHub, without changing
// anything. Deliberately read-only: scripts/update.js is the only thing
// that touches the working tree, because a running .exe can't be
// overwritten by git and a surprise pull mid-stream is the worst possible
// time to find that out.
//
// Prints exactly one machine-readable line for the control panel to parse:
//   UPDATE_AVAILABLE=<n>   n commits behind, 0 when up to date
//   UPDATE_CHECK_FAILED=<reason>
//
// Usage: node scripts/checkUpdate.js

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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

function main() {
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
    // No upstream configured, or not a git checkout at all (someone
    // unzipped a release instead of cloning). Either way there is nothing
    // to check against.
    console.log(`UPDATE_CHECK_FAILED=no upstream: ${err.message.split('\n')[0]}`);
  }
}

main();
