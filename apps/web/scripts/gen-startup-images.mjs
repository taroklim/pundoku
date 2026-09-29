// Генерирует экраны запуска iOS PWA (apple-touch-startup-image) без внешних зависимостей (чистый zlib):
// сплошная заливка цветом токена темы, светлая и тёмная версии для актуальных iPhone.
// Пишет `public/splash/*.png` и обновляет блок <link> в `index.html` между маркерами.
// Запуск: `pnpm --filter @pundoku/web splash`. Без иконки/названия/анимаций — HIG: экран запуска
// почти неотличим от первого экрана приложения, поэтому только фон.
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  DEVICES,
  LAUNCH_COLORS,
  SCHEMES,
  fileName,
  linkTags,
  pixelSize,
} from "./startup-devices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "splash");

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

/**
 * Сплошная заливка w×h: индексный PNG, 1 бит на пиксель, палитра из одного цвета (файл ≈1–2 КБ).
 * Все пиксели — индекс 0, поэтому данные — нули; Safari/iOS индексные PNG читает штатно.
 */
function solidPng(w, h, rgb) {
  const stride = 1 + Math.ceil(w / 8); // фильтр none + биты строки
  const raw = Buffer.alloc(stride * h);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 3; // indexed color
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Buffer.from(rgb)),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const d of DEVICES) {
  const { w, h } = pixelSize(d);
  for (const scheme of SCHEMES) {
    const png = solidPng(w, h, LAUNCH_COLORS[scheme].rgb);
    writeFileSync(join(OUT, fileName(scheme, d)), png);
    console.log(`wrote splash/${fileName(scheme, d)} (${png.length} B)`);
  }
}

const htmlPath = join(ROOT, "index.html");
const html = readFileSync(htmlPath, "utf8");
const begin = html.indexOf(BLOCK_BEGIN);
const end = html.indexOf(BLOCK_END);
if (begin < 0 || end < begin) throw new Error("index.html: нет маркеров startup-images:begin/end");
const next = `${html.slice(0, begin)}${BLOCK_BEGIN}\n${linkTags()}\n    ${html.slice(end)}`;
if (next !== html) {
  writeFileSync(htmlPath, next);
  console.log("index.html: блок <link rel=apple-touch-startup-image> обновлён");
}
