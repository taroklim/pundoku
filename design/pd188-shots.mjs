/**
 * PD-188 — кадры макета design/pd188-loading.html (экран ожидания генерации: A «Капля», B знак P4 + унос, B′ архивный D5).
 *
 * Запуск (из products/pundoku):
 *   node design/pd188-shots.mjs
 *
 * Playwright в репо не установлен — живёт в /tmp/pd161-pw (как у pd161-*). Скрипт ищет его сам: от cwd, затем в
 * /tmp/pd161-pw; PLAYWRIGHT_BROWSERS_PATH подставляется, если есть /tmp/pd161-pw/browsers. Страница открывается по
 * file:// с ?shot=1 — порт не занимается (диапазон 4700–4799 не нужен). Браузеры закрываются в finally.
 *
 * Движение замораживается через Web Animations API (PD188.freeze(t): все анимации рамки на паузе, currentTime = t мс от
 * появления панели; стаггер-задержки учитываются сами). reducedMotion контекста — "no-preference": Reduce Motion
 * включается тумблером страницы (класс .rm даёт те же --mo:0/--mk:.72, что tokens.css).
 *
 * Что пишет в design/pd188-shots/  (cr-* chromium, wk-* webkit, @3x):
 *   <V>-<state>-<t>-<theme>-<w>[-ax3][-rm|-rmfade][-<lang>].png
 *     V     A (Капля) · P4 (B, знак P4 + унос) · D5 (B′, архив)
 *     state wait (панель) · long (> 4 с: второй текст + «Отмена») · error · pre (0–600 мс) · ready
 *     t     миллисекунда движения, на которой заморожен кадр
 *   overview-<theme>.png — вся страница с панелью и раскадровкой (1280 px @1x, chromium)
 *
 * Автопроверки (печатаются «!» и в итоговую сводку): красный баннер #pd188-err, ошибки консоли, PD188.check() —
 * индикатор отрисован (непустой bbox, без NaN), ничего не заходит под таб-бар и не выходит за рамку, кнопки ≥ 44 pt,
 * индикатор не налезает на текст.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const PW_HOME = "/tmp/pd161-pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
}
function loadPlaywright() {
  const bases = [process.cwd() + "/", PW_HOME + "/"];
  const tried = [];
  for (const b of bases) {
    try { return createRequire(b)("playwright"); } catch (e) { tried.push(b + " (" + e.code + ")"); }
  }
  console.error("Playwright не найден. Искал от: " + tried.join(", ") +
    "\nПоставь его в /tmp/pd161-pw (npm i playwright@1.49 && npx playwright install chromium webkit).");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd188-shots");
const PAGE = pathToFileURL(join(DIR, "pd188-loading.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 390: { width: 390, height: 844 }, 320: { width: 320, height: 568 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (o) => {
  const a = { variant: "P4", pet: "on", theme: "light", w: "390", type: "17", rm: "off", lang: "en", mode: "expert", state: "wait", t: 0, ...o };
  const name = [a.variant, a.state, a.t, a.theme, a.w, a.type === "ax3" ? "ax3" : null, a.rm === "static" ? "rm" : a.rm === "fade" ? "rmfade" : null,
    a.lang !== "en" ? a.lang : null, a.mode === "liar" ? "liar" : null].filter((x) => x !== null).join("-");
  SHOTS.push({ name, a, webkit: !!o.webkit });
};

// Ключевые кадры движения (мс от появления панели). A: вдох, пик, моргание. P4: первая унесённая клетка, середина обхода, последняя.
const KEY = { A: [0, 700, 1150], P4: [216, 1016, 1816], D5: [0, 1000, 1700] };
const SIZES = [{ w: "390", type: "17" }, { w: "320", type: "ax3" }];

for (const variant of ["A", "P4"]) {
  for (const theme of ["light", "dark"]) {
    for (const sz of SIZES) {
      for (const t of KEY[variant]) add({ variant, theme, ...sz, t, webkit: sz.w === "390" && t === KEY[variant][1] });
      add({ variant, theme, ...sz, rm: "static" });                       // Reduce Motion: статичный кадр
      add({ variant, theme, ...sz, state: "long", t: KEY[variant][1] });   // > 4 с: второй текст + «Отмена»
      add({ variant, theme, ...sz, state: "error" });                      // таймаут: «Не удалось» + «Повторить»/«Отмена»
    }
  }
}
// Самые длинные строки — ru/uk на 320 AX3 (проверка переносов и таб-бара).
for (const lang of ["ru", "uk"]) for (const state of ["long", "error"]) add({ variant: "P4", w: "320", type: "ax3", lang, state, t: 1016, webkit: true });
// Лжец (чип режима в подписи), RM «только прозрачность» (вариант к обсуждению), фазы до порога и готовность.
add({ variant: "P4", mode: "liar", t: 1016 });
add({ variant: "P4", rm: "fade", t: 1200 });
add({ variant: "P4", state: "pre" });
add({ variant: "P4", state: "ready" });
add({ variant: "P4", state: "ready", theme: "dark" });
// Питомец выключен в Настройках → вместо A показывается B (рекомендация §3).
add({ variant: "A", pet: "off", t: 1016 });
// B′ архивный D5 — только светлая/тёмная 390.
for (const theme of ["light", "dark"]) for (const t of KEY.D5) add({ variant: "D5", theme, t });
add({ variant: "D5", rm: "static" });

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function shoot(browserType, prefix, onlyFlagged) {
  const browser = await browserType.launch();
  try {
    for (const s of SHOTS) {
      if (onlyFlagged && !s.webkit) continue;
      const ctx = await browser.newContext({
        viewport: VIEW[s.a.w], deviceScaleFactor: 3, colorScheme: s.a.theme, reducedMotion: "no-preference",
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD188);
        const { t, ...apply } = s.a;
        await page.evaluate((o) => { PD188.reset(); PD188.apply(o); }, apply);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.evaluate((ms) => PD188.freeze(ms), t);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.locator("#ph").screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
        const banner = await page.evaluate(() => { const b = document.getElementById("pd188-err"); return b && !b.hidden ? b.textContent : null; });
        if (banner) errors.push("БАННЕР: " + banner.replace(/\s+/g, " "));
        const checks = await page.evaluate(() => PD188.check());
        const all = [...errors, ...checks];
        if (all.length) { console.log(`  ! ${prefix}-${s.name}: ${all.slice(0, 4).join(" | ")}`); problems.push(`${prefix}-${s.name}`); }
        else console.log(`  ok ${prefix}-${s.name}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function overview() {
  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "no-preference" });
      try {
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD188);
        await page.evaluate((th) => { PD188.reset(); PD188.apply({ theme: th }); }, theme);
        await page.waitForTimeout(300);
        await page.evaluate(() => PD188.freeze(1016));
        await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
        console.log(`  ok overview-${theme}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

console.log(`кадров: chromium ${SHOTS.length}, webkit ${SHOTS.filter((s) => s.webkit).length}`);
console.log("chromium…");
await shoot(chromium, "cr", false);
console.log("webkit…");
await shoot(webkit, "wk", true);
console.log("обзор…");
await overview();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
