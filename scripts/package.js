// Builds a standalone app for this computer's OS:
//   Windows: release/Cheeseee-win32-x64/Cheeseee.exe
//   macOS:   release/Cheeseee-darwin-<arm64|x64>/Cheeseee.app
// Optional: --arch arm64|x64 (macOS) to build for the other kind of Mac.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');
const { ensureEngine } = require('./get-stockfish');
const { BUILTIN_ENGINE_FILES, builtinEngineFile } = require('../src/main/builtin-engine');

const root = path.join(__dirname, '..');
const platform = process.platform;
const archIdx = process.argv.indexOf('--arch');
const arch = archIdx > -1 ? process.argv[archIdx + 1] : platform === 'darwin' ? process.arch : 'x64';

// engines/ holds every OS's Stockfish; keep only the one this build runs.
function findEngineDirs(dir, depth = 0) {
  if (depth > 6) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(dir, entry.name);
    if (entry.name === 'stockfish' && path.basename(dir) === 'engines') found.push(p);
    else found.push(...findEngineDirs(p, depth + 1));
  }
  return found;
}

async function removeOtherEngines({ buildPath, platform: target }) {
  const keep = builtinEngineFile(target);
  for (const dir of findEngineDirs(buildPath)) {
    for (const file of Object.values(BUILTIN_ENGINE_FILES)) {
      if (file !== keep) fs.rmSync(path.join(dir, file), { force: true });
    }
  }
}

(async () => {
  if (platform !== 'win32' && platform !== 'darwin') {
    throw new Error(`Packaging is set up for Windows and macOS, not "${platform}".`);
  }
  await ensureEngine({ platform });

  const out = await packager({
    dir: root,
    out: path.join(root, 'release'),
    name: 'Cheeseee',
    executableName: 'Cheeseee',
    platform,
    arch,
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(root, 'assets', 'icon'), // packager adds .ico or .icns
    extraResource: [path.join(root, 'engines'), ...(platform === 'win32' ? [path.join(root, 'bin')] : [])],
    afterCopyExtraResources: [removeOtherEngines],
    appCopyright: 'Cheeseee · Stockfish is GPL-3.0 (see resources/engines/stockfish)',
    ...(platform === 'win32' && {
      win32metadata: { FileDescription: 'Cheeseee chess overlay', ProductName: 'Cheeseee', CompanyName: 'Cheeseee' },
    }),
    ...(platform === 'darwin' && {
      appBundleId: 'com.cheeseee.overlay',
      appCategoryType: 'public.app-category.board-games',
    }),
    ignore: [
      /^\/release($|\/)/,
      /^\/engines($|\/)/,
      /^\/scripts($|\/)/,
      /^\/src\/renderer($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.claude($|\/)/,
      /\.map$/,
    ],
  });
  if (platform === 'darwin') {
    // Packaging edits Electron's bundle, which breaks its signature. Re-sign it locally
    // ("-" = ad-hoc, no Apple account needed) so macOS can remember permissions such as
    // Screen Recording between launches instead of asking every time.
    for (const dir of out) {
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(dir, 'Cheeseee.app')], { stdio: 'inherit' });
    }
  }
  console.log('Packaged to', out.join(', '));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
