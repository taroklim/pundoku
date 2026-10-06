/**
 * PD-209 — кадры макета design/pd209-lantern.html (режим «Фонарь»: вид света/тени A/B/C, глубина тени, осмотр доски,
 * шит режима на входе, отметка в Year).
 *
 * Запуск (из products/pundoku):
 *   node design/pd209-shots.mjs
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd209-shots.mjs
 *
 * Playwright в репо не установлен. Ищется по очереди: от cwd, $PD_PW_HOME, /tmp/pundoku-qa/pw,
 * /Users/taroklim/Documents/KlymWork/gr487-w2/frontend (там стоит 1.52). Браузеры — системный кэш
 * Playwright (или PLAYWRIGHT_BROWSERS_PATH, если задан). Страница открывается по file:// с ?shot=1
 * (панель скрыта, рамка = вьюпорт, анимации и переходы выключены). Порт не занимается.
 * Браузеры закрываются в finally; никаких pkill.
 *
 * Что пишет в design/pd209-shots/  (cr-* chromium, wk-* webkit, @3x):
 *   game-<V>-<D>-<state>-<theme>-<w>[-<lang>][-ax3][-rm].png
 *        V = A тихий · B луч · C туман;  D = faint (едва различимо) · ghost (почти невидимо)
 *        state: center (выбрана клетка в центре, своя 5) / corner (пустая клетка в левом нижнем углу, с заметками)
 *               / none (нет выбора — всё своё в тени, строка-подсказка) / hold-<a|b> (осмотр: держу палец; a — как классика,
 *               b — цифры поверх тени) / done-<a|b> (осмотр из меню ⋯, кнопка «Готово») / menu (меню ⋯ с «Осмотреть доску»)
 *   sheet-<theme>-<w>[-<lang>][-ax3].png — шит режима на входе (строка правил)
 *   year-<Y>-<theme>-<w>[-<lang>].png  Y = A как Чернила (знака нет) · B полое кольцо в углу; открыт шит дня Фонаря
 *   overview-<theme>.png — макет с панелью (1280×1100 @1x, только chromium)
 *
 * Автопроверки (печатаются «!» и в итоговую сводку): баннер #pd209-err (ошибки JS), ошибки консоли и PD209.check() —
 * переполнение рамки, обрезанный однострочный текст, цели < 44 pt, 81 клетка, поле ≥ 150 px и не под таб-баром;
 * механика как нарисовано: своя цифра/заметка в тени не ярче 0.6 (утечка), в свете — 1; нет выбора → ни одной
 * клетки в свете + строка-подсказка; в осмотре — ничего в тени; «та же цифра» только в свете; данные подсказки
 * без приглушения/размытия и с контрастом ≥ 17:1 на своей клетке; Reduce Motion — без перехода; пункт меню
 * «Осмотреть доску»; кнопка «Готово» при осмотре из меню; в шите есть строка правил; в Year A нет знаков, в B — 3.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
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
const { chromium, webkit } = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd209-shots");
const PAGE = pathToFileURL(join(DIR, "pd209-lantern.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 320: { width: 320, height: 568 }, 390: { width: 390, height: 844 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (name, apply) => SHOTS.push({ name, w: apply.w || "390", theme: apply.theme || "light", rm: !!apply.rm, apply });
const suf = (o) => `${o.lang ? "-" + o.lang : ""}${o.ax3 ? "-ax3" : ""}${o.rm ? "-rm" : ""}`;
const g = (o) => {
  const a = Object.assign({ screen: "game", theme: "light", w: "390", depth: "ghost", iv: "b" }, o);
  const st = (a.gstate === "hold" || a.gstate === "done") ? `${a.gstate}-${a.iv}` : a.gstate;
  add(`game-${a.v}-${a.depth}-${st}-${a.theme}-${a.w}${suf(a)}`, a);
};

// 1+2. вид света × глубина × три базовых состояния × тема (390)
for (const v of ["A", "B", "C"])
  for (const depth of ["faint", "ghost"])
    for (const gstate of ["center", "corner", "none"])
      for (const theme of ["light", "dark"]) g({ v, depth, gstate, theme });

// 3. осмотр: удержание пальца (вид b) для всех вариантов; вид a и осмотр из меню — на рекомендованном B
for (const v of ["A", "B", "C"]) for (const theme of ["light", "dark"]) g({ v, gstate: "hold", iv: "b", theme });
for (const theme of ["light", "dark"]) {
  g({ v: "B", gstate: "hold", iv: "a", theme });
  g({ v: "B", gstate: "done", iv: "b", theme });
}
g({ v: "B", gstate: "done", iv: "a", theme: "light" });
g({ v: "B", gstate: "menu", theme: "light" });
g({ v: "B", gstate: "menu", theme: "dark", lang: "ru" });

// 320×568, языки, AX3, Reduce Motion
for (const v of ["A", "B", "C"]) g({ v, gstate: "center", w: "320" });
g({ v: "B", gstate: "none", w: "320", lang: "ru" });
g({ v: "B", gstate: "none", w: "320", lang: "uk", theme: "dark" });
g({ v: "B", gstate: "hold", w: "320", lang: "ru" });
g({ v: "B", gstate: "done", w: "320", lang: "uk" });
g({ v: "B", gstate: "center", w: "320", ax3: true });
g({ v: "B", gstate: "none", w: "320", ax3: true, lang: "ru" });
g({ v: "B", gstate: "done", w: "320", ax3: true, lang: "uk" });
g({ v: "B", gstate: "none", theme: "dark", ax3: true });
g({ v: "B", gstate: "center", rm: true });
g({ v: "C", gstate: "corner", rm: true, theme: "dark" });

// 4. шит режима на входе и Year
for (const theme of ["light", "dark"]) add(`sheet-${theme}-390`, { screen: "sheet", theme });
add("sheet-light-320-ru", { screen: "sheet", w: "320", lang: "ru" });
add("sheet-light-320-uk-ax3", { screen: "sheet", w: "320", lang: "uk", ax3: true });
add("sheet-dark-390-ru-ax3", { screen: "sheet", theme: "dark", lang: "ru", ax3: true });
for (const y of ["A", "B"]) for (const theme of ["light", "dark"]) add(`year-${y}-${theme}-390`, { screen: "year", y, theme });
add("year-B-light-320-ru", { screen: "year", y: "B", w: "320", lang: "ru" });
add("year-B-light-320-uk", { screen: "year", y: "B", w: "320", lang: "uk" });

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  try {
    for (const s of SHOTS) {
      const ctx = await browser.newContext({
        viewport: VIEW[s.w], deviceScaleFactor: 3,
        colorScheme: s.theme === "dark" ? "dark" : "light",
        reducedMotion: s.rm ? "reduce" : "no-preference"
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD209);
        await page.evaluate((o) => { PD209.reset(); PD209.apply(o); }, s.apply);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
        const bannerText = await page.evaluate(() => { const b = document.getElementById("pd209-err"); return b ? b.textContent : null; });
        if (bannerText) errors.push("БАННЕР: " + bannerText.replace(/\s+/g, " "));
        const checks = await page.evaluate(() => PD209.check());
        const all = [...errors, ...checks];
        if (all.length) { console.log(`  ! ${prefix}-${s.name}: ${all.slice(0, 4).join(" | ")}`); problems.push(`${prefix}-${s.name}`); }
        else console.log(`  ok ${prefix}-${s.name}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}

async function overview() {
  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1, colorScheme: theme });
      try {
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD209);
        await page.evaluate((t) => { PD209.reset(); PD209.apply({ theme: t }); }, theme);
        await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
        console.log(`  ok overview-${theme}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}

console.log(`кадров на браузер: ${SHOTS.length}`);
console.log("chromium…");
await shoot(chromium, "cr");
console.log("webkit…");
await shoot(webkit, "wk");
console.log("обзор…");
await overview();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
