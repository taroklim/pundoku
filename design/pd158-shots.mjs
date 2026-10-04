/**
 * PD-158 — кадры макета design/pd158-tab-slide.html (слайд между вкладками, варианты A/B/C).
 *
 * Запуск (из products/pundoku):
 *   node design/pd158-shots.mjs
 *
 * Playwright в репо НЕ установлен (macOS 13 -> Playwright 1.49 живёт в /tmp/pd16-pw, как у
 * pd81/pd144-shots). Скрипт ищет его сам: сначала от cwd (если когда-нибудь поставят в репо),
 * затем в /tmp/pd16-pw. Если PLAYWRIGHT_BROWSERS_PATH не задан, а /tmp/pd16-pw/browsers есть —
 * подставляет его. Старый способ тоже работает:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd158-shots.mjs
 *
 * Порт не занимается: страница открывается по file:// (макет самодостаточный). Никаких pkill/killall.
 *
 * Что пишет в design/pd158-shots/:
 *   cr-*.png, wk-*.png   — кадры chromium/webkit, 390×844 @2x:
 *       <V>-<theme>-today-play-<000|025|050|075|100>.png  — доля ВРЕМЕНИ перехода (не хода: кривая нелинейна)
 *       <V>-light-today-year-050.png, A-light-today-year-through-050.png, B-light-year-today-050.png
 *       <V>-light-interrupt-*.png      — Today→Play заморожен на 40 %, тап Year, новый переход на 30 %
 *       rm-*.png                       — НАСТОЯЩИЙ prefers-reduced-motion (context reducedMotion:'reduce')
 *       rt-*.png                       — эмуляция Reduce Transparency (непрозрачный таб-бар посреди перехода)
 *       keep-play.png / keep-today-scroll.png — состояние партии и прокрутка пережили переключение
 *       overview-<theme>.png           — макет целиком с панелью (1280×960 @1x)
 *   seq-<V>-<theme>/NNNN.png + manifest.json — последовательности для GIF (только chromium, 390×844 @1x).
 *       История: Today (пауза) → Play (пауза) → Year (пауза) → Today прыжком (пауза).
 *       Кадры равномерны во времени (PD158_FPS, по умолчанию 30), паузы — копии кадра, так что GIF
 *       собирается с постоянной задержкой 1/fps (ffmpeg -framerate 30 -i %04d.png …). Замедление
 *       для разбора: PD158_SLOW=5.
 *
 * Автопроверки (печатаются как "!" и в итоговую сводку):
 *   - красный баннер #pd158-err макета и ошибки консоли;
 *   - после завершения перехода у ВСЕХ экранов computed transform === "none" (иначе экран стал бы
 *     containing block для position:fixed шитов — главный риск реализации, см. md §5).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
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
const OUT = join(DIR, "pd158-shots");
const URL = pathToFileURL(join(DIR, "pd158-tab-slide.html")).href + "?clean";
const URL_FULL = pathToFileURL(join(DIR, "pd158-tab-slide.html")).href;
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 960 };
const FPS = Number(process.env.PD158_FPS || 30);
const SLOW = Number(process.env.PD158_SLOW || 1);
const HOLD = Math.round(FPS * 0.5);
const pct = (p) => String(Math.round(p * 100)).padStart(3, "0");

/* ------------------------------------------------------------------ кадры */
const SHOTS = [];
for (const V of ["A", "B", "C"]) {
  for (const theme of ["light", "dark"]) {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      SHOTS.push({ name: `${V}-${theme}-today-play-${pct(p)}`, theme, V,
        run: (pg) => pg.evaluate(([p]) => pd158.frame(0, 1, p), [p]) });
    }
  }
  SHOTS.push({ name: `${V}-light-today-year-050`, theme: "light", V,
    run: (pg) => pg.evaluate(() => pd158.frame(0, 2, 0.5)) });
  SHOTS.push({ name: `${V}-light-interrupt-play40-year30`, theme: "light", V,
    run: (pg) => pg.evaluate(() => pd158.interrupt(0, 1, 2, 0.4, 0.3)) });
}
SHOTS.push({ name: "A-light-today-year-through-050", theme: "light", V: "A",
  run: (pg) => pg.evaluate(() => { pd158.jump("through"); pd158.frame(0, 2, 0.5); }) });
SHOTS.push({ name: "B-light-year-today-050", theme: "light", V: "B",
  run: (pg) => pg.evaluate(() => pd158.frame(2, 0, 0.5)) });
SHOTS.push({ name: "B-dark-today-play-050-noshadow", theme: "dark", V: "B",
  run: (pg) => pg.evaluate(() => pd158.frame(0, 1, 0.5)) });

/* Reduce Motion — системный media query, внутренний переключатель на «Как в системе». */
SHOTS.push({ name: "rm-A-light-today-play-050", theme: "light", V: "A", reduce: true,
  run: (pg) => pg.evaluate(() => pd158.frame(0, 1, 0.5)) });
SHOTS.push({ name: "rm-C-dark-today-play-050", theme: "dark", V: "C", reduce: true,
  run: (pg) => pg.evaluate(() => pd158.frame(0, 1, 0.5)) });
SHOTS.push({ name: "rm-B-light-today-year-050", theme: "light", V: "B", reduce: true,
  run: (pg) => pg.evaluate(() => pd158.frame(0, 2, 0.5)) });

/* Reduce Transparency: таб-бар непрозрачный, переход тот же. */
SHOTS.push({ name: "rt-A-dark-today-play-050", theme: "dark", V: "A",
  run: (pg) => pg.evaluate(() => { pd158.rt("on"); pd158.frame(0, 1, 0.5); }) });
