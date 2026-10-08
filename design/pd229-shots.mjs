/**
 * PD-229 — кадры макета design/pd229-desktop.html (десктоп-версия: концепции A «Колонка», B «Стол», C «Сайдбар»).
 *
 * Запуск (из products/pundoku):
 *   node design/pd229-shots.mjs
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd229-shots.mjs
 *
 * Playwright в репо не установлен. Ищется по очереди: от cwd, $PD_PW_HOME, /tmp/pundoku-qa/pw,
 * /Users/taroklim/Documents/KlymWork/gr487-w2/frontend. Браузеры — системный кэш Playwright (или PLAYWRIGHT_BROWSERS_PATH).
 * Страница открывается по file:// с ?shot=1 (панель скрыта, кадр = вьюпорт без масштаба, анимации выключены).
 * Порт не занимается. Браузеры закрываются в finally; никаких pkill.
 *
 * Что пишет в design/pd229-shots/  (cr-* chromium, wk-* webkit; @1x, если не указано -2x):
 *   <br>-<C>-<screen>-<theme>-<w>[-hover|-focus][-solid][-2x].png
 *     C      = A Колонка · B Стол · C Сайдбар
 *     screen = game (Today, партия идёт) · solved (Today, решено: карточка + Grid ∞) · hub (Play, режимы) · year · keys (список клавиш «?»)
 *     theme  = light · dark;   w = 1280 (×800) · 1440 (×900) · 1920 (×1080)
 *     -hover / -focus — показаны состояния наведения / фокуса с клавиатуры;  -solid — навигация без стекла (фолбэк)
 *   overview-<theme>.png — страница макета с панелью переключателей (1600×1000, только chromium)
 *
 * Автопроверки (печатаются «!» и в итоговую сводку): баннер #pd229-err (ошибки JS), ошибки консоли и PD229.check():
 * поле — 81 клетка, квадрат, ≥ 420 px, клетка ≥ 40 px, не выходит за окно (B, C); колонки/инспектор/навигация/диалоги внутри окна;
 * колонки B не переполнены по высоте; все кнопки ≥ 28×28 px (десктопный дефолт accessibility.md); однострочные подписи не обрезаны;
 * контраст КАЖДОГО видимого текста по computed-цветам ≥ 4.5:1 (≥ 3:1 для крупного) — с учётом стекла (полупрозрачные слои
 * смешиваются с фоном), кроме намеренно приглушённых закрытых цифр (opacity .4, как в приложении) и текста под затемнением диалога;
 * в состояниях hover/focus — демонстрация действительно есть.
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
const OUT = join(DIR, "pd229-shots");
const PAGE = pathToFileURL(join(DIR, "pd229-desktop.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 1280: { width: 1280, height: 800 }, 1440: { width: 1440, height: 900 }, 1920: { width: 1920, height: 1080 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const name = (o) => `${o.c}-${o.screen}-${o.theme}-${o.w}${o.st && o.st !== "none" ? "-" + o.st : ""}${o.glass === "off" ? "-solid" : ""}${o.dsf === 2 ? "-2x" : ""}`;
const add = (o, browsers = ["cr"]) => {
  const a = Object.assign({ screen: "game", theme: "light", w: "1440", st: "none", glass: "on", dsf: 1 }, o);
  SHOTS.push({ name: name(a), browsers, a });
};

// 1. Главная матрица: концепция × ширина × тема, экран партии — в обоих движках (Safari на Mac — вероятный браузер владельца).
for (const c of ["A", "B", "C"])
  for (const w of ["1280", "1440", "1920"])
    for (const theme of ["light", "dark"]) add({ c, w, theme }, ["cr", "wk"]);

// 2. Остальные экраны: каждая концепция на 1440 в обеих темах и на самом тесном 1280 (светлая).
for (const c of ["A", "B", "C"])
  for (const screen of ["solved", "hub", "year"]) {
    for (const theme of ["light", "dark"]) add({ c, screen, theme });
    add({ c, screen, w: "1280" });
  }
// Рекомендованная B — ещё и на 1920 (все экраны) и на 1280 тёмной.
for (const screen of ["solved", "hub", "year"]) add({ c: "B", screen, w: "1920" });
for (const screen of ["game", "solved", "hub", "year"]) add({ c: "B", screen, w: "1280", theme: "dark" });

// 3. Наведение и фокус с клавиатуры — по экранам, где они видны.
for (const c of ["A", "B", "C"]) for (const st of ["hover", "focus"]) add({ c, st });
for (const screen of ["hub", "year"]) for (const st of ["hover", "focus"]) add({ c: "B", screen, st });
add({ c: "B", st: "hover", theme: "dark" });
add({ c: "B", st: "focus", theme: "dark" });

// 4. Список клавиш «?» и фолбэк навигации без стекла.
for (const c of ["A", "B", "C"]) add({ c, screen: "keys" });
add({ c: "B", screen: "keys", theme: "dark" });
for (const theme of ["light", "dark"]) { add({ c: "B", glass: "off", theme }); add({ c: "C", glass: "off", theme }); }

// 5. Чёткие кадры рекомендованной B для просмотра на ретине.
for (const theme of ["light", "dark"]) add({ c: "B", theme, dsf: 2 }, ["cr", "wk"]);

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  try {
    for (const s of SHOTS.filter((x) => x.browsers.includes(prefix))) {
      const ctx = await browser.newContext({
        viewport: VIEW[s.a.w], deviceScaleFactor: s.a.dsf,
        colorScheme: s.a.theme === "dark" ? "dark" : "light", reducedMotion: "reduce"
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD229);
        const o = { c: s.a.c, w: s.a.w, theme: s.a.theme, screen: s.a.screen, st: s.a.st, glass: s.a.glass };
        await page.evaluate((x) => { PD229.reset(); PD229.apply(x); }, o);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
        const bannerText = await page.evaluate(() => { const b = document.getElementById("pd229-err"); return b ? b.textContent : null; });
        if (bannerText) errors.push("БАННЕР: " + bannerText.replace(/\s+/g, " "));
        const checks = await page.evaluate(() => PD229.check());
        const all = [...errors, ...checks];
        if (all.length) { console.log(`  ! ${prefix}-${s.name}: ${all.slice(0, 5).join(" | ")}`); problems.push(`${prefix}-${s.name}`); }
        else console.log(`  ok ${prefix}-${s.name}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}

async function overview() {
  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme });
      try {
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD229);
        await page.evaluate((t) => { PD229.reset(); PD229.apply({ theme: t }); }, theme);
        await page.screenshot({ path: join(OUT, `overview-${theme}.png`) });
        console.log(`  ok overview-${theme}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}

console.log(`кадров: chromium ${SHOTS.filter((s) => s.browsers.includes("cr")).length}, webkit ${SHOTS.filter((s) => s.browsers.includes("wk")).length}`);
console.log("chromium…");
await shoot(chromium, "cr");
console.log("webkit…");
await shoot(webkit, "wk");
console.log("обзор…");
await overview();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
