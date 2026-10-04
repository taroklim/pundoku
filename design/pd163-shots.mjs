/**
 * PD-163 — кадры макета design/pd163-modes-layout.html (размещение режимов на Play, варианты A/B/C).
 *
 * Запуск (из products/pundoku):
 *   node design/pd163-shots.mjs
 *
 * Playwright в репо не установлен (macOS 13 -> Playwright 1.49 живёт в /tmp/pd16-pw, как у
 * pd81/pd144/pd158-shots). Скрипт ищет его сам: сначала от cwd, затем в /tmp/pd16-pw; если
 * PLAYWRIGHT_BROWSERS_PATH не задан, а /tmp/pd16-pw/browsers есть — подставляет его.
 * Страница открывается по file:// с ?shot=1 (панель макета скрыта, рамка = вьюпорт). Порт не занимается.
 *
 * Что пишет в design/pd163-shots/:
 *   cr-*.png (chromium), wk-*.png (webkit), @3x:
 *     <V>-<state>-<w>-<theme>-<lang>[-ax3][-rt].png
 *     V = A (владелец: плитки) · B (Классика + список) · C (список режимов, рекомендация)
 *     state: hub-one / hub-many / hub-none / sheet-<mode> / sheet-new (из меню «⋯», с предупреждением) /
 *            game-<mode> / menu / ctx-<mode> / pet
 *   overview-<theme>.png — макет с панелью (1280×1000 @1x, только chromium)
 *
 * Автопроверки (печатаются как «!» и в итоговую сводку): красный баннер #pd163-err, ошибки консоли и
 * PD163.check() — горизонтальное переполнение, обрезанный текст, цель < 44 pt, «Начать»/«Отмена» шита
 * за краем экрана, прокручивающийся экран партии, поле < 150 px.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
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
const OUT = join(DIR, "pd163-shots");
const PAGE = pathToFileURL(join(DIR, "pd163-modes-layout.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 320: { width: 320, height: 568 }, 390: { width: 390, height: 844 }, 430: { width: 430, height: 932 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (V, state, w, theme, lang, o = {}, flags = {}) => {
  const name = [V, state, w, theme, lang, flags.ax3 ? "ax3" : "", flags.rt ? "rt" : ""].filter(Boolean).join("-");
  SHOTS.push({ name, w, theme, apply: { v: V, theme, lang, w: String(w), type: flags.ax3 ? "ax3" : "17", rt: flags.rt ? "on" : "off", ...o } });
};

for (const V of ["A", "B", "C"]) {
  // Хаб: одна незавершённая (день + Лжец), несколько (день + 4 режима), ни одной.
  for (const theme of ["light", "dark"]) {
    for (const w of [390, 320]) add(V, "hub-one", w, theme, "en", { screen: "hub", cont: "one" });
  }
  add(V, "hub-many", 390, "light", "en", { screen: "hub", cont: "many", first: "off" });
  add(V, "hub-many", 320, "light", "uk", { screen: "hub", cont: "many", first: "off" });
  add(V, "hub-none", 390, "light", "ru", { screen: "hub", cont: "none" });
  add(V, "hub-one", 430, "light", "en", { screen: "hub", cont: "one" });
  // Крупный текст: самые длинные строки (uk/ru).
  add(V, "hub-many", 390, "light", "uk", { screen: "hub", cont: "many", first: "off" }, { ax3: true });
  add(V, "hub-one", 320, "dark", "ru", { screen: "hub", cont: "one" }, { ax3: true });
  // Reduce Transparency: непрозрачный таб-бар (и hub-bar у B).
  add(V, "hub-one", 390, "dark", "en", { screen: "hub", cont: "one" }, { rt: true });

  // Шит режима при первом входе: описание + сложность + «Начать».
  for (const theme of ["light", "dark"]) add(V, "sheet-melody", 390, theme, "en", { screen: "sheet", mode: "melody", cont: "none", viaNew: false });
  add(V, "sheet-lantern", 320, "light", "uk", { screen: "sheet", mode: "lantern", cont: "none", viaNew: false });
  add(V, "sheet-liar", 320, "light", "ru", { screen: "sheet", mode: "liar", cont: "none", viaNew: false }, { ax3: true });
  add(V, "sheet-glyphs", 390, "dark", "uk", { screen: "sheet", mode: "glyphs", cont: "none", viaNew: false }, { ax3: true });

  // Шапка партии: чип режима (Классика — без чипа).
  for (const theme of ["light", "dark"]) add(V, "game-liar", 390, theme, "en", { screen: "game", mode: "liar", cont: "one" });
  add(V, "game-classic", 390, "light", "en", { screen: "game", mode: "classic", cont: "many" });
  add(V, "game-lantern", 320, "light", "uk", { screen: "game", mode: "lantern", cont: "many" });
  add(V, "game-ink", 320, "light", "ru", { screen: "game", mode: "ink", cont: "many" }, { ax3: true });

  // Меню «⋯» и «Новая сетка» из партии (A/C: шит этого же режима с предупреждением об отбрасывании).
  add(V, "menu", 390, "light", "en", { screen: "menu", mode: "liar", cont: "one" });
  add(V, "sheet-new", 390, "light", "uk", { screen: "sheet", mode: "liar", cont: "one", viaNew: true });
  add(V, "sheet-new", 320, "light", "ru", { screen: "sheet", mode: "liar", cont: "one", viaNew: true }, { ax3: true });

  // Долгое нажатие на плитку/строку (A, C): контекстное меню с описанием режима в заголовке.
  if (V !== "B") {
    add(V, "ctx-liar", 390, "light", "en", { screen: "ctx", mode: "liar", cont: "one" });
    add(V, "ctx-glyphs", 390, "dark", "ru", { screen: "ctx", mode: "glyphs", cont: "one" });
    add(V, "ctx-melody", 320, "light", "uk", { screen: "ctx", mode: "melody", cont: "one" });
  }
}
// Питомец — опция в Настройках, одинаковая во всех вариантах.
for (const theme of ["light", "dark"]) add("C", "pet", 390, theme, "en", { screen: "pet", pet: true });
add("C", "pet", 320, "light", "uk", { screen: "pet", pet: true }, { ax3: true });
add("C", "pet", 390, "light", "ru", { screen: "pet", pet: false });

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: VIEW[s.w], deviceScaleFactor: 3,
      colorScheme: s.theme === "dark" ? "dark" : "light", reducedMotion: "reduce"
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD163);
    await page.evaluate((o) => { PD163.reset(); PD163.apply(o); }, s.apply);
    // Контекстное меню позиционируется после раскладки — даём кадру отрисоваться.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
    const banner = await page.evaluate(() => { const b = document.getElementById("pd163-err"); return b ? b.textContent : null; });
    if (banner) errors.push("БАННЕР: " + banner.replace(/\s+/g, " "));
    const checks = await page.evaluate(() => PD163.check());
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    await page.goto(PAGE, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD163);
    await page.evaluate((t) => { PD163.reset(); PD163.apply({ theme: t, v: "C", cont: "one" }); }, theme);
    await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
    console.log(`  ok overview-${theme}`);
    await ctx.close();
  }
  await browser.close();
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
