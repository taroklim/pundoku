/**
 * PD-102 — растеризация иконок D5 «Унос» из эталонных SVG (design/pd98-assets) в PNG приложения.
 *
 * Запускать РУКАМИ при смене иконки (в сборке не участвует: PNG лежат в git и смотрятся в ревью).
 * Порты не занимает: file://. Никаких pkill/killall.
 *
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     <repo>/design/pd98-icons.mjs
 *
 * Порог оптики (pd98-logo-round3.md §18.2): номинальный размер <= 60 -> d5-small-*, иначе d5-icon-*.
 * Все три размера, что берёт приложение (180 apple-touch, 192/512 PWA и maskable), > 60 -> полная геометрия.
 * Подача одна — светлая: у веб-клипа iOS один apple-touch-icon (§18.6), dark/tinted в вебе применять некуда.
 * Иконки обязаны быть непрозрачными (iOS кладёт веб-клип на чёрное); favicon-32.png — единственный с альфой.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(DIR, "pd98-assets");
const OUT = join(DIR, "..", "apps", "web", "public", "icons");
mkdirSync(OUT, { recursive: true });

/** @param {number} size номинальный размер, px */
export const sourceFor = (size, appearance = "light") =>
  join(ASSETS, size <= 60 ? `d5-small-${appearance}.svg` : `d5-icon-${appearance}.svg`);

// [файл, размер, исходник, прозрачный фон]
const TARGETS = [
  ["icon-192.png", 192, sourceFor(192), false],
  ["icon-512.png", 512, sourceFor(512), false],
  ["apple-touch-icon-180.png", 180, sourceFor(180), false],
  // Только для Safari <= 18.7 (SVG-favicon с Safari 26): 16-сеточный знак без плашки, с альфой.
  ["favicon-32.png", 32, join(ASSETS, "d5-favicon.svg"), true],
];

const browser = await chromium.launch();
try {
  for (const [name, size, src, alpha] of TARGETS) {
    const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const svg = readFileSync(src, "utf8");
    // Грузим SVG как <img>: тот же растеризатор, что у favicon/apple-touch, без влияния CSS страницы.
    const uri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${alpha ? "transparent" : "#000"}}img{display:block;width:${size}px;height:${size}px}</style><img id="i" src="${uri}">`,
    );
    await page.waitForFunction(() => document.getElementById("i").complete && document.getElementById("i").naturalWidth > 0);
    const png = await page.screenshot({ omitBackground: alpha, type: "png", clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(join(OUT, name), png);
    console.log(`wrote ${name} (${size}x${size}) <- ${src.slice(ASSETS.length + 1)}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
