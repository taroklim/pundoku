/**
 * PD-170 — кадры макета design/pd170-pet-glyphs.html (питомец-клякса A/B/C и наборы глифов A/B/C + цифры D).
 *
 * Запуск (из products/pundoku):
 *   node design/pd170-shots.mjs
 *
 * Playwright в репо не установлен (macOS 13 -> Playwright 1.49 живёт в /tmp/pd16-pw, как у pd163-shots).
 * Скрипт ищет его сам: сначала от cwd, затем в /tmp/pd16-pw; если PLAYWRIGHT_BROWSERS_PATH не задан, а
 * /tmp/pd16-pw/browsers есть — подставляет его. Страница открывается по file:// с ?shot=1 (панель скрыта,
 * рамка = вьюпорт). Порт не занимается.
 *
 * Что пишет в design/pd170-shots/  (cr-* chromium, wk-* webkit, @3x):
 *   pet-<V>-<screen>-<mood>-<theme>[-fc].png   V = A Капля · B Брызги · C Точка
 *        screen: today (карточка результата) / year (страница дня в шите Year) / settings / petspec (24–64 pt)
 *        -fc — настоящий forced-colors (только chromium: webkit его не эмулирует)
 *   gl-<S>-<screen>-<theme>-<w>[-<sim>][-fc].png   S = A Фигуры · B Мягкие · C Рукописные · D цифры (сравнение)
 *        screen: board (поле 9×9 + пад) / glyphspec (заметки ×3, ближайшие пары, таблица набора)
 *        sim: gray / deut / prot — симуляция цветового зрения на всю рамку
 *   overview-<theme>.png — макет с панелью (1280×1000 @1x, только chromium)
 *   metrics.json — метрики различимости наборов (IoU ближайших пар на размере заметки, разброс «веса»)
 *
 * Автопроверки (печатаются как «!» и в итоговую сводку): красный баннер #pd170-err (ошибки JS), ошибки консоли и
 * PD170.check() — SVG питомца/глифов реально отрисован (непустой bbox, валидный path без NaN), горизонтальное
 * переполнение рамки, обрезанный однострочный текст, 81 клетка, цели пада >= 44 pt в высоту и >= 28 pt в ширину,
 * 9 глифов на паде, метрики считаются без NaN, питомец не попал на поле.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const PW_HOME = "/tmp/pd16-pw";
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
    "\nПоставь его в /tmp/pd16-pw (npm i playwright@1.49 && npx playwright install chromium webkit).");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd170-shots");
const PAGE = pathToFileURL(join(DIR, "pd170-pet-glyphs.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 320: { width: 320, height: 568 }, 390: { width: 390, height: 844 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (name, apply, o = {}) => SHOTS.push({ name, w: apply.w || "390", theme: apply.theme || "light", fc: !!o.fc, apply });

// Питомец: 3 варианта × (карточка дня в 3 настроениях, Year «спит» и «доволен», настройки, размеры) × светлая/тёмная.
for (const pv of ["A", "B", "C"]) {
  for (const theme of ["light", "dark"]) {
    for (const mood of ["happy", "tired", "surprised"]) add(`pet-${pv}-today-${mood}-${theme}`, { screen: "today", pv, mood, theme });
    add(`pet-${pv}-year-asleep-${theme}`, { screen: "year", pv, mood: "asleep", theme });
    add(`pet-${pv}-settings-all-${theme}`, { screen: "settings", pv, theme, pet: true });
    add(`pet-${pv}-petspec-all-${theme}`, { screen: "petspec", pv, theme });
  }
  add(`pet-${pv}-year-happy-light`, { screen: "year", pv, mood: "happy", theme: "light" });
  add(`pet-${pv}-today-happy-light-320`, { screen: "today", pv, mood: "happy", theme: "light", w: "320" });
}
add("pet-A-settings-off-light", { screen: "settings", pv: "A", theme: "light", pet: false });
add("pet-A-today-off-light", { screen: "today", pv: "A", mood: "happy", theme: "light", pet: false });
add("pet-A-petspec-all-light-fc", { screen: "petspec", pv: "A", theme: "light" }, { fc: true });
add("pet-A-today-happy-dark-fc", { screen: "today", pv: "A", mood: "happy", theme: "dark" }, { fc: true });

// Глифы: 3 набора × (поле, проверка) × светлая/тёмная; 320; симуляции цветового зрения; forced-colors. D — цифры для сравнения.
for (const gs of ["A", "B", "C"]) {
  for (const theme of ["light", "dark"]) {
    add(`gl-${gs}-board-${theme}-390`, { screen: "board", gs, theme });
    add(`gl-${gs}-glyphspec-${theme}-390`, { screen: "glyphspec", gs, theme });
  }
  add(`gl-${gs}-board-light-320`, { screen: "board", gs, theme: "light", w: "320" });
  add(`gl-${gs}-board-light-390-gray`, { screen: "board", gs, theme: "light", sim: "gray" });
  add(`gl-${gs}-board-light-390-deut`, { screen: "board", gs, theme: "light", sim: "deut" });
}
add("gl-A-board-light-390-prot", { screen: "board", gs: "A", theme: "light", sim: "prot" });
add("gl-A-board-dark-390-fc", { screen: "board", gs: "A", theme: "dark" }, { fc: true });
for (const theme of ["light", "dark"]) add(`gl-D-board-${theme}-390`, { screen: "board", gs: "D", theme });

/* ------------------------------------------------------------------ съёмка */
const problems = [];
let metricsDump = null;

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  const isChromium = browserType === chromium;
  for (const s of SHOTS) {
    if (s.fc && !isChromium) continue; // webkit не эмулирует forced-colors
    const ctx = await browser.newContext({
      viewport: VIEW[s.w], deviceScaleFactor: 3,
      colorScheme: s.theme === "dark" ? "dark" : "light", reducedMotion: "reduce",
      ...(s.fc ? { forcedColors: "active" } : {})
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD170);
    await page.evaluate((o) => { PD170.reset(); PD170.apply(o); }, s.apply);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
    const bannerText = await page.evaluate(() => { const b = document.getElementById("pd170-err"); return b ? b.textContent : null; });
    if (bannerText) errors.push("БАННЕР: " + bannerText.replace(/\s+/g, " "));
    const checks = await page.evaluate(() => PD170.check());
    if (!metricsDump && isChromium) {
      metricsDump = await page.evaluate(() => Object.fromEntries(["A", "B", "C"].map((k) => [k, PD170.metrics(k)])));
    }
    const all = [...errors, ...checks];
    if (all.length) { console.log(`  ! ${prefix}-${s.name}: ${all.slice(0, 4).join(" | ")}`); problems.push(`${prefix}-${s.name}`); }
    else console.log(`  ok ${prefix}-${s.name}`);
    await ctx.close();
  }
  await browser.close();
}

async function overview() {
  const browser = await chromium.launch();
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(PAGE, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD170);
    await page.evaluate((t) => { PD170.reset(); PD170.apply({ theme: t }); }, theme);
    await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
    console.log(`  ok overview-${theme}`);
    await ctx.close();
  }
  await browser.close();
}

console.log(`кадров на браузер: ${SHOTS.length} (forced-colors — только chromium)`);
console.log("chromium…");
await shoot(chromium, "cr");
console.log("webkit…");
await shoot(webkit, "wk");
console.log("обзор…");
await overview();
if (metricsDump) {
  writeFileSync(join(OUT, "metrics.json"), JSON.stringify(metricsDump, null, 2));
  for (const [k, m] of Object.entries(metricsDump)) {
    console.log(`  набор ${k}: разброс веса ${m.spread.toFixed(2)}; ближайшие пары ` +
      m.top.map((p) => `${p.a}-${p.b} ${p.iou.toFixed(2)}`).join(", "));
  }
}
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
