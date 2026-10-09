/**
 * PD-251 — цена кроссфейда тумана Фонаря в webkit: «до» (main, мгновенная смена) и «после» (ветка pd-fog-fade) на двух
 * сборках, чередующимися раундами на одной машине (нагрузка общая — честнее, чем два прогона подряд). Та же плотная партия,
 * что в PD-216 (pd216-perf.mjs): ~2/3 пустых клеток — свои цифры, 6 клеток с заметками.
 *
 *   Скачки выбора: клик → 2 rAF (как PD-216) и окно 300 мс после клика — интервалы кадров (rAF) пока идёт переход.
 *   Серия стрелок: 24 нажатия змейкой каждые 40 мс (автоповтор клавиатуры) — длительность обработчика keydown (синхронный
 *   рендер React + стиль/раскладка — аналог «длинной задачи»: в WebKit нет Long Tasks API) и интервалы кадров за серию + 300 мс хвоста.
 *   Кадры перехода (FRAMES=1, только «после»): клик r5c5 → r1c1, раскадровка 0…200 мс по кривым CSS (см. frames), снимок
 *   поля; таймер снятия призраков на время съёмки задержан (setTimeout перехвачен), light и dark. ROUNDS=0 — только кадры.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd251/after   (и сборка main → /tmp/pd251/before)
 *   npx vite preview --outDir /tmp/pd251/before --port 5251 --strictPort & npx vite preview --outDir /tmp/pd251/after --port 5252 --strictPort
 *   PD_PW_HOME=<папка с node_modules/playwright 1.52> node design/pd251-perf.mjs   (ROUNDS=4, FRAMES=1)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { webkit } = createRequire((process.env.PD_PW_HOME || "/tmp/pundoku-qa/pw") + "/")("playwright");
const { solve } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);
const BEFORE = process.env.BEFORE ?? "http://localhost:5251";
const AFTER = process.env.AFTER ?? "http://localhost:5252";
const BOARD = ".play:not(.today) .board";
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const FRAMES = process.env.FRAMES !== "0";
const SHOTS = join(HERE, "pd251-shots");
mkdirSync(SHOTS, { recursive: true });

async function densePage(browser, base, colorScheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block", colorScheme });
  const page = await ctx.newPage();
  await page.goto(`${base}/#/play`);
  await page.locator('[data-testid="mode-lantern"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="mode-lantern"]').click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="difficulty-easy"]').click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(700);
  const g = await page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d.given")?.textContent?.trim() || "0";
    return out.join("");
  }, BOARD);
  const sol = solve(g).join("");
  const empty = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
  const mine = empty.filter((_, k) => k % 3 !== 2);
  const noted = empty.filter((_, k) => k % 3 === 2).slice(0, 6);
  for (const i of mine) {
    await page.locator(`${BOARD} .cell[data-i="${i}"]`).click();
    await page.locator(".play:not(.today) .pad .key").nth(Number(sol[i]) - 1).click();
  }
  for (const i of noted) {
    await page.locator(`${BOARD} .cell[data-i="${i}"]`).click();
    await page.locator(".play:not(.today) .actions .act").nth(0).click();
    for (const d of [Number(sol[i]), (Number(sol[i]) % 9) + 1, ((Number(sol[i]) + 3) % 9) + 1]) await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
    await page.locator(".play:not(.today) .actions .act").nth(0).click();
  }
  await page.locator(`${BOARD} .cell[data-i="40"]`).click();
  await page.waitForTimeout(600);
  return { ctx, page };
}

const JUMPS = [40, 0, 80, 8, 72, 30, 50, 12, 68, 4, 44, 76];
/** Скачки выбора: клик → 2 rAF, затем 300 мс — интервалы кадров. */
const jumps = (page) =>
  page.evaluate(
    async ({ sel, cells }) => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      const click = [];
      const work = [];
      const frames = [];
      for (const i of cells) {
        const el = document.querySelector(`${sel} .cell[data-i="${i}"]`);
        await raf();
        const t0 = performance.now();
        el.click();
        await Promise.resolve(); // рендер React (микрозадача)
        void document.body.offsetHeight; // стиль + раскладка
        work.push(performance.now() - t0);
        await raf();
        await raf();
        click.push(performance.now() - t0);
        let last = performance.now();
        while (performance.now() - t0 < 300) {
          await raf();
          const now = performance.now();
          frames.push(now - last);
          last = now;
        }
      }
      return { click, work, frames };
    },
    { sel: BOARD, cells: JUMPS },
  );

