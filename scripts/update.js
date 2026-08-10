// Updates this install to the latest version published on GitHub.
//
// Two ways in, matching scripts/checkUpdate.js:
//
// A git checkout stashes any local edits first (e.g. your customized
// config/*.json), pulls, then reapplies those edits -- your customizations
// are preserved, or on a genuine conflict, left for you to resolve rather
// than silently lost. Then reinstalls dependencies in case package.json
// changed.
//
// An installed copy has no .git, so instead it downloads the latest
// release's installer and stops there, leaving it at a fixed path for the
// control panel to run once this process (and the panel itself) have
// exited. It deliberately does not launch the installer: this script runs
// under the bundled runtime\node.exe, and Windows will not let the
// installer overwrite that exe while it is still running.
//
// Usage: node scripts/update.js

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const logger = require('../src/logger');
const paths = require('../src/paths');
const release = require('../src/release');

const ROOT = paths.installRoot;

function resolveExe(candidates, fallback) {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return fallback;
}

function resolveGit() {
  return resolveExe(['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe'], 'git');
}

function resolveNpm() {
  return resolveExe(['C:\\Program Files\\nodejs\\npm.cmd', 'C:\\Program Files (x86)\\nodejs\\npm.cmd'], 'npm');
}

function run(cmd, args) {
  console.log(`> ${path.basename(cmd)} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
}

async function updateFromRelease() {
  console.log('Checking GitHub for a newer release...');
  let latest;
  try {
    latest = await release.fetchLatest();
  } catch (err) {
    console.error(`FAILED to check for releases: ${err.message}`);
    logger.action('update', `Release check failed: ${err.message}`, false);
    process.exitCode = 1;
    return;
  }

  if (!latest.isNewer) {
    console.log(`Already up to date (version ${release.currentVersion()}).`);
    logger.action('update', 'Already up to date');
    return;
  }
  if (!latest.assetUrl) {
    console.error(`Release ${latest.tag} has no installer attached. Download it manually: ${release.RELEASES_PAGE}`);
    logger.action('update', `Release ${latest.tag} has no installer asset`, false);
    process.exitCode = 1;
    return;
  }

  console.log(`Downloading version ${latest.version}...`);
  try {
    const file = await release.downloadInstaller(latest.assetUrl);
    console.log(`Downloaded to ${file}`);
    console.log('SUCCESS: the installer will now run and reopen the app.');
    logger.action('update', `Downloaded installer for ${latest.tag}`);
  } catch (err) {
    console.error(`FAILED to download the update: ${err.message}`);
    logger.action('update', `Installer download failed: ${err.message}`, false);
    process.exitCode = 1;
  }
}

function updateGitCheckout() {
  const git = resolveGit();

  console.log('Checking for local changes...');
  let status;
  try {
    status = run(git, ['status', '--porcelain']).trim();
  } catch (err) {
    console.error('FAILED: this does not look like a git checkout, or git is not available.');
    console.error(err.message);
    logger.action('update', `git status failed: ${err.message}`, false);
    process.exitCode = 1;
    return;
  }
  const hasLocalChanges = status.length > 0;

  if (hasLocalChanges) {
    console.log('Local changes found (likely your custom config/*.json) -- stashing them so they are not lost...');
    try {
      run(git, ['stash', 'push', '-u', '-m', 'twitch-bot auto-update']);
    } catch (err) {
      console.error('FAILED to stash local changes:', err.message);
      logger.action('update', `Stash failed: ${err.message}`, false);
      process.exitCode = 1;
      return;
    }
  }

  console.log('Pulling latest changes from GitHub...');
  try {
    console.log(run(git, ['pull', '--ff-only']));
  } catch (err) {
    console.error('FAILED to pull:', err.message);
    logger.action('update', `git pull failed: ${err.message}`, false);
    if (hasLocalChanges) {
      console.log('Restoring your local changes...');
      try {
        run(git, ['stash', 'pop']);
      } catch (e) {
        console.error('Also failed to restore your stashed local changes -- run `git stash list` to find them:', e.message);
      }
    }
    process.exitCode = 1;
    return;
  }

  if (hasLocalChanges) {
    console.log('Reapplying your local changes...');
    try {
      run(git, ['stash', 'pop']);
    } catch (err) {
      console.error('Your local changes conflict with the update. Nothing was lost -- run `git status` to resolve manually.');
      console.error(err.message);
      logger.action('update', `Stash pop conflict: ${err.message}`, false);
      process.exitCode = 1;
      return;
    }
  }

  console.log('Installing any new dependencies...');
  try {
    // npm.cmd is a batch-file wrapper, not a native exe -- execFileSync
    // can't run it directly on Windows (fails with EINVAL). execSync
    // always goes through a shell, which handles .cmd files correctly.
    const npmCmd = resolveNpm();
    console.log(`> ${path.basename(npmCmd)} install`);
    console.log(execSync(`"${npmCmd}" install`, { cwd: ROOT, encoding: 'utf8' }));
  } catch (err) {
    console.error('npm install failed:', err.message);
    logger.action('update', `npm install failed: ${err.message}`, false);
    process.exitCode = 1;
    return;
  }

  console.log('SUCCESS: Update complete.');
  logger.action('update', 'Update completed successfully');
}

function main() {
  if (paths.isInstalled) return updateFromRelease();
  updateGitCheckout();
  return Promise.resolve();
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
});
