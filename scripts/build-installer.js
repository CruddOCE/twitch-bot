// Builds the Windows installer pack: dist/twitch-bot-setup-<version>.exe.
//
// Stages a clean copy of the app in a temp folder rather than compiling
// straight out of the working tree. That is the whole point of the staging
// step: the working tree holds a real .env with a live Twitch token, a log
// file, and the versions/ archive, none of which can be allowed anywhere
// near a public installer. An allowlist means a new secret file added at
// the project root is excluded by default rather than shipped by accident.
//
// The payload bundles node.exe from the local Node install, so the finished
// installer needs nothing at all on the target machine: no Node, no npm, no
// git, no internet.
//
// Requires Inno Setup 6.3 or newer (winget install JRSoftware.InnoSetup).
//
// Usage: npm run build-installer

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(os.tmpdir(), 'twitch-bot-installer-build');
const PAYLOAD_DIR = path.join(BUILD_DIR, 'payload');
const OUT_DIR = path.join(BUILD_DIR, 'out');
const DIST_DIR = path.join(ROOT, 'dist');
const ISS_PATH = path.join(ROOT, 'installer', 'twitch-bot.iss');

// Everything the installed app needs at runtime, and nothing else.
// node_modules is absent deliberately: it is installed fresh into the
// staging folder so the payload carries production dependencies only,
// whatever the working tree happens to have in it.
const PAYLOAD_ENTRIES = [
  'index.js',
  'package.json',
  'package-lock.json',
  'README.md',
  'CHANGELOG.md',
  '.env.example',
  'src',
  'scripts',
  'config',
  'public',
  'bin',
];

// Paths inside the entries above that must still be left out. public/tts is
// generated audio. The batch files and the standalone uninstaller exe serve
// the checkout flow only: an installed copy is removed through Add/Remove
// Programs, and shipping a second uninstaller that does something slightly
// different is how someone ends up with a half-removed install.
const PAYLOAD_EXCLUDE = [
  path.join('public', 'tts'),
  path.join('bin', 'install-and-start.bat'),
  path.join('bin', 'uninstall.bat'),
  path.join('bin', 'uninstall-twitch-bot.exe'),
  // Build and checkout tooling. Neither can run in an installed copy: this
  // script needs the installer/ sources that are not shipped, and the
  // uninstall script is the checkout's answer to a job Add/Remove Programs
  // owns here. Nothing in the app calls either one.
  path.join('scripts', 'build-installer.js'),
  path.join('scripts', 'uninstall.js'),
];

// The per-user path is listed first on purpose. Inno Setup's own installer
// only writes to Program Files when it is run elevated; run normally it
// lands under %LOCALAPPDATA%\Programs, which is where every guide's
// "Program Files (x86)\Inno Setup 6" path stops being true.
function resolveIscc() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveNodeExe() {
  // process.execPath is the node running this script, which is the same
  // runtime the developer is testing against. Using it means the bundled
  // version is never a surprise.
  return process.execPath;
}

function rimraf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

// The payload takes bin/twitch-bot-control.exe as it finds it, and nothing
// downstream can tell that it was compiled from older source: the version
// the panel shows is a const baked into the C#, so a stale exe ships a
// stale version number and every test still passes. Caught exactly that way
// once, on 0.7.0, which is why this check exists.
function assertPanelIsCurrent() {
  const exe = path.join(ROOT, 'bin', 'twitch-bot-control.exe');
  const source = path.join(ROOT, 'installer', 'ControlProgram.cs');
  if (!fs.existsSync(exe)) {
    throw new Error(`${exe} is missing. Compile the control panel before building the installer.`);
  }
  if (fs.statSync(source).mtimeMs > fs.statSync(exe).mtimeMs) {
    throw new Error(
      'bin\\twitch-bot-control.exe is older than installer\\ControlProgram.cs.\n' +
      'Recompile the panel first, or the installer ships a stale build (see README, Building the installer).'
    );
  }
}

function stagePayload() {
  rimraf(BUILD_DIR);
  fs.mkdirSync(PAYLOAD_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const entry of PAYLOAD_ENTRIES) {
    const source = path.join(ROOT, entry);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing payload entry: ${entry}`);
    }
    fs.cpSync(source, path.join(PAYLOAD_DIR, entry), {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(ROOT, src);
        return !PAYLOAD_EXCLUDE.some((ex) => rel === ex || rel.startsWith(`${ex}${path.sep}`));
      },
    });
  }

  // A stray .env or .git copied in would break both the secret boundary and
  // the checkout detection in src/paths.js, so assert rather than trust the
  // allowlist to have stayed correct.
  for (const name of ['.env', '.git']) {
    if (fs.existsSync(path.join(PAYLOAD_DIR, name))) {
      throw new Error(`Refusing to build: ${name} ended up in the payload`);
    }
  }
}

function installProductionDeps() {
  console.log('> npm ci --omit=dev (in the staging folder)');
  // npm.cmd is a batch wrapper, so it needs a shell rather than execFile.
  execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: PAYLOAD_DIR, stdio: 'inherit' });
}

function bundleRuntime() {
  const nodeExe = resolveNodeExe();
  const runtimeDir = path.join(PAYLOAD_DIR, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(nodeExe, path.join(runtimeDir, 'node.exe'));

  const version = process.version;
  const licenseSource = path.join(path.dirname(nodeExe), 'LICENSE');
  if (fs.existsSync(licenseSource)) {
    fs.copyFileSync(licenseSource, path.join(runtimeDir, 'LICENSE-node.txt'));
  } else {
    // The Windows MSI does not lay down a LICENSE file, so point at the
    // canonical one for the exact version shipped rather than omitting
    // attribution entirely.
    fs.writeFileSync(
      path.join(runtimeDir, 'LICENSE-node.txt'),
      [
        `This folder contains node.exe from Node.js ${version}, redistributed unmodified.`,
        '',
        `Node.js is MIT licensed. The full text for this version is at:`,
        `https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`,
        '',
      ].join('\n')
    );
  }
  fs.writeFileSync(path.join(runtimeDir, 'VERSION.txt'), `${version}\n`);
  console.log(`Bundled Node ${version} runtime.`);
}

function compile(version) {
  const iscc = resolveIscc();
  if (!iscc) {
    throw new Error(
      'Inno Setup was not found. Install it with:\n  winget install JRSoftware.InnoSetup\n' +
      'Looked for ISCC.exe under "Inno Setup 6" in both Program Files folders.'
    );
  }

  console.log(`> ${path.basename(iscc)} ${path.basename(ISS_PATH)}`);
  execFileSync(iscc, [
    `/DAppVersion=${version}`,
    `/DPayloadDir=${PAYLOAD_DIR}`,
    ISS_PATH,
  ], { stdio: 'inherit' });
}

function publish(version) {
  const built = path.join(OUT_DIR, `twitch-bot-setup-${version}.exe`);
  if (!fs.existsSync(built)) {
    throw new Error(`Inno Setup reported success but ${built} is not there.`);
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const final = path.join(DIST_DIR, `twitch-bot-setup-${version}.exe`);
  fs.copyFileSync(built, final);
  const mb = (fs.statSync(final).size / (1024 * 1024)).toFixed(1);
  console.log(`\nSUCCESS: ${final} (${mb} MB)`);
}

function main() {
  const version = require('../package.json').version;
  console.log(`Building the twitch-bot installer pack, version ${version}.\n`);

  try {
    assertPanelIsCurrent();
    stagePayload();
    installProductionDeps();
    bundleRuntime();
    compile(version);
    publish(version);
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
