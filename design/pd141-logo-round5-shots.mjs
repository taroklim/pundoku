/**
 * PD-149 — съёмка кадров макета «клеточные P-u-n в вордмарке, раунд 5» (pd141-logo-round5.html).
 *
 * Порты не занимает: file://. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pundoku-ios/pw && node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd141-logo-round5-shots.mjs
 *
 * (playwright 1.52 из /tmp/pundoku-ios/pw, браузеры из ~/Library/Caches/ms-playwright; /tmp/pd16-pw на момент PD-149 битый.)
 * WebKit, iPhone 393 x 852 @3x. Страница строит весь SVG из JS — перед съёмкой ждём, пока
 * в каждом .wm появятся <rect>/<path>, и проверяем, что пустых слотов нет.
 * Пишет в design/pd141-logo-round5-shots/ (затем PNG сжимаются до 256 цветов через Pillow):
 *   overview-{light,dark}.png            вся страница целиком (вариант A, 2-е «u» обычное), @2x
 *   {a..d}-big-{light,dark}.png          раздел «Четыре варианта»: крупно, 2-е «u» обычное и клеточное, 28/34/48 px
 *   {a..d}-sizes-{light,dark}.png        размерная полоса 21..68 px (настоящие CSS-px, @3x)
 *   {a..d}-today-{light,dark}.png        шапка Today: заголовок / вордмарк 28 / 34 / 21 px
 *   {a..d}-about-{light,dark}.png        Settings -> About, вордмарк 32 px
 *   {a..d}-png.png                       одноцветный PNG-отпечаток (новый и D5)
 *   {a..d}-splash-{light,dark}.png       крупная подача
 *   a-u2cell-{today-light,about-dark,png,splash-light}.png   то же с клеточным вторым «u»
 *   map.png, sketches.png, mono-sim.png, table-sizes.png    карта клеток, отвергнутые эскизы, одноцветная симуляция
 *   zoom28-32.png                        реальный растр вордмарка 28 и 32 px (DPR 3/2/1) крупно, без сглаживания
 * Пиксельный замер зазоров -> /tmp/pd149-raw/measure.json и в stdout.
 */
import { createRequire } from "node:module";
const { webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd141-logo-round5-shots");
const RAW = "/tmp/pd149-raw";
const URL = pathToFileURL(join(DIR, "pd141-logo-round5.html")).href;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const VARS = ["a", "b", "c", "d"];
const THEMES = ["light", "dark"];
// main > section: 0 что изменилось, 1 карта, 2 четыре варианта, 3 размеры, 4 контексты, 5 доступность, 6 эскизы, 7 рекомендация
const SEC = { map: 1, variants: 2, sizes: 3, ctx: 4, a11y: 5, sketches: 6 };
const sec = (p, k) => p.locator("main > section").nth(SEC[k]);
const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const dataUrl = (b) => "data:image/png;base64," + b.toString("base64");
const problems = [];

async function open(browser, { w = 393, dpr = 3, scheme = "light", extra = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 852 }, deviceScaleFactor: dpr, colorScheme: scheme, ...extra });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto(URL);
  await p.addStyleTag({ content: "header.top{position:static!important}" });
  await waitRendered(p, "initial");
  return { ctx, p, errs };
}

// Страница строит SVG из JS: ждём, пока каждый .wm не пуст, и фиксируем пустые слоты как дефект.
async function waitRendered(p, tag) {
  await p.waitForFunction(() => {
    const all = [...document.querySelectorAll("svg.wm")];
    return all.length > 20 && all.every((s) => s.querySelector("path,rect"));
  }, null, { timeout: 5000 }).catch(() => {});
  const rep = await p.evaluate(() => {
    const all = [...document.querySelectorAll("svg.wm")];
    const empty = all.filter((s) => !s.querySelector("path,rect"));
    const zero = all.filter((s) => { const r = s.getBoundingClientRect(); return r.width < 1 || r.height < 1; });
    return { total: all.length, empty: empty.length, zero: zero.length };
  });
  if (rep.empty || rep.zero) problems.push(`${tag}: ${JSON.stringify(rep)}`);
  await p.waitForTimeout(80);
  return rep;
}

