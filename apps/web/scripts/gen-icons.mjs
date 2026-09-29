// Генерирует PNG-плейсхолдеры иконок без внешних зависимостей (чистый zlib):
// чернильный квадрат с сеткой 3×3 — тот же мотив, что public/icons/icon.svg.
// Запуск: `pnpm --filter @pundoku/web icons`. Финальные иконки заменят эти файлы.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const INK = [0x3b, 0x48, 0xb0];
const WHITE = [0xff, 0xff, 0xff];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inset = Math.round(size * 0.22);
  const line = Math.max(2, Math.round(size * 0.045));
  const span = size - inset * 2;
  const cell = span / 3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const gx = x - inset;
      const gy = y - inset;
      let onGrid = false;
      if (gx >= -line && gx <= span + line && gy >= -line && gy <= span + line) {
        for (let i = 0; i <= 3; i++) {
          const p = Math.round(cell * i);
          if (Math.abs(gx - p) < line / 2 && gy >= 0 && gy <= span) onGrid = true;
          if (Math.abs(gy - p) < line / 2 && gx >= 0 && gx <= span) onGrid = true;
        }
      }
      const [r, g, b] = onGrid ? WHITE : INK;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon-180.png", 180],
]) {
  writeFileSync(join(OUT, name), render(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
