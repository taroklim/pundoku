/**
 * PD-189 — экран ожидания генерации (вариант B макета PD-188) на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5189 --strictPort
 *   PD_PW_HOME=/tmp/pd161-pw BASE=http://localhost:5189 node design/pd189-shots.mjs
 *
 * Генерация НЕ настоящая: `window.Worker` подменяется заглушкой (addInitScript). Запросы Play (`seed`) отвечают по команде
 * скрипта — `__pd189.mode`: "hold" (держим, пока не отпустят), "fail" (ошибка), число мс (готовая сетка через N мс); запросы
 * сетки дня (`date`, Today) отвечают сразу. Сетка — `dailyPuzzle` движка, посчитанный в Node.
 *
 * Кадры: ожидание (до 4 с), «долго» (после 4 с, «Отмена»), ошибка («Не удалось» + «Повторить»/«Отмена»), Reduce Motion;
 * 320 / 430, light / dark, en / uk / ru, AX3 (html 40 px). Анимации знака замораживаются на кадре 1016 мс (пятая клетка — верх
 * чаши — на пике уноса), RM — на 1200 мс (середина «дыхания» прозрачностью).
 * Проверки: пороги (300 мс — панели нет; 900 мс — панель ≥ 700 мс), «Отмена» → хаб, «Повторить» → панель сразу,
 * группа панели не уходит под таб-бар и не залезает под подпись, нет горизонтального скролла, нет ошибок консоли.
 * Никаких pkill: браузеры закрываются в finally.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PW_HOME = process.env.PD_PW_HOME || "/tmp/pd161-pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
function loadPlaywright() {
  for (const b of [process.cwd() + "/", PW_HOME + "/"]) {
    try {
      return createRequire(b)("playwright");
    } catch {
      /* следующий */
    }
  }
  console.error("Playwright не найден (cwd, " + PW_HOME + ")");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();
const { dailyPuzzle } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);

const BASE = process.env.BASE ?? "http://localhost:5189";
const OUT = join(HERE, "pd189-shots");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const P = dailyPuzzle("2026-10-05", "easy");
const PUZZLE = { mission: P.mission, solution: P.solution, difficulty: P.difficulty, seed: P.seed };

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const CONFIGS = [
  { w: 430, h: 932, scheme: "light", lang: "en" },
  { w: 430, h: 932, scheme: "dark", lang: "ru" },
  { w: 320, h: 568, scheme: "light", lang: "uk" },
  { w: 320, h: 568, scheme: "dark", lang: "en" },
  { w: 320, h: 568, scheme: "light", lang: "ru", ax3: true },
  { w: 430, h: 932, scheme: "dark", lang: "uk", ax3: true },
  { w: 430, h: 932, scheme: "light", lang: "en", rm: true },
  { w: 320, h: 568, scheme: "dark", lang: "ru", rm: true },
];

function stub({ puzzle }) {
  window.__pd189 = { mode: "hold", pending: [], log: [] };
  const Real = window.Worker;
  class FakeWorker {
    constructor(url, opts) {
      this.url = String(url);
      this.opts = opts;
      this.onmessage = null;
      this.onerror = null;
      this.dead = false;
    }
    postMessage(req) {
      const reply = (res) => {
        if (!this.dead && this.onmessage) this.onmessage({ data: res });
      };
      if (req.date !== undefined || !/generate\.worker/.test(this.url)) {
        // Сетка дня / прочие воркеры — как обычно, через настоящий Worker.
        const w = new Real(this.url, this.opts);
        w.onmessage = (e) => reply(e.data);
        w.onerror = (e) => this.onerror?.(e);
        w.postMessage(req);
        this.real = w;
        return;
      }
      const s = window.__pd189;
      s.log.push({ t: performance.now(), id: req.id });
      const done = () => reply({ id: req.id, ok: true, puzzle });
      if (s.mode === "fail") setTimeout(() => reply({ id: req.id, ok: false, error: "stub" }), 50);
      else if (typeof s.mode === "number") setTimeout(done, s.mode);
      else s.pending.push(done);
    }
    terminate() {
      this.dead = true;
      this.real?.terminate();
    }
    addEventListener() {}
    removeEventListener() {}
  }
  window.Worker = FakeWorker;
  // Наблюдение за панелью: когда появилась/исчезла (для проверки порогов).
  window.__pd189.seen = [];
  const watch = () => {
    let was = false;
    new MutationObserver(() => {
      const on = !!document.querySelector('[data-testid="wait-panel"]');
      if (on !== was) {
        was = on;
        window.__pd189.seen.push({ on, t: performance.now() });
      }
    }).observe(document.documentElement, { subtree: true, childList: true });
  };
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch);
}

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[c.lang],
    serviceWorkers: "block",
  });
  await ctx.addInitScript(stub, { puzzle: PUZZLE });
  await ctx.addInitScript(
    ({ lang, ax3 }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
      } catch {
        /* приватный режим */
      }
      if (ax3) {
        const add = () => {
          const s = document.createElement("style");
          s.textContent = "html{font-size:40px !important}";
          document.documentElement.appendChild(s);
        };
        if (document.documentElement) add();
        else document.addEventListener("DOMContentLoaded", add);
      }
    },
    { lang: c.lang, ax3: !!c.ax3 },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::/.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs };
}

