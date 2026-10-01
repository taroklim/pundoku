/**
 * PD-93 — съёмка кадров макета логотипов раунд 2 (по секциям страницы).
 *
 * Порты не занимает: file://. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd93-shots.mjs
 *
 * Пишет cr-*.png (chromium) и wk-*.png (webkit) в design/pd93-shots/. Viewport 393x852 @3x
 * (iPhone 16), плюс два кадра на 320 px. Секции main > section: s1 иконка, s2 домашний экран,
 * s3 размеры, s4 ч/б, s5 знак, s6 вордмарк, s7 «где знак», s8 движение, s9 слои.
 * Кадры движения заморожены на заданном времени анимации (детерминированно). Кадры
 * qa-mask-*.png (круг maskable 80 %) и qa-xdiff-*.png пишет pd93-qa.mjs.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd93-shots");
const URL = pathToFileURL(join(DIR, "pd93-logo-round2.html")).href;
mkdirSync(OUT, { recursive: true });

const SEC = { s1: 1, s2: 2, s3: 3, s4: 4, s5: 5, s6: 6, s7: 7, s8: 8, s9: 9 };

// [браузер, ширина, направление, подача, секция, motion, заморозка(мс)|null]
const SHOTS = [];
for (const d of ["d1", "d2", "d3"]) {
  SHOTS.push(["cr", 393, d, "light", "s1"], ["cr", 393, d, "dark", "s2"], ["cr", 393, d, "tinted", "s3"],
    ["cr", 393, d, "light", "s4"], ["cr", 393, d, "light", "s6"], ["cr", 393, d, "light", "s7"]);
}
SHOTS.push(["cr", 393, "d1", "light", "s8", "off", 500], ["cr", 393, "d2", "light", "s8", "off", 430],
  ["cr", 393, "d3", "light", "s8", "off", 370], ["cr", 393, "d2", "light", "s8", "on", 100]);
for (const d of ["d1", "d2", "d3"]) SHOTS.push(["wk", 393, d, "light", "s1"]);
SHOTS.push(["wk", 393, "d2", "dark", "s2"], ["wk", 393, "d3", "light", "s7"]);
SHOTS.push(["cr", 320, "d1", "light", "s7"], ["cr", 320, "d3", "dark", "s2"]);

const engines = { cr: chromium, wk: webkit };
for (const eng of ["cr", "wk"]) {
  const browser = await engines[eng].launch();
  for (const w of [393, 320]) {
    const list = SHOTS.filter((x) => x[0] === eng && x[1] === w);
    if (!list.length) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: 852 }, deviceScaleFactor: 3, colorScheme: "light" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(URL);
    // sticky-шапка не должна попадать в кадр секции
    await p.addStyleTag({ content: "header{position:static!important}" });
    for (const [, , d, a, s, mo = "system", freeze = null] of list) {
      await p.click(`button[data-set="dir"][data-val="${d}"]`);
      await p.click(`button[data-set="appear"][data-val="${a}"]`);
      await p.click(`button[data-set="motion"][data-val="${mo}"]`);
      await p.waitForTimeout(120);
      const sec = p.locator("main > section").nth(SEC[s]);
      await sec.scrollIntoViewIfNeeded();
      let target = sec;
      if (freeze !== null) {
        await p.click("#play");
        await p.evaluate((t) => document.getAnimations().forEach((an) => { an.pause(); an.currentTime = t; }), freeze);
        await p.waitForTimeout(80);
        target = sec.locator(".moplate");
      }
      const name = `${eng}-${w}-${d}-${a}-${s}${freeze !== null ? `-${mo}-t${freeze}` : ""}.png`;
      await target.screenshot({ path: join(OUT, name) });
      console.log(name);
    }
    if (errs.length) console.log("ERRORS", eng, w, errs);
    await ctx.close();
  }
  await browser.close();
}