SHOTS.push({ name: "rt-A-light-today-play-050", theme: "light", V: "A",
  run: (pg) => pg.evaluate(() => { pd158.rt("on"); pd158.frame(0, 1, 0.5); }) });

/* Состояние переживает переключение: ставим цифры на Play, уходим на Today и обратно. */
SHOTS.push({ name: "keep-play", theme: "light", V: "A", checkTransforms: true,
  run: async (pg) => {
    await pg.evaluate(() => pd158.set(1));
    for (const [cell, key] of [[2, 4], [3, 6], [5, 8], [10, 7]]) {
      await pg.click(`#b-play .cl[data-i="${cell}"]`);
      await pg.click(`#pad .key[data-k="${key}"]`);
    }
    await pg.evaluate(() => { pd158.go(0); pd158.finish(); pd158.go(1); pd158.finish(); });
  } });
SHOTS.push({ name: "keep-today-scroll", theme: "light", V: "C", checkTransforms: true,
  run: (pg) => pg.evaluate(() => {
    pd158.set(0); pd158.scroll("today", 420);
    pd158.go(2); pd158.finish(); pd158.go(0); pd158.finish();
  }) });

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function openPage(browser, { theme, reduce, viewport = PHONE, scale = 2, url = URL }) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: scale,
    colorScheme: theme === "dark" ? "dark" : "light",
    reducedMotion: reduce ? "reduce" : "no-preference"
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.pd158);
  // Тема — системная (colorScheme контекста); внутренний тумблер держим на «Авто».
  await page.evaluate(() => { pd158.theme("auto"); pd158.motion("system"); });
  return { ctx, page, errors };
}

async function collect(page, errors, label, checkTransforms) {
  const banner = await page.evaluate(() => { const b = document.getElementById("pd158-err"); return b ? b.textContent : null; });
  if (banner) errors.push("БАННЕР: " + banner.replace(/\s+/g, " "));
  if (checkTransforms) {
    const st = await page.evaluate(() => pd158.state());
    const bad = st.paneTransforms.filter((t) => t.split("|")[1] !== "none");
    if (st.running) errors.push("после finish остались анимации: " + st.running);
    if (bad.length) errors.push("на экранах остался transform: " + bad.join(", "));
  }
  if (errors.length) { console.log(`  ! ${label}: ${errors.slice(0, 3).join(" | ")}`); problems.push(label); }
  else console.log(`  ok ${label}`);
}

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  for (const s of SHOTS) {
    const { ctx, page, errors } = await openPage(browser, s);
    await page.evaluate((v) => { pd158.variant(v); pd158.slow(1); }, s.V);
    await s.run(page);
    await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
    await collect(page, errors, `${prefix}-${s.name}`, s.checkTransforms);
    await ctx.close();
  }
  // Обзор целиком: рамка + панель макета (без ?clean).
  for (const theme of ["light", "dark"]) {
    const { ctx, page, errors } = await openPage(browser, { theme, viewport: WIDE, scale: 1, url: URL_FULL });
    await page.evaluate(() => { pd158.variant("A"); pd158.frame(0, 1, 0.5); });
    await page.screenshot({ path: join(OUT, `${prefix}-overview-${theme}.png`), fullPage: true });
    await collect(page, errors, `${prefix}-overview-${theme}`);
    await ctx.close();
  }
  await browser.close();
}

/* ------------------------------------------------------------------ последовательности для GIF */
const STORY = [[0, 1], [1, 2], [2, 0]];   // Today→Play, Play→Year, Year→Today (прыжок через одну)

async function sequence(browser, V, theme) {
  const dir = join(OUT, `seq-${V}-${theme}`);
  mkdirSync(dir, { recursive: true });
  const { ctx, page, errors } = await openPage(browser, { theme, scale: 1 });
  await page.evaluate(([v, s]) => { pd158.variant(v); pd158.slow(s); pd158.set(0); }, [V, SLOW]);
  let n = 0;
  const name = () => join(dir, String(n).padStart(4, "0") + ".png");
  const hold = (src) => { for (let i = 0; i < HOLD; i++) { n++; copyFileSync(src, name()); } };

  await page.screenshot({ path: name() });
  hold(name());
  for (const [from, to] of STORY) {
    const dur = await page.evaluate(() => pd158.duration());
    const steps = Math.max(2, Math.round((dur / 1000) * FPS));
    await page.evaluate((t) => pd158.go(t), to);
    for (let k = 1; k < steps; k++) {
      await page.evaluate((p) => pd158.seek(p), k / steps);
      n++; await page.screenshot({ path: name() });
    }
    await page.evaluate(() => pd158.finish());
    n++; await page.screenshot({ path: name() });
    hold(name());
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    variant: V, theme, fps: FPS, slow: SLOW, frames: n + 1, holdFrames: HOLD,
    story: "Today → Play → Year → Today (jump)",
    gif: `ffmpeg -framerate ${FPS} -i %04d.png -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" seq-${V}-${theme}.gif`
  }, null, 2));
  await collect(page, errors, `seq-${V}-${theme} (${n + 1} кадров)`, true);
  await ctx.close();
}

console.log("chromium…");
await shoot(chromium, "cr");
console.log("webkit…");
await shoot(webkit, "wk");
console.log("последовательности (chromium)…");
{
  const browser = await chromium.launch();
  for (const [V, theme] of [["A", "light"], ["A", "dark"], ["B", "light"], ["C", "light"], ["C", "dark"]]) {
    await sequence(browser, V, theme);
  }
  await browser.close();
}
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
