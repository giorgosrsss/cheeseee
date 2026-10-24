// Bundles the window UI (src/renderer) into dist/.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

fs.mkdirSync(dist, { recursive: true });

function copyStaticAssets() {
  fs.copyFileSync(path.join(root, 'src', 'renderer', 'index.html'), path.join(dist, 'index.html'));

  // Copy ONNX model for chessboard recognition
  const modelDist = path.join(dist, 'model');
  fs.mkdirSync(modelDist, { recursive: true });
  const modelSrc = path.join(root, 'node_modules', '@scoriiu', 'fenshot', 'model', 'chess-tiles-v2.onnx');
  if (fs.existsSync(modelSrc)) {
    fs.copyFileSync(modelSrc, path.join(modelDist, 'chess-tiles-v2.onnx'));
  }

  // Copy ONNX runtime wasm files
  const ortDist = path.join(dist, 'ort');
  fs.mkdirSync(ortDist, { recursive: true });
  const ortSrcDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  if (fs.existsSync(ortSrcDir)) {
    for (const f of fs.readdirSync(ortSrcDir)) {
      if (f.startsWith('ort-wasm-simd-threaded')) {
        fs.copyFileSync(path.join(ortSrcDir, f), path.join(ortDist, f));
      }
    }
  }

  // Ensure mouse-clicker.exe is compiled
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const clickerExe = path.join(binDir, 'mouse-clicker.exe');
  const clickerSrc = path.join(root, 'src', 'native', 'mouse-clicker.cs');
  const needsCompile = fs.existsSync(clickerSrc) && (!fs.existsSync(clickerExe) || fs.statSync(clickerSrc).mtimeMs > fs.statSync(clickerExe).mtimeMs);
  if (needsCompile) {
    const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (fs.existsSync(csc)) {
      try {
        const { execFileSync } = require('child_process');
        execFileSync(csc, ['/nologo', '/optimize', '/target:exe', `/out:${clickerExe}`, clickerSrc]);
        console.log('Compiled mouse-clicker.exe');
      } catch (e) {
        console.warn('Failed to compile mouse-clicker.exe:', e.message);
      }
    }
  }
}

copyStaticAssets();

const options = {
  absWorkingDir: root,
  entryPoints: { app: 'src/renderer/app.js', styles: 'src/renderer/styles.css' },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  minify: !watch,
  loader: { '.svg': 'dataurl', '.png': 'dataurl' },
  logLevel: 'info',
  plugins: [{ name: 'copy-assets', setup(b) { b.onEnd(copyStaticAssets); } }],
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