async function pick(p, set, val, tag) {
  await p.click(`button[data-set="${set}"][data-val="${val}"]`);
  await p.waitForTimeout(60);
  await waitRendered(p, tag || `${set}=${val}`);
}

// Блоки .pairx в обычной раскладке прокручиваются вбок; для съёмки раскладываем столбцом.
const UNROLL = ".pairx{display:block!important;overflow:visible!important}.pairx>.pane{margin-bottom:10px}";

async function compose(browser, name, { bg, fg, cells, width = 1400 }) {
  const ctx = await browser.newContext({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const html = `<body style="margin:0;background:${bg};color:${fg};font:14px/1.3 system-ui,sans-serif;padding:14px;width:${width - 28}px">
    <div style="display:flex;flex-wrap:wrap;gap:12px 18px;align-items:flex-end">${cells.map((c) => {
      if (c.row) return `<div style="flex-basis:100%;height:0"></div>`;
      const [w, h] = pngSize(c.buf);
      const s = c.scale ?? 1;
      return `<div><img src="${dataUrl(c.buf)}" style="display:block;width:${w * s}px;height:${h * s}px;image-rendering:pixelated">
        <div style="margin-top:4px;max-width:${Math.max(w * s, 120)}px">${c.label ?? ""}</div></div>`;
    }).join("")}</div></body>`;
  await p.setContent(html);
  await p.screenshot({ path: join(OUT, name), fullPage: true });
  await ctx.close();
}

const wk = await webkit.launch();

// ── 1. Основные кадры: WebKit, 393 @3x ────────────────────────────────────────────────
for (const scheme of THEMES) {
  const { ctx, p, errs } = await open(wk, { w: 440, dpr: 3, scheme });
  await p.addStyleTag({ content: UNROLL });
  await pick(p, "theme", scheme);
  for (const v of VARS) {
    await pick(p, "var", v);
    const variants = p.locator("#variants > div").nth(VARS.indexOf(v));
    await variants.screenshot({ path: join(OUT, `${v}-big-${scheme}.png`) });
    // панели «светлая|тёмная» — фиксированной темы, поэтому каждую снимаем один раз (в проходе своей темы)
    const idx = scheme === "light" ? 0 : 1;
    await sec(p, "sizes").locator(".pane").nth(idx).screenshot({ path: join(OUT, `${v}-sizes-${scheme}.png`) });
    await sec(p, "ctx").locator(".pairx").nth(0).locator(".pane").nth(idx).screenshot({ path: join(OUT, `${v}-today-${scheme}.png`) });
    await sec(p, "ctx").locator(".pair").nth(0).locator(".pane").nth(idx).screenshot({ path: join(OUT, `${v}-about-${scheme}.png`) });
    await sec(p, "ctx").locator(".pairx").nth(1).locator(".pane").nth(idx).screenshot({ path: join(OUT, `${v}-splash-${scheme}.png`) });
    if (scheme === "light") await sec(p, "ctx").locator('[data-png]').screenshot({ path: join(OUT, `${v}-png.png`) });
  }
  if (scheme === "light") {
    await pick(p, "var", "a");
    await sec(p, "map").screenshot({ path: join(OUT, "map.png") });
    await sec(p, "sketches").screenshot({ path: join(OUT, "sketches.png") });
    await sec(p, "a11y").locator(".pair").screenshot({ path: join(OUT, "mono-sim.png") });
    await sec(p, "sizes").locator(".scroll").screenshot({ path: join(OUT, "table-sizes.png") });
    // клеточное второе «u»
    await pick(p, "u2", "cell");
    await sec(p, "ctx").locator(".pairx").nth(0).locator(".pane").nth(0).screenshot({ path: join(OUT, "a-u2cell-today-light.png") });
    await sec(p, "ctx").locator('[data-png]').screenshot({ path: join(OUT, "a-u2cell-png.png") });
    await sec(p, "ctx").locator(".pairx").nth(1).locator(".pane").nth(0).screenshot({ path: join(OUT, "a-u2cell-splash-light.png") });
    for (const v of ["b", "c", "d"]) {
      await pick(p, "var", v);
      await sec(p, "ctx").locator(".pairx").nth(0).locator(".pane").nth(0).screenshot({ path: join(OUT, `${v}-u2cell-today-light.png`) });
    }
  } else {
    await pick(p, "var", "a");
    await pick(p, "u2", "cell");
    await sec(p, "ctx").locator(".pair").nth(0).locator(".pane").nth(1).screenshot({ path: join(OUT, "a-u2cell-about-dark.png") });
  }
  if (errs.length) problems.push(`page errors (${scheme}): ${errs.join("; ")}`);
  await ctx.close();
}

// ── 2. Обзор целой страницы: настоящая ширина 393, @2x ─────────────────────────────────
for (const scheme of THEMES) {
  const { ctx, p } = await open(wk, { w: 393, dpr: 2, scheme });
  await pick(p, "theme", scheme);
  await p.screenshot({ path: join(OUT, `overview-${scheme}.png`), fullPage: true });
  await ctx.close();
}

// forced-colors через emulate НЕ снимаем: проверено (WebKit и Chromium, headless) — media-запрос включается,
// но палитру страницы движок не переопределяет, кадры были бы неотличимы от обычных. Правило
// `.settings-about-word rect { fill: CanvasText }` (md §9.2) проверяется только на живом Windows High Contrast.

// ── 3. Реальный растр и замер на 28 / 32 px ───────────────────────────────────────────
// Рисуем вордмарк чёрным по белому (тема не мешает), на целых CSS-px; DPR 3 / 2 / 1.
// Замер: в зазоре между строками клеток «P» (y между строкой 1 и 2) берём пиксельные ряды по оси
// центральной половины клетки; «видимость зазора» = (L_зазор − L_клетка)/(L_фон − L_клетка), где L_зазор —
// самый светлый ряд, усреднённый по ширине. 100 % = зазор дошёл до чистого фона, 0 % = сплошное.
const meas = [];
const cellsZoom = [];
for (const dpr of [3, 2, 1]) {
  const { ctx, p } = await open(wk, { w: 600, dpr, scheme: "light" });
  for (const v of VARS) for (const h of [28, 32]) {
    const info = await p.evaluate(({ v, h }) => {
      document.querySelectorAll("#__m").forEach((e) => e.remove());
      const d = document.createElement("div");
      d.id = "__m";
      d.style.cssText = "position:fixed;left:10px;top:10px;z-index:99999;background:#fff;padding:0;margin:0;line-height:0";
      const s = svgEl("", h);
      s.style.cssText = "display:block;--pun:#000;--dk:#000";
      d.appendChild(s); document.body.appendChild(d);
      paint(s, v, {});
      const r = s.getBoundingClientRect();
      const V_ = V[v];
      return { w: r.width, h: r.height, cell: V_.cell, gap: V_.gap, pitch: V_.cell + V_.gap, unitW: V_.w };
    }, { v, h });
    const buf = await p.screenshot({ clip: { x: 10, y: 10, width: Math.ceil(info.w), height: h } });
    writeFileSync(join(RAW, `${v}-${h}-dpr${dpr}.png`), buf);
    meas.push({ v, h, dpr, ...info });
    if (dpr === 3 || (dpr === 1 && h === 28)) cellsZoom.push({ buf, scale: dpr === 3 ? 3 : 8, label: `${v.toUpperCase()} ${h}px @${dpr}x (${pngSize(buf).join("x")})` });
    if (dpr === 3) cellsZoom.push({ buf, scale: 1, label: `${v.toUpperCase()} ${h}px @3x 1:1` });
  }
  await ctx.close();
}
await compose(wk, "zoom28-32.png", { bg: "#fff", fg: "#1c1c1e", cells: cellsZoom, width: 1500 });
await wk.close();
writeFileSync(join(RAW, "meas-input.json"), JSON.stringify(meas));

// Анализ растров (Pillow): зазор между строками 1 и 2 «P» и вертикальный зазор между столбцами 1 и 2 «P».
let measureOut = "";
try {
  measureOut = execFileSync("python3", ["-c", `
import json, sys
from PIL import Image
RAW = sys.argv[1]
meas = json.load(open(RAW + '/meas-input.json'))
res = []
for m in meas:
    im = Image.open(f"{RAW}/{m['v']}-{m['h']}-dpr{m['dpr']}.png").convert('L')
    W, H = im.size
    k = m['h'] / 116.0 * m['dpr']              # px растра на единицу viewBox
    cell, gap, pitch = m['cell'], m['gap'], m['pitch']
    # «P»: клетки по x от 2 (translate), строки: Y_i = 200 - (4-i)*pitch + gap, минус 94 (translate) -> viewBox
    def ys(i): return 200 - (4 - i) * pitch + gap - 94
    # горизонтальная щель между строкой 0 и 1 (оба ряда в столбце 0 заняты клетками)
    y0, y1 = ys(0) + cell, ys(1)
    x_a, x_b = 2 + cell * 0.25, 2 + cell * 0.75
    def px(v): return int(round(v * k))
    def band_rows(a, b): return range(max(0, int(a * k)), min(H, int(b * k) + 1))
    # яркость строк растра в полосе щели (центры пикселей внутри [y0 - 0.5 пикс; y1 + 0.5 пикс] нужно целиком)
    cols = range(px(x_a), px(x_b) + 1)
    def row_mean(y): return sum(im.getpixel((x, y)) for x in cols) / len(cols)
    # эталон «клетка»: середина клетки строки 0
    yc = min(H - 1, px(ys(0) + cell / 2))
    L_cell = row_mean(yc)
    # самый светлый ряд растра в окрестности щели
    cand = [row_mean(y) for y in range(max(0, px(y0) - 1), min(H, px(y1) + 2))]
    L_gap = max(cand)
    gap_px = (y1 - y0) * k
    vis_h = (L_gap - L_cell) / (255 - L_cell) if L_cell < 255 else 0
    # вертикальная щель между столбцами 0 и 1 у «P» в строке 2 (клетки 0 и 2 есть, 1 — нет) не годится;
    # строка 0: клетки (0,1,2) — берём щель между столбцами 0 и 1
    xa0, xa1 = 2 + cell, 2 + pitch
    rows = range(px(ys(0) + cell * 0.25), px(ys(0) + cell * 0.75) + 1)
    def col_mean(x): return sum(im.getpixel((x, y)) for y in rows) / len(rows)
    xc = min(W - 1, px(2 + cell / 2))
    Lc = col_mean(xc)
    candx = [col_mean(x) for x in range(max(0, px(xa0) - 1), min(W, px(xa1) + 2))]
    vis_v = (max(candx) - Lc) / (255 - Lc) if Lc < 255 else 0
    res.append(dict(v=m['v'], h=m['h'], dpr=m['dpr'], gap_px=round(gap_px, 2), vis_horizontal_gap=round(vis_h * 100), vis_vertical_gap=round(vis_v * 100), size=[W, H]))
json.dump(res, open(RAW + '/measure.json', 'w'), indent=1)
print('v h dpr gap_px  horiz%  vert%')
for r in res:
    print(r['v'], r['h'], r['dpr'], r['gap_px'], r['vis_horizontal_gap'], r['vis_vertical_gap'])
`, RAW]).toString();
} catch (e) { measureOut = "measure skipped: " + e.message.split("\n")[0]; }
console.log(measureOut);

// ── 4. Сжатие PNG (256 цветов) ─────────────────────────────────────────────────────────
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
console.log("PROBLEMS:", JSON.stringify(problems));
