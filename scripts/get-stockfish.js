// Makes sure engines/stockfish/ has the Stockfish 19 binary for this OS.
// The Windows build is stored in the repo. The macOS build is just over GitHub's
// 100 MB file limit, so it's downloaded from the official Stockfish release instead.
//
//   node scripts/get-stockfish.js                     (this computer's OS)
//   node scripts/get-stockfish.js --platform darwin   (another OS)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { builtinEngineFile } = require('../src/main/builtin-engine');

const ENGINE_DIR = path.join(__dirname, '..', 'engines', 'stockfish');
const RELEASE = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/';

// Where each OS's binary comes from. Platforms without an archive are stored in the repo.
const DOWNLOADS = {
  darwin: {
    archive: 'stockfish-macos-universal.tar.gz', // one binary for Apple Silicon and Intel Macs
    member: 'stockfish/stockfish-macos-universal',
    sha256: 'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77',
    size: '80 MB',
  },
};

async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const body = Readable.fromWeb(res.body);
  let got = 0;
  let shown = -1;
  body.on('data', (chunk) => {
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (total && process.stdout.isTTY && pct !== shown) {
      shown = pct;
      process.stdout.write(`\r  ${pct}%`);
    }
  });
  await pipeline(body, fs.createWriteStream(file));
  if (process.stdout.isTTY && total) process.stdout.write('\n');
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function ensureEngine({ platform = process.platform } = {}) {
  const file = builtinEngineFile(platform);
  if (!file) {
    throw new Error(`Cheeseee has no bundled Stockfish for "${platform}". Add your own UCI engine in the app's Engine tab.`);
  }
  const dest = path.join(ENGINE_DIR, file);
  if (fs.existsSync(dest)) return dest;

  const dl = DOWNLOADS[platform];
  if (!dl) throw new Error(`${dest} is missing. It's stored in the repo; restore it with: git checkout -- engines`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cheeseee-stockfish-'));
  try {
    console.log(`Downloading Stockfish 19 for ${platform} (about ${dl.size})...`);
    await download(RELEASE + dl.archive, path.join(tmp, dl.archive));
    const hash = await sha256(path.join(tmp, dl.archive));
    if (hash !== dl.sha256) throw new Error(`The downloaded ${dl.archive} doesn't match the official checksum. Try again.`);
    // Relative paths so tar never reads "C:" in a Windows path as a remote host.
    execFileSync('tar', ['-xzf', dl.archive, dl.member], { cwd: tmp, stdio: 'inherit' });
    fs.mkdirSync(ENGINE_DIR, { recursive: true });
    const partial = dest + '.part';
    fs.copyFileSync(path.join(tmp, dl.member), partial);
    fs.chmodSync(partial, 0o755);
    fs.renameSync(partial, dest);
    console.log(`Saved ${path.relative(process.cwd(), dest)}`);
    return dest;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { ensureEngine };

if (require.main === module) {
  const i = process.argv.indexOf('--platform');
  const platform = i > -1 ? process.argv[i + 1] : process.platform;
  ensureEngine({ platform })
    .then((p) => console.log(`Stockfish for ${platform}: ${path.relative(process.cwd(), p)}`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
