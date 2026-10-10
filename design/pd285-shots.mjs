/**
 * PD-285 — кадры макета design/pd285-result-card.html (карточка результата Play: «Сейчас», A «Док действий»,
 * B «Плотная карточка», C «Действия над картой»).
 *
 * Запуск (из products/pundoku):
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd285-shots.mjs
 *   (BROWSERS=chromium или webkit — только один движок; по умолчанию оба)
 *
 * Playwright в репо не установлен. Ищется по очереди: от cwd, $PD_PW_HOME, /tmp/pundoku-qa/pw,
 * /Users/taroklim/Documents/KlymWork/gr487-w2/frontend. Браузеры — системный кэш Playwright (или PLAYWRIGHT_BROWSERS_PATH).
 * Страница открывается по file:// с ?shot=1 (панель скрыта, одна рамка = вьюпорт). 1rem = 17 px (iPhone по умолчанию),
 * AX3 = 40 px, safe-area задаются переменными рамки (320×568: 20/0; 393×852 и 430×932: 59/34) — не зависят от движка.
 * Reduce Transparency — класс макета (Playwright медиа prefers-reduced-transparency не эмулирует). Порт не занимается.
 * Браузеры закрываются в finally; никаких pkill.
 *
 * Что пишет в design/pd285-shots/  (cr-* chromium, wk-* webkit), @3x:
 *   <V>-<w>-<theme>-<scroll>[-ax3][-rt][-<lang>][-<content>].png
 *     V: now (main) · A (док, 2 ряда) · A1 (док в 1 ряд + New puzzle в шапке) · B · C
 *     scroll: rest (покой) · mid (середина прокрутки — контент под доком) · end (конец прокрутки)
 *     content: long (Лжец + подсказка: +3 строки и сравнение) · nolog (повтор недоступен, Share нет)
 *   measure-<cr|wk>.json — замеры каждого кадра: верх таб-бара/дока, где каждая кнопка и сколько её видно, размер
 *     тепловой карты (B), диапазон прокрутки.
 *   overview-<theme>.png — интерактивная страница, все варианты × 3 ширины (1@x, масштаб 50 %, только chromium)
 *
 * Автопроверки (печатаются «!» и в итоговую сводку): баннер #pd285-err (ошибки JS), ошибки консоли и PD285.check() —
 * нет горизонтального переполнения, подписи кнопок не обрезаны, цели ≥ 44 px, док прилегает к таб-бару, в покое
 * (обычный текст) у A и C все действия целиком над таб-баром/доком, у B — если карта влезла; в конце прокрутки у
 * ВСЕХ вариантов ни кнопки, ни низ карточки не лежат под таб-баром/доком (ушедшие вверх за край, как у C, — норма). «Сейчас» в покое не проверяется — это и есть дефект;
 * его замер печатается строкой «= now …».
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

function loadPlaywright() {
  const bases = [process.cwd(), process.env.PD_PW_HOME, "/tmp/pundoku-qa/pw",
    "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend"].filter(Boolean);
  const tried = [];
  for (const b of bases) {
    try { return createRequire(join(b, "noop.js"))("playwright"); } catch (e) { tried.push(b + " (" + e.code + ")"); }
  }
  console.error("Playwright не найден. Искал от: " + tried.join(", ") + "\nЗадай PD_PW_HOME на папку с node_modules/playwright.");
  process.exit(1);
}
const PW = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd285-shots");
const PAGE = pathToFileURL(join(DIR, "pd285-result-card.html")).href;
mkdirSync(OUT, { recursive: true });

const H = { 320: 568, 393: 852, 430: 932 };
const WS = [320, 393, 430];
const VS = ["now", "A", "B", "C"];

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const seen = new Set();
function add(o) {
  const a = Object.assign({ v: "A", w: 393, dock: "two", theme: "light", ax3: false, rt: false, lang: "en", content: "normal", scroll: "rest" }, o);
  const vn = a.v === "A" && a.dock === "one" ? "A1" : a.v;
  const name = `${vn}-${a.w}-${a.theme}-${a.scroll}${a.ax3 ? "-ax3" : ""}${a.rt ? "-rt" : ""}${a.lang !== "en" ? "-" + a.lang : ""}${a.content !== "normal" ? "-" + a.content : ""}`;
  if (seen.has(name)) return;
  seen.add(name);
  SHOTS.push({ name, a });
}

// 1. Покой: все варианты × 3 ширины × 2 темы.
for (const v of VS) for (const w of WS) for (const theme of ["light", "dark"]) add({ v, w, theme });
// 2. Конец прокрутки: все варианты × 3 ширины (светлая) + 393 тёмная.
for (const v of VS) { for (const w of WS) add({ v, w, scroll: "end" }); add({ v, w: 393, theme: "dark", scroll: "end" }); }
// 3. A: середина прокрутки — карточка под доком, растушёвка 16 px.
for (const theme of ["light", "dark"]) { add({ v: "A", w: 393, theme, scroll: "mid" }); add({ v: "A", w: 320, theme, scroll: "mid" }); }
// 4. AX3: все варианты 393 светлая; A и C на 320; A 393 тёмная в конце.
for (const v of VS) add({ v, w: 393, ax3: true });
add({ v: "A", w: 320, ax3: true }); add({ v: "C", w: 320, ax3: true }); add({ v: "C", w: 320, ax3: true, theme: "dark" });
add({ v: "A", w: 393, ax3: true, theme: "dark", scroll: "end" }); add({ v: "C", w: 393, ax3: true, scroll: "end" });
// 5. Reduce Transparency: таб-бар непрозрачный, у дока вместо растушёвки — линия.
for (const theme of ["light", "dark"]) { add({ v: "A", w: 393, theme, rt: true }); add({ v: "A", w: 393, theme, rt: true, scroll: "mid" }); }
add({ v: "now", w: 393, rt: true });
// 6. Языки (самые длинные подписи): uk/ru на 320, uk на 430.
for (const v of ["A", "B", "C"]) add({ v, w: 320, lang: "uk" });
add({ v: "A", w: 320, lang: "ru", theme: "dark" }); add({ v: "A", w: 430, lang: "uk" }); add({ v: "now", w: 320, lang: "uk" });
// 7. Длинная карточка (Лжец + подсказка).
for (const v of VS) add({ v, w: 393, content: "long" });
add({ v: "A", w: 393, content: "long", scroll: "end" }); add({ v: "A", w: 320, content: "long" }); add({ v: "B", w: 430, content: "long" });
// 8. Повтор недоступен (нет Watch/Share — одна «New puzzle»).
for (const v of ["A", "B", "C"]) add({ v, w: 393, content: "nolog" });
add({ v: "A", w: 320, content: "nolog", theme: "dark" });
// 9. Развилка A: док в один ряд + New puzzle в шапке.
for (const w of WS) add({ v: "A", dock: "one", w });
add({ v: "A", dock: "one", w: 393, theme: "dark" }); add({ v: "A", dock: "one", w: 320, lang: "uk" });
add({ v: "A", dock: "one", w: 393, scroll: "end" }); add({ v: "A", dock: "one", w: 393, content: "nolog" });

/* ------------------------------------------------------------------ съёмка */
const problems = [];
const brief = (m) => m.acts.map((x) => `${x.act}${x.where === "header" ? "@hdr" : ""}:${x.full ? "full" : x.vis + "px"}`).join(" ")
  + ` | бар ${m.barTop}${m.dockTop != null ? ` док ${m.dockTop}` : ""}${m.mode === "B" ? ` | B ${m.fit} карта ${m.heat}` : ""}${m.mode === "inline" ? " | AX3 inline" : ""} | прокрутка ${m.scrollRange}`;

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  const measures = [];
  try {
    for (const s of SHOTS) {
      const ctx = await browser.newContext({
        viewport: { width: s.a.w, height: H[s.a.w] }, deviceScaleFactor: 3,
        colorScheme: s.a.theme === "dark" ? "dark" : "light", reducedMotion: "no-preference",
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD285);
        const m = await page.evaluate((o) => { PD285.reset(); return PD285.apply(o); }, s.a);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
        const bannerText = await page.evaluate(() => { const b = document.getElementById("pd285-err"); return b && !b.hidden ? b.textContent : null; });
        if (bannerText) errors.push("БАННЕР: " + bannerText.replace(/\s+/g, " "));
        const checks = await page.evaluate(() => PD285.check());
        const all = [...errors, ...checks];
        measures.push({ shot: `${prefix}-${s.name}`, ...m, problems: all });
        if (all.length) { console.log(`  ! ${prefix}-${s.name}: ${all.slice(0, 4).join(" | ")}`); problems.push(`${prefix}-${s.name}`); }
        else console.log(`  ${s.a.v === "now" ? "=" : "ok"} ${prefix}-${s.name}: ${brief(m)}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
  writeFileSync(join(OUT, `measure-${prefix}.json`), JSON.stringify(measures, null, 2) + "\n");
}

async function overview() {
  const browser = await PW.chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1480, height: 1200 }, deviceScaleFactor: 1, colorScheme: theme });
      try {
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD285);
        await page.evaluate((t) => PD285.ui({ theme: t, v: "all", w: "all", zoom: "0.5", scroll: "rest" }), theme);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
        const checks = await page.evaluate(() => PD285.check());
        if (checks.length) { console.log(`  ! overview-${theme}: ${checks.slice(0, 4).join(" | ")}`); problems.push(`overview-${theme}`); }
        else console.log(`  ok overview-${theme}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}

const BROWSERS = (process.env.BROWSERS ?? "chromium,webkit").split(",").map((b) => b.trim()).filter(Boolean);
console.log(`кадров на браузер: ${SHOTS.length}`);
for (const b of BROWSERS) {
  console.log(`${b}…`);
  await shoot(PW[b], b === "webkit" ? "wk" : "cr");
}
console.log("обзор…");
await overview();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
