// Draws the app icon (a white pawn on a green rounded tile) and writes PNG + ICO files.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r && u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

function pawn(u, v) {
  if ((u - 0.5) ** 2 + (v - 0.29) ** 2 <= 0.105 ** 2) return true; // head
  if (((u - 0.5) / 0.145) ** 2 + ((v - 0.445) / 0.04) ** 2 <= 1) return true; // collar
  if (v >= 0.445 && v <= 0.72) {
    const t = (v - 0.445) / 0.275;
    const half = 0.062 + 0.125 * t ** 1.8;
    if (Math.abs(u - 0.5) <= half) return true;
  }
  return inRoundRect(u, v, 0.27, 0.70, 0.73, 0.79, 0.035); // base
}

function sample(u, v) {
  // returns [r,g,b,a] in 0..1
  if (!inRoundRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.2)) return [0, 0, 0, 0];
  const t = v;
  let r = 0.47 - 0.17 * t, g = 0.74 - 0.22 * t, b = 0.42 - 0.16 * t;
  // subtle checker in the background
  const cell = Math.floor(u * 4) + Math.floor(v * 4);
  if (cell % 2 === 0) { r *= 0.93; g *= 0.93; b *= 0.93; }
  if (pawn(u - 0.012, v - 0.018) && !pawn(u, v)) { r *= 0.6; g *= 0.6; b *= 0.6; } // shadow
  if (pawn(u, v)) {
    const shade = 1 - 0.12 * v;
    r = 0.98 * shade; g = 0.97 * shade; b = 0.92 * shade;
  }
  return [r, g, b, 1];
}

function render(size) {
  const ss = size <= 32 ? 6 : 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      buf[i] = a ? Math.round((r / a) * 255) : 0;
      buf[i + 1] = a ? Math.round((g / a) * 255) : 0;
      buf[i + 2] = a ? Math.round((b / a) * 255) : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, buf);
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, data: render(size) }));
fs.writeFileSync(path.join(out, 'icon.png'), pngs.find((p) => p.size === 256).data);
fs.writeFileSync(path.join(out, 'icon.ico'), encodeIco(pngs));
console.log('Wrote assets/icon.png and assets/icon.ico');
