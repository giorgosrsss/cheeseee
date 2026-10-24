// Builds release/Cheeseee-win32-x64/Cheeseee.exe (a standalone Windows app folder).
const path = require('path');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');

(async () => {
  const out = await packager({
    dir: root,
    out: path.join(root, 'release'),
    name: 'Cheeseee',
    executableName: 'Cheeseee',
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(root, 'assets', 'icon.ico'),
    extraResource: [path.join(root, 'engines'), path.join(root, 'bin')],
    appCopyright: 'Cheeseee · Stockfish is GPL-3.0 (see resources/engines/stockfish)',
    win32metadata: { FileDescription: 'Cheeseee chess overlay', ProductName: 'Cheeseee', CompanyName: 'Cheeseee' },
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
  console.log('Packaged to', out.join(', '));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
