/**
 * PD-141 — съёмка кадров макета «буква P из клеток, раунд 4» (pd141-logo-round4.html).
 *
 * Порты не занимает: file://. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd141-shots.mjs
 *
 * Пишет в design/pd141-shots/ (WebKit = wk-, Chromium = cr-), затем сжимает PNG до 256 цветов
 * через python3 + Pillow (если Pillow нет — пропускает сжатие):
 *   overview-{light,dark}.png      блок «Размеры» всех шести вариантов; страница и подача светлые / тёмные
 *   wk-vN-icon.png                 крупный кадр иконки 1024 (светлая подача, WebKit, @3x), N = 1..6
 *   wk-vN-home.png                 домашний экран: light / dark / tinted на обоях, N = 1..6
 *   wk-p6-wordmark.png             вордмарк с клеточной P: три размера, шапка, About
 *   wk-favicon.png, cr-favicon.png favicon 32/16: клетки, сплошная, D5 (CSS-размер, DPR 1 и 2) и увеличение
 *   wk-mono.png                    ч/б и одноцветный знак P4
 *   zoom29-60-{wk-light,wk-dark,cr-light}.png
 *       РЕАЛЬНЫЙ растр плашек 29 и 60 pt (DPR 3 и 2), увеличенный без сглаживания (nearest) —
 *       это не макетные «увеличенные» кадры, а пиксели, которые рисует браузер при заданном размере.
 *   Попутно пишет сырые крошечные кадры в /tmp/pd141-raw/ для пиксельных замеров.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd141-shots");
const RAW = "/tmp/pd141-raw";
const URL = pathToFileURL(join(DIR, "pd141-logo-round4.html")).href;
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const VARS = ["p1", "p2", "p3", "p4", "p5", "p6"];
// main > section: 2 иконка, 3 размеры, 4 домашний экран, 5 favicon, 6 ч/б, 8 название
const SEC = { icon: 2, sizes: 3, home: 4, fav: 5, mono: 6, word: 8 };
const engines = { wk: webkit, cr: chromium };

const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const dataUrl = (b) => "data:image/png;base64," + b.toString("base64");

async function ctxFor(browser, { w = 393, dpr = 3, scheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 852 }, deviceScaleFactor: dpr, colorScheme: scheme });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto(URL);
  await p.addStyleTag({ content: "header{position:static!important}" });
  return { ctx, p, errs };
}
const setVar = async (p, v, a) => {
  await p.click(`button[data-set="var"][data-val="${v}"]`);
  await p.click(`button[data-set="appear"][data-val="${a}"]`);
  await p.waitForTimeout(60);
};
// Снимок элемента ровно size×size CSS-px, выставленного на целочисленные координаты (10,10):
// без дробного сдвига раскладки, значит это ровно те пиксели, которые браузер рисует на этом размере.
async function snapAt(p, loc, size, bg = null) {
  await loc.evaluate((el, bg) => {
    el.dataset.old = el.getAttribute("style") || "";
    el.style.cssText += ";position:fixed!important;left:10px!important;top:10px!important;margin:0!important;z-index:9999!important" + (bg ? `;background:${bg}!important` : "");
  }, bg);
  const buf = await p.screenshot({ clip: { x: 10, y: 10, width: size, height: size } });
  await loc.evaluate((el) => { el.setAttribute("style", el.dataset.old); delete el.dataset.old; });
  return buf;
}
const sec = (p, k) => p.locator("main > section").nth(SEC[k]);

// Страница-композитор: раскладывает буферы PNG в сетку; img увеличиваются без сглаживания.
async function compose(browser, name, { bg, fg, cols = null, cells, width = 1200 }) {
  const ctx = await browser.newContext({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const html = `<body style="margin:0;background:${bg};color:${fg};font:14px/1.3 system-ui,sans-serif;padding:14px;width:${width - 28}px">
    <div style="display:flex;flex-wrap:wrap;gap:12px 18px;align-items:flex-end">${cells.map((c) => {
      if (c.row) return `<div style="flex-basis:100%;height:0"></div>`;
      const [w, h] = pngSize(c.buf);
      const s = c.scale ?? 1;
      return `<div>${`<img src="${dataUrl(c.buf)}" style="display:block;width:${w * s}px;height:${h * s}px;image-rendering:pixelated">
        <div style="margin-top:4px;max-width:${w * s}px">${c.label ?? ""}</div>`}</div>`;
    }).join("")}</div></body>`;
  await p.setContent(html);
  await p.screenshot({ path: join(OUT, name), fullPage: true });
  await ctx.close();
}

const results = [];

for (const eng of ["wk", "cr"]) {
  const browser = await engines[eng].launch();

  // ── 1. Крупные кадры (WebKit) и общий вид ───────────────────────────────────────
  if (eng === "wk") {
    {
      const { ctx, p, errs } = await ctxFor(browser, { dpr: 3, scheme: "light" });
      for (let i = 0; i < 6; i++) {
        await setVar(p, VARS[i], "light");
        await sec(p, "icon").locator(".card").first().screenshot({ path: join(OUT, `wk-v${i + 1}-icon.png`) });
        await sec(p, "home").locator(".wallband").first().screenshot({ path: join(OUT, `wk-v${i + 1}-home.png`) });
      }
      await setVar(p, "p6", "light");
      await sec(p, "word").locator(".card").first().screenshot({ path: join(OUT, "wk-p6-wordmark.png") });
      await setVar(p, "p4", "light");
      await sec(p, "mono").locator(".card").first().screenshot({ path: join(OUT, "wk-mono.png") });
      await sec(p, "fav").locator(".card").first().screenshot({ path: join(OUT, "wk-favicon-section.png") });
      if (errs.length) console.log("ERRORS wk", errs);
      results.push(["wk large", errs.length]);
      await ctx.close();
    }
    for (const scheme of ["light", "dark"]) {
      const { ctx, p } = await ctxFor(browser, { dpr: 2, scheme });
      const cells = [];
      for (const v of VARS) {
        await setVar(p, v, scheme);
        const buf = await sec(p, "sizes").locator(".card").first().screenshot();
        cells.push({ buf, label: v.toUpperCase(), scale: 0.5 });
      }
      await ctx.close();
      await compose(browser, `overview-${scheme}.png`, {
        bg: scheme === "light" ? "#F2F2F7" : "#000", fg: scheme === "light" ? "#1C1C1E" : "#F2F2F7", cells, width: 1200,
      });
    }
  }

  // ── 2. Реальный растр 29 и 60 pt: DPR 3 (iPhone) и DPR 2, + 1 для 29 ──────────────
  for (const scheme of eng === "wk" ? ["light", "dark"] : ["light"]) {
    const cells = [];
    for (const v of VARS) {
      for (const dpr of [3, 2, 1]) {
        const { ctx, p } = await ctxFor(browser, { dpr, scheme });
        await setVar(p, v, scheme);
        const sqs = sec(p, "sizes").locator(".card").first().locator(".sq");
        // порядок .sq в карточке: 180, 120, 60, 29
        const s60 = await snapAt(p, sqs.nth(2), 60);
        const s29 = await snapAt(p, sqs.nth(3), 29);
        writeFileSync(join(RAW, `${eng}-${scheme}-${v}-60-dpr${dpr}.png`), s60);
        writeFileSync(join(RAW, `${eng}-${scheme}-${v}-29-dpr${dpr}.png`), s29);
        const [w29] = pngSize(s29);
        // увеличение: 29 pt → ×4 при DPR3 (87 px → 348), ×6 при DPR2 (58), ×12 при DPR1 (29)
        cells.push({ buf: s29, scale: 348 / w29, label: `${v.toUpperCase()} · 29 pt @${dpr}x (${w29} px)` });
        if (dpr === 3) {
          const [w60] = pngSize(s60);
          cells.push({ buf: s60, scale: 360 / w60, label: `${v.toUpperCase()} · 60 pt @3x (${w60} px)` });
        }
        // и натуральный размер 1:1 для сравнения «как на экране»
        if (dpr === 3) cells.push({ buf: s29, scale: 1, label: "1:1" });
        await ctx.close();
      }
      cells.push({ row: true });
    }
    await compose(browser, `zoom29-60-${eng}-${scheme}.png`, {
      bg: scheme === "light" ? "#F2F2F7" : "#000", fg: scheme === "light" ? "#1C1C1E" : "#F2F2F7", cells, width: 1800,
    });
  }

  // ── 3. Favicon 32/16 — CSS-размер на DPR 1 и 2, плюс увеличение ────────────────────
  {
    const cells = [];
    for (const dpr of [1, 2]) {
      const { ctx, p } = await ctxFor(browser, { dpr, scheme: "light" });
      await setVar(p, "p4", "light");
      const spans = sec(p, "fav").locator(".row > span");
      for (let i = 0; i < 3; i++) {
        const nm = ["клетки", "сплошная", "D5"][i];
        const inner = spans.nth(i).locator("> span");
        const b32 = await snapAt(p, inner.nth(0), 32, "#FFFFFF");
        const b16 = await snapAt(p, inner.nth(1), 16, "#FFFFFF");
        writeFileSync(join(RAW, `${eng}-fav-${nm}-32-dpr${dpr}.png`), b32);
        writeFileSync(join(RAW, `${eng}-fav-${nm}-16-dpr${dpr}.png`), b16);
        cells.push({ buf: b32, scale: 192 / pngSize(b32)[0], label: `${nm} 32 @${dpr}x` });
        cells.push({ buf: b16, scale: 192 / pngSize(b16)[0], label: `${nm} 16 @${dpr}x` });
        cells.push({ buf: b16, scale: 1, label: "16 · 1:1" });
      }
      cells.push({ row: true });
      await ctx.close();
    }
    await compose(browser, `${eng}-favicon.png`, { bg: "#FFFFFF", fg: "#1C1C1E", cells, width: 1500 });
  }
  await browser.close();
}

// ── 4. Сжатие PNG (256 цветов) ─────────────────────────────────────────────────────
try {
  execFileSync("python3", ["-c", `
import sys, glob
from PIL import Image
for f in glob.glob(sys.argv[1] + '/*.png'):
    im = Image.open(f).convert('RGB')
    im.quantize(256, method=Image.MEDIANCUT, dither=Image.NONE).save(f, optimize=True)
`, OUT]);
} catch (e) { console.log("compress skipped:", e.message.split("\n")[0]); }
console.log(readdirSync(OUT).join("\n"));
console.log(JSON.stringify(results));
