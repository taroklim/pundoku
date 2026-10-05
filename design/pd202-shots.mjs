/**
 * PD-202 — кадры макета design/pd202-melody.html (режим «Мелодия»: партия A/B/C, карточка A/B/C, таймлапс).
 *
 * Запуск (из products/pundoku):
 *   node design/pd202-shots.mjs
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd202-shots.mjs
 *
 * Playwright в репо не установлен. Ищется по очереди: от cwd, $PD_PW_HOME, /tmp/pundoku-qa/pw,
 * /Users/taroklim/Documents/KlymWork/gr487-w2/frontend (там стоит 1.52). Браузеры — системный кэш
 * Playwright (или PLAYWRIGHT_BROWSERS_PATH, если задан). Страница открывается по file:// с ?shot=1
 * (панель скрыта, рамка = вьюпорт, анимации выключены, AudioContext не создаётся). Порт не занимается.
 * Браузеры закрываются в finally; никаких pkill.
 *
 * Что пишет в design/pd202-shots/  (cr-* chromium, wk-* webkit, @3x):
 *   game-<V>-<state>-<theme>-<w>[-<lang>][-rm].png   V = A только система · B динамик в тулбаре · C звук в ⋯
 *        state: fresh (подсказка про звук до первого хода) / wave (кадр отклика: закрыта строка 1)
 *               / muted (звук выключен) / menu (меню ⋯ открыто)
 *   card-<K>-<state>-<theme>-<w>.png   K = A под картой пути · B «смотреть и слушать» · C второе действие
 *        state: idle / playing (кадр: мелодия идёт, путь проявляется) / nolog (лог урезан — кнопок нет)
 *   player-<theme>-<w>.png — шит таймлапса с кнопкой звука (играет, ход 21)
 *   overview-<theme>.png — макет с панелью и лабораторией звука (1280×1100 @1x, только chromium)
 *
 * Автопроверки (печатаются «!» и в итоговую сводку): баннер #pd202-err (ошибки JS), ошибки консоли и
 * PD202.check() — переполнение рамки по ширине, обрезанный однострочный текст (.clip), 81 клетка на поле,
 * цели >= 44 pt, поле и пад не уходят под таб-бар, подсказка про звук есть в новой партии, динамик только в B,
 * пункт «Звук» в меню C, в nolog нет ни «Сыграть мелодию», ни «Посмотреть», у шита есть кнопка звука.
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
const OUT = join(DIR, "pd202-shots");
const PAGE = pathToFileURL(join(DIR, "pd202-melody.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 320: { width: 320, height: 568 }, 390: { width: 390, height: 844 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (name, apply, o = {}) => SHOTS.push({ name, w: apply.w || "390", theme: apply.theme || "light", rm: !!o.rm, apply });

for (const v of ["A", "B", "C"]) {
  for (const theme of ["light", "dark"]) {
    for (const w of ["390", "320"]) {
      add(`game-${v}-fresh-${theme}-${w}`, { screen: "game", v, gstate: "fresh", theme, w });
      add(`game-${v}-wave-${theme}-${w}`, { screen: "game", v, gstate: "wave", theme, w });
    }
    if (v !== "A") add(`game-${v}-muted-${theme}-390`, { screen: "game", v, gstate: "mid", muted: true, theme });
  }
  add(`game-${v}-menu-light-390`, { screen: "game", v, gstate: "menu", theme: "light" });
}
add("game-C-menu-muted-dark-390", { screen: "game", v: "C", gstate: "menu", muted: true, theme: "dark" });
for (const v of ["B", "C"]) add(`game-${v}-wave-light-390-rm`, { screen: "game", v, gstate: "wave", theme: "light", rm: true }, { rm: true });
for (const lang of ["uk", "ru"]) for (const v of ["B", "C"]) add(`game-${v}-fresh-light-320-${lang}`, { screen: "game", v, gstate: "fresh", theme: "light", w: "320", lang });

for (const k of ["A", "B", "C"]) {
  for (const theme of ["light", "dark"]) {
    add(`card-${k}-idle-${theme}-390`, { screen: "card", k, cstate: "idle", theme });
    if (k !== "B") add(`card-${k}-playing-${theme}-390`, { screen: "card", k, cstate: "playing", cur: 21, theme });
  }
  add(`card-${k}-idle-light-320`, { screen: "card", k, cstate: "idle", theme: "light", w: "320" });
  add(`card-${k}-nolog-light-390`, { screen: "card", k, cstate: "nolog", theme: "light" });
}
add("card-A-playing-light-320-ru", { screen: "card", k: "A", cstate: "playing", cur: 21, theme: "light", w: "320", lang: "ru" });
add("card-C-idle-light-320-uk", { screen: "card", k: "C", cstate: "idle", theme: "light", w: "320", lang: "uk" });
for (const theme of ["light", "dark"]) add(`player-${theme}-390`, { screen: "player", pidx: 21, pplaying: true, psound: true, theme });
add("player-light-320", { screen: "player", pidx: 21, pplaying: true, psound: true, theme: "light", w: "320" });
add("player-muted-light-390", { screen: "player", pidx: 21, pplaying: false, psound: false, theme: "light" });

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
        await page.waitForFunction(() => !!window.PD202);
        await page.evaluate((o) => { PD202.reset(); PD202.apply(o); }, s.apply);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
        const bannerText = await page.evaluate(() => { const b = document.getElementById("pd202-err"); return b ? b.textContent : null; });
        if (bannerText) errors.push("БАННЕР: " + bannerText.replace(/\s+/g, " "));
        const checks = await page.evaluate(() => PD202.check());
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
        await page.waitForFunction(() => !!window.PD202);
        await page.evaluate((t) => { PD202.reset(); PD202.apply({ theme: t, gstate: "wave" }); }, theme);
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
