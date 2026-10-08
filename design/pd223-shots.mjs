/**
 * PD-223 — кадры макета design/pd223-pet-motion.html (анимированный Питомец-клякса: A «Дыхание», B «Капля», C «Взгляд»).
 *
 * Запуск (из products/pundoku):
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd223-shots.mjs
 *
 * Playwright в репо не установлен. Ищется по очереди: от cwd, $PD_PW_HOME, /tmp/pundoku-qa/pw,
 * /Users/taroklim/Documents/KlymWork/gr487-w2/frontend. Браузеры — системный кэш Playwright (или PLAYWRIGHT_BROWSERS_PATH).
 * Страница открывается по file:// с ?shot=1 (панель скрыта, рамка = вьюпорт). Каждая анимация ставится на паузу в
 * заданный момент через Web Animations API (pause + currentTime) — кадры детерминированы, без ожиданий по таймеру.
 * Порт не занимается. Браузеры закрываются в finally; никаких pkill.
 *
 * Что пишет в design/pd223-shots/  (cr-* chromium, wk-* webkit):
 *   pet-<V>-<screen>-<mood>-<theme>-<w>[-ax3].png            @3x — состояние в покое (t = 0)
 *        V = A Дыхание · B Капля · C Взгляд;  screen: today (карточка результата) / year (лист дня Year)
 *   seq-<V>-<screen>-<act>-<mood>-<theme>-<w>-<NNN>[-rm].png  @3x — серия в контексте экрана, NNN = доля длительности ×100
 *        act: arrive (решил день) / sleep (доволен → спит) / wake (спит → доволен)
 *   strip-<action>-<theme>[-rm].png                           @2x — раскадровка: 3 варианта × 8 кадров, клякса 88 pt
 *        action: arrive-happy · arrive-tired · arrive-surprised · sleep · wake · idle · idle-asleep · blink
 *   overview-<theme>.png — интерактивная страница (1320×1700 @1x, только chromium)
 *
 * Автопроверки (печатаются «!» и в итоговую сводку): баннер #pd223-err (ошибки JS), ошибки консоли и PD223.check() —
 * питомец только в карточке/листе дня (никогда на поле), path без NaN, размер 44/40 pt, клякса не вылезает из карточки,
 * текст заголовка/подписи не заходит под кляксу, нет горизонтального переполнения рамки, однострочные подписи не обрезаны,
 * в keyframes анимируются ТОЛЬКО transform и opacity, при Reduce Motion ни один слой питомца не сдвигается и не
 * масштабируется ни в одной точке времени.
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
const OUT = join(DIR, "pd223-shots");
const PAGE = pathToFileURL(join(DIR, "pd223-pet-motion.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 320: { width: 320, height: 568 }, 390: { width: 390, height: 844 }, strip: { width: 1040, height: 560 } };
const VS = ["A", "B", "C"];

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (name, apply, view, dpr = 3) => SHOTS.push({ name, apply, view, dpr, theme: apply.theme || "light", rm: !!apply.rm });

// 1. Покой: каждый вариант × настроение × тема (карточка — 3 настроения, Year — доволен и спит).
for (const v of VS) {
  for (const theme of ["light", "dark"]) {
    for (const mood of ["happy", "tired", "surprised"]) add(`pet-${v}-today-${mood}-${theme}-390`, { screen: "today", v, mood, theme, w: "390" }, "390");
    for (const mood of ["happy", "asleep"]) add(`pet-${v}-year-${mood}-${theme}-390`, { screen: "year", v, mood, theme, w: "390" }, "390");
  }
  // 320 и AX3
  add(`pet-${v}-today-happy-light-320`, { screen: "today", v, mood: "happy", w: "320" }, "320");
  add(`pet-${v}-year-asleep-light-320`, { screen: "year", v, mood: "asleep", w: "320" }, "320");
  add(`pet-${v}-today-surprised-light-320-ax3`, { screen: "today", v, mood: "surprised", w: "320", ax3: true }, "320");
  add(`pet-${v}-year-asleep-dark-320-ax3`, { screen: "year", v, mood: "asleep", theme: "dark", w: "320", ax3: true }, "320");
  add(`pet-${v}-today-tired-dark-390-ax3`, { screen: "today", v, mood: "tired", theme: "dark", w: "390", ax3: true }, "390");
}

// 2. Серии в контексте экрана: доли длительности действия.
const FR = [0, 0.25, 0.45, 0.7, 1];
const pct = (f) => String(Math.round(f * 100)).padStart(3, "0");
for (const v of VS) {
  for (const f of FR) {
    add(`seq-${v}-today-arrive-happy-light-390-${pct(f)}`, { screen: "today", v, mood: "happy", act: "arrive", tf: f }, "390");
    add(`seq-${v}-today-arrive-surprised-dark-390-${pct(f)}`, { screen: "today", v, mood: "surprised", act: "arrive", tf: f, theme: "dark" }, "390");
    add(`seq-${v}-year-sleep-asleep-light-390-${pct(f)}`, { screen: "year", v, mood: "asleep", from: "happy", act: "sleep", tf: f }, "390");
    add(`seq-${v}-year-wake-happy-dark-390-${pct(f)}`, { screen: "year", v, mood: "happy", from: "asleep", act: "wake", tf: f, theme: "dark" }, "390");
  }
  // Reduce Motion: середина действия — должно быть только растворение, без сдвига/масштаба.
  add(`seq-${v}-today-arrive-happy-light-390-050-rm`, { screen: "today", v, mood: "happy", act: "arrive", tf: 0.5, rm: true }, "390");
  add(`seq-${v}-year-wake-happy-dark-390-050-rm`, { screen: "year", v, mood: "happy", from: "asleep", act: "wake", tf: 0.5, theme: "dark", rm: true }, "390");
  // 320 × AX3: самый «широкий» кадр B (сплющивание) не должен вылезать из карточки.
  add(`seq-${v}-today-arrive-tired-light-320-045-ax3`, { screen: "today", v, mood: "tired", act: "arrive", tf: 0.45, w: "320", ax3: true }, "320");
}

// 3. Раскадровки: все три варианта рядом.
const STRIPS = ["arrive-happy", "arrive-tired", "arrive-surprised", "sleep", "wake", "idle", "idle-asleep", "blink"];
for (const s of STRIPS) {
  for (const theme of ["light", "dark"]) add(`strip-${s}-${theme}`, { screen: "strip", strip: s, theme }, "strip", 2);
  add(`strip-${s}-light-rm`, { screen: "strip", strip: s, theme: "light", rm: true }, "strip", 2);
}

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  try {
    for (const s of SHOTS) {
      const ctx = await browser.newContext({
        viewport: VIEW[s.view], deviceScaleFactor: s.dpr,
        colorScheme: s.theme === "dark" ? "dark" : "light",
        reducedMotion: s.rm ? "reduce" : "no-preference",
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD223);
        await page.evaluate((o) => { PD223.reset(); PD223.apply(o); }, s.apply);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
        const bannerText = await page.evaluate(() => { const b = document.getElementById("pd223-err"); return b && !b.hidden ? b.textContent : null; });
        if (bannerText) errors.push("БАННЕР: " + bannerText.replace(/\s+/g, " "));
        const checks = await page.evaluate(() => PD223.check());
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
      const ctx = await browser.newContext({ viewport: { width: 1320, height: 1700 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "no-preference" });
      try {
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD223);
        await page.evaluate((t) => PD223.ui({ theme: t, rm: "off" }), theme);
        await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
        const checks = await page.evaluate(() => PD223.check());
        if (checks.length) { console.log(`  ! overview-${theme}: ${checks.slice(0, 4).join(" | ")}`); problems.push(`overview-${theme}`); }
        else console.log(`  ok overview-${theme}`);
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