const setMode = (page, mode) => page.evaluate((m) => (window.__pd189.mode = m), mode);
const release = (page) => page.evaluate(() => window.__pd189.pending.splice(0).forEach((f) => f()));

async function toHub(page) {
  await page.goto(`${BASE}/#/play`);
  await page.locator('[data-testid="mode-classic"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
}
async function start(page) {
  await page.locator('[data-testid="mode-classic"]').click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator('[data-testid="sheet-start"]').click();
}
/** Заморозить все анимации знака/панели на кадре `ms` (CSS-анимации, getAnimations). */
const freeze = (page, ms) =>
  page.evaluate((ms) => {
    const p = document.querySelector('[data-testid="wait-panel"]');
    if (!p) return 0;
    const all = p.getAnimations({ subtree: true });
    for (const a of all) {
      a.pause();
      // Появление панели/текста/кнопок — конечное состояние; цикл знака — кадр `ms` от старта (currentTime включает задержку
      // стаггера: клетка i на локальном времени ms − 200·i).
      a.currentTime = a.animationName === "waitIn" ? 10000 : ms;
    }
    return all.length;
  }, ms);
const unfreeze = (page) => page.evaluate(() => document.querySelector('[data-testid="wait-panel"]')?.getAnimations({ subtree: true }).forEach((a) => a.play()));

/** Геометрия: группа панели в пределах экрана, над таб-баром, не выше верха поля. */
const geom = (page) =>
  page.evaluate(() => {
    const g = document.querySelector(".wait-grp")?.getBoundingClientRect();
    const wrap = document.querySelector(".board-wrap")?.getBoundingClientRect();
    const tab = document.querySelector(".tabbar")?.getBoundingClientRect();
    const btns = [...document.querySelectorAll(".wait-btn")].map((b) => b.getBoundingClientRect());
    return {
      g: g && [Math.round(g.top), Math.round(g.bottom), Math.round(g.left), Math.round(g.right)],
      wrapTop: wrap && Math.round(wrap.top),
      tabTop: tab && Math.round(tab.top),
      minBtnH: btns.length ? Math.min(...btns.map((b) => b.height)) : null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mark: document.querySelector(".wait-mark")?.getBoundingClientRect().width,
      text: document.querySelector(".wait-text")?.textContent,
      btnTexts: [...document.querySelectorAll(".wait-btn")].map((b) => b.textContent),
      ax3: document.documentElement.getAttribute("data-type"),
    };
  });
function checkGeom(tag, m) {
  const fits = m.g && m.g[0] >= m.wrapTop - 1 && m.g[1] <= m.tabTop && m.g[2] >= 0 && !m.overflowX;
  ok(`${tag} раскладка`, !!fits && (m.minBtnH === null || m.minBtnH >= 44), JSON.stringify(m));
}

async function flow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}`;
  try {
    const { page, errs } = await open(browser, c);
    await toHub(page);
    // 1) Ожидание (до 4 с) → 2) «долго» (после 4 с, «Отмена»).
    await setMode(page, "hold");
    await start(page);
    await page.locator('[data-testid="wait-panel"]').waitFor({ timeout: 3000 });
    await page.waitForTimeout(500);
    await freeze(page, c.rm ? 1200 : 1016);
    const m1 = await geom(page);
    await page.screenshot({ path: join(OUT, `${tag}-1-wait.png`) });
    checkGeom(`${tag} wait`, m1);
    await unfreeze(page);
    await page.locator('[data-testid="wait-cancel"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    await freeze(page, c.rm ? 1200 : 1016);
    const m2 = await geom(page);
    await page.screenshot({ path: join(OUT, `${tag}-2-long.png`) });
    checkGeom(`${tag} long`, m2);
    ok(`${tag} long: второй текст заменил первый`, m2.text !== m1.text && m2.btnTexts.length === 1, `${m1.text} → ${m2.text} [${m2.btnTexts}]`);
    // «Отмена» → хаб.
    await unfreeze(page);
    await page.locator('[data-testid="wait-cancel"]').click();
    await page.locator('[data-testid="mode-classic"]').waitFor({ timeout: 3000 });
    ok(`${tag} «Отмена» → хаб`, (await page.locator('[data-testid="wait-panel"]').count()) === 0);
    // 3) Ошибка → «Повторить» → панель сразу → сетка.
    await setMode(page, "fail");
    await start(page);
    await page.locator('[data-testid="wait-retry"]').waitFor({ timeout: 3000 });
    await page.waitForTimeout(400);
    const m3 = await geom(page);
    await page.screenshot({ path: join(OUT, `${tag}-3-error.png`) });
    checkGeom(`${tag} error`, m3);
    ok(`${tag} error: «Повторить» + «Отмена»`, m3.btnTexts.length === 2, `${m3.text} [${m3.btnTexts}]`);
    await setMode(page, "hold");
    await page.locator('[data-testid="wait-retry"]').click();
    await page.waitForTimeout(120);
    const st = await page.locator('[data-testid="wait-panel"]').getAttribute("data-state").catch(() => null);
    ok(`${tag} «Повторить» → панель без порога`, st === "wait", `state=${st}`);
    await release(page);
    await page.locator(".board .cell").first().waitFor({ timeout: 3000 });
    await page.waitForTimeout(1200);
    ok(`${tag} после «Повторить» — поле`, (await page.locator('[data-testid="wait-panel"]').count()) === 0 && (await page.locator(".play-waiting").count()) === 0);
    if (c.w === 430 && c.lang === "en" && !c.rm) await page.screenshot({ path: join(OUT, `${tag}-4-ready.png`) });
    ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
  } finally {
    await browser.close();
  }
}

/** Пороги на реальном времени: 300 мс — панели нет; 900 мс — панель держится ≥ 700 мс. */
async function thresholds(name, type) {
  const browser = await type.launch();
  try {
    for (const [delay, expectShown] of [
      [300, false],
      [900, true],
    ]) {
      // Свежий контекст на каждый замер: у режима ещё нет партии, строка хаба открывает шит «Начать».
      const { ctx, page } = await open(browser, { w: 430, h: 932, scheme: "light", lang: "en" });
      await toHub(page);
      await setMode(page, delay);
      await page.evaluate(() => (window.__pd189.seen = []));
      await start(page);
      await page.locator(".board .cell").first().waitFor({ timeout: 4000 });
      await page.waitForTimeout(1800);
      const { seen, log } = await page.evaluate(() => ({ seen: window.__pd189.seen, log: window.__pd189.log }));
      const req = log.at(-1).t;
      const on = seen.find((s) => s.on);
      const off = seen.find((s) => !s.on && on && s.t > on.t);
      if (!expectShown) ok(`${name} генерация ${delay} мс → панели не было`, !on, JSON.stringify(seen));
      else
        ok(
          `${name} генерация ${delay} мс → панель с ~600 мс, держится ≥ 700 мс`,
          !!on && !!off && on.t - req >= 560 && off.t - on.t >= 700 + 140,
          `появилась через ${on && Math.round(on.t - req)} мс, жила ${on && off && Math.round(off.t - on.t)} мс (вкл. угасание 160)`,
        );
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

for (const [name, type] of [
  ["cr", chromium],
  ["wk", webkit],
]) {
  for (const c of CONFIGS) await flow(name, type, c);
  await thresholds(name, type);
}

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? "\nFAIL:\n" + failed.map((f) => "  " + f.name).join("\n") : ""}`);
process.exit(failed.length ? 1 : 0);