/** Серия стрелок: 24 keydown каждые 40 мс (змейка по полю), длительность обработчика и интервалы кадров. */
const arrows = (page) =>
  page.evaluate(async (sel) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const start = document.querySelector(`${sel} .cell[data-i="40"]`);
    start.click();
    start.focus();
    await new Promise((r) => setTimeout(r, 400));
    const keys = [..."RRRRDDDLLLLLLLLUUUURRRRR"].map((k) => ({ R: "ArrowRight", L: "ArrowLeft", U: "ArrowUp", D: "ArrowDown" })[k]);
    const handler = [];
    const frames = [];
    let running = true;
    const loop = (async () => {
      let last = performance.now();
      while (running) {
        await raf();
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
    })();
    for (const key of keys) {
      const t0 = performance.now();
      (document.activeElement ?? start).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await Promise.resolve(); // рендер React (микрозадача)
      void document.body.offsetHeight; // стиль + раскладка
      handler.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 300));
    running = false;
    await loop;
    return { handler, frames };
  }, BOARD);

const st = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
  return { n: s.length, med: q(0.5), p90: q(0.9), max: +s[s.length - 1].toFixed(1), over34: s.filter((x) => x > 34).length, over50: s.filter((x) => x > 50).length };
};

/**
 * Кадры перехода «после» — раскадровка. Снимок перемотанных CSS-переходов ненадёжен: у идущих переходов кадр отстаёт на время
 * снимка (под нагрузкой — сотни мс), а съёмка шести кадров дольше жизни призраков (любой рендер поля после FOG_FADE_MS + 60 мс
 * их снимает — поэтому на время съёмки заморожены и setTimeout, и Date.now). Поэтому после настоящего клика (React смонтировал слои и навесил `.fading`) переходы
 * снимаются, и каждому слою задаётся ровно та прозрачность, что даёт CSS в момент t: новый слой — linear t/200, гаснущий —
 * 1 − e-out(t/200), cubic-bezier(0.2, 0.7, 0.3, 1). Кольцо выбора/заливки — в конечном состоянии. Проверка самих переходов
 * (свойство opacity, ключевые значения 1→0 / 0→1) — в result.frames[].transitions.
 */
async function frames(page, scheme) {
  const out = [];
  await page.locator(`${BOARD} .cell[data-i="40"]`).click();
  await page.waitForTimeout(600);
  const board = page.locator(BOARD);
  const prepared = await page.evaluate(async (sel) => {
    // Задержать таймеры приложения на время съёмки (снятие призраков), React ими не пользуется (микрозадачи/MessageChannel).
    const w = window;
    w.__pd251Held = [];
    w.__pd251SetTimeout = w.setTimeout;
    w.setTimeout = (fn, ms, ...a) => (w.__pd251Held.push([fn, ms, a]), 0);
    // И часы: любой рендер поля (тик таймера партии) снимает призраки, чей срок по Date.now() истёк, — а съёмка дольше 260 мс.
    w.__pd251Now = Date.now;
    const frozen = Date.now();
    Date.now = () => frozen;
    document.querySelector(`${sel} .cell[data-i="0"]`).click(); // r5c5 → r1c1: свет меняется почти у всего поля
    await Promise.resolve(); // рендер React (микрозадача)
    const layers = [...document.querySelectorAll(`${sel} .cell > .d.player, ${sel} .cell > .marks`)];
    for (const el of layers) void getComputedStyle(el).opacity;
    const transitions = { fading: 0, entering: 0, other: 0 };
    for (const a of document.getAnimations()) {
      const el = a.effect?.target;
      const kf = a.effect?.getKeyframes?.().map((k) => k.opacity).join("→");
      if (el instanceof Element && layers.includes(el) && a.transitionProperty === "opacity") {
        if (el.classList.contains("fading") && kf === "1→0") transitions.fading++;
        else if (kf === "0→1") transitions.entering++;
        else transitions.other++;
      }
      a.finish();
    }
    // Слой нового вида — тот, у кого в клетке есть гаснущий сосед.
    for (const el of layers) if (!el.classList.contains("fading") && [...el.parentElement.children].some((s) => s.classList.contains("fading"))) el.dataset.pd251In = "";
    for (const el of layers) el.style.setProperty("transition", "none", "important");
    return { fading: document.querySelectorAll(`${sel} .fading`).length, entering: document.querySelectorAll(`${sel} [data-pd251-in]`).length, transitions };
  }, BOARD);
  if (prepared.fading === 0) throw new Error(`кадры: нет гаснущих слоёв после клика (${JSON.stringify(prepared)})`);
  for (const t of [0, 40, 80, 120, 160, 200]) {
    await page.evaluate(
      ({ sel, x }) => {
        // cubic-bezier(0.2, 0.7, 0.3, 1): y по x бисекцией.
        const bz = (p1, p2, u) => 3 * p1 * u * (1 - u) ** 2 + 3 * p2 * u * u * (1 - u) + u ** 3;
        const eOut = (xx) => {
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 40; k++) {
            const m = (lo + hi) / 2;
            if (bz(0.2, 0.3, m) < xx) lo = m;
            else hi = m;
          }
          return bz(0.7, 1, (lo + hi) / 2);
        };
        for (const el of document.querySelectorAll(`${sel} .fading`)) el.style.setProperty("opacity", String(1 - eOut(x)), "important");
        for (const el of document.querySelectorAll(`${sel} [data-pd251-in]`)) el.style.setProperty("opacity", String(x), "important");
      },
      { sel: BOARD, x: t / 200 },
    );
    const file = `wk-390-${scheme}-r5c5-to-r1c1-t${String(t).padStart(3, "0")}.png`;
    await board.screenshot({ path: join(SHOTS, file) });
    out.push(file);
  }
  await page.evaluate((sel) => {
    const w = window;
    for (const el of document.querySelectorAll(`${sel} .cell > .d, ${sel} .cell > .marks`)) {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transition");
      delete el.dataset.pd251In;
    }
    Date.now = w.__pd251Now;
    w.setTimeout = w.__pd251SetTimeout;
    for (const [fn, ms, a] of w.__pd251Held) w.setTimeout(fn, ms, ...a);
  }, BOARD);
  await page.waitForTimeout(800);
  const after = await page.evaluate((sel) => document.querySelectorAll(`${sel} .fading`).length, BOARD);
  return { scheme, ...prepared, fadingAfter: after, files: out };
}

