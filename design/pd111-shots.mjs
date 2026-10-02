/**
 * PD-111 — кадры макета design/pd111-logo-placements.html (по секциям страницы).
 *
 * Порты не занимает: file://. Страница без скриптов; тема страницы и кадров-«телефонов»
 * в светлой/тёмной подаче идёт от prefers-color-scheme (светлая и тёмная кадры внутри
 * варианта показаны рядом всегда, а сама страница снимается в обеих схемах).
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd111-shots.mjs
 *
 * Пишет wk-<схема>-<секция>.png (WebKit, 390 px @2x) в design/pd111-shots/, плюс
 * cr-light-v1.png / cr-dark-v1.png (Chromium) для сверки. Секции: rule, v1..v6, verdict, questions.
 * Заодно проверяет: консоль/pageerror, внешние запросы, горизонтальный скролл — печатает ERRORS.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd111-shots");
const URL = pathToFileURL(join(DIR, "pd111-logo-placements.html")).href;
mkdirSync(OUT, { recursive: true });

const SECS = ["rule", "v1", "v2", "v3", "v4", "v5", "v6", "verdict", "questions"];
for (const [pre, eng, secs] of [["wk", webkit, SECS], ["cr", chromium, ["v1"]]]) {
  const browser = await eng.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    p.on("request", (r) => { if (!r.url().startsWith("file:")) errs.push("external " + r.url()); });
    await p.goto(URL);
    const hs = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (hs > 0) errs.push("horizontal scroll +" + hs);
    for (const s of secs) {
      const name = `${pre}-${scheme}-${s}.png`;
      await p.locator("#" + s).screenshot({ path: join(OUT, name) });
      console.log(name);
    }
    if (errs.length) console.log("ERRORS", pre, scheme, errs);
    await ctx.close();
  }
  await browser.close();
}