const browser = await webkit.launch();
try {
  const result = { engine: "webkit headless (mac13), viewport 390×844 @2x", rounds: ROUNDS };
  if (ROUNDS > 0) {
  const pages = { before: await densePage(browser, BEFORE, "light"), after: await densePage(browser, AFTER, "light") };
  const acc = { before: { click: [], work: [], jumpFrames: [], handler: [], arrowFrames: [] }, after: { click: [], work: [], jumpFrames: [], handler: [], arrowFrames: [] } };
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of r % 2 ? ["after", "before"] : ["before", "after"]) {
      const { page } = pages[v];
      const j = await jumps(page);
      const a = await arrows(page);
      acc[v].click.push(...j.click);
      acc[v].work.push(...j.work);
      acc[v].jumpFrames.push(...j.frames);
      acc[v].handler.push(...a.handler);
      acc[v].arrowFrames.push(...a.frames);
      await page.waitForTimeout(300);
    }
  }
  const fadingSeen = await pages.after.page.evaluate((sel) => document.querySelectorAll(`${sel} .fading`).length, BOARD);
  Object.assign(result, {
    load: process.env.LOAD ?? "",
    note: "мс; click — клик → 2 rAF; clickWork/arrowWork — главный поток: событие → рендер React (микрозадача) → стиль+раскладка (аналог длинной задачи: в WebKit нет Long Tasks API); jumpFrames/arrowFrames — интервалы rAF во время переходов; over34/over50 — число интервалов/задач длиннее 34/50 мс",
    before: { click: st(acc.before.click), clickWork: st(acc.before.work), jumpFrames: st(acc.before.jumpFrames), arrowWork: st(acc.before.handler), arrowFrames: st(acc.before.arrowFrames) },
    after: { click: st(acc.after.click), clickWork: st(acc.after.work), jumpFrames: st(acc.after.jumpFrames), arrowWork: st(acc.after.handler), arrowFrames: st(acc.after.arrowFrames) },
    afterFadingAtRestAfterRounds: fadingSeen,
  });
  for (const v of Object.values(pages)) await v.ctx.close();
  }
  if (FRAMES) {
    result.frames = [];
    for (const scheme of ["light", "dark"]) {
      const { ctx, page } = await densePage(browser, AFTER, scheme);
      try {
        result.frames.push(await frames(page, scheme));
      } finally {
        await ctx.close();
      }
    }
  }
  console.log(JSON.stringify(result, null, 1));
  writeFileSync(join(SHOTS, ROUNDS > 0 ? "pd251-perf-wk.json" : "pd251-frames-wk.json"), JSON.stringify(result, null, 1) + "\n");
} finally {
  await browser.close();
}
