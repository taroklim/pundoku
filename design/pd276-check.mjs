/**
 * PD-276 — «вкладка переключается только со второго тапа» в установленной PWA на iPhone.
 *
 * Причина (WebKit iOS, Source/WebCore/page/cocoa/ContentChangeObserver.cpp + WebPageCocoa.mm handleSyntheticClick): от
 * touchstart до синтетического mouseMoved WebKit iOS следит за стилями; если за это время элемент, отвечающий на click
 * (любая <button> — HTMLButtonElement::willRespondToMouseClickEvents), из скрытого стал видимым, тап считается «наведением»
 * (hover-меню) и click НЕ отправляется. Кадрирование по вьюпорту (bug 325690) есть только в trunk с 2026-09-30, в iOS — нет.
 * Прогрев PD-175 на pointerdown снимал `visibility: hidden` с панели-цели (в ней кнопки) — первый тап съедался, второй
 * (панель уже прогрета, WARM_MS) проходил. Финал (Play/Today) на касании вкладки показывал карточку с кнопками — то же.
 *
 * Desktop-движки (Chromium/WebKit Playwright) этой эвристики не имеют, поэтому скрипт кроме факта переключения проверяет
 * ЭМУЛЯТОР iOS-наблюдателя: снимок «кликабельное скрыто/видимо» на pointerdown касания и сравнение на его click. Если между
 * ними хоть одна кнопка/ссылка/поле из скрытого (visibility/display/opacity 0, в т.ч. у 4 предков, ≤1 px) стала видимой
 * или появилась — на iPhone этот click не пришёл бы («iOS: hover»).
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd276-dist && node design/pd159-serve.mjs /tmp/pd276-dist 5301 &
 *   BASE=http://127.0.0.1:5301 BROWSERS=chromium,webkit ONLY=T,R,F LABEL=fix node design/pd276-check.mjs
 *
 * T — матрица вкладок (все посещены): из каждой вкладки ОДНИМ тапом на каждую другую (центр + зоны ::before PD-221).
 * R — то же при Reduce Motion (прогрев там делал панель прозрачной — кнопки глубже 4 предков iOS всё равно считает видимыми).
 * F — финал: Play dim → тап Today/Year; Today dim/полёт → тап Play/Year; PD-239 — тап по АКТИВНОЙ вкладке в финале.
 * Тайминги финала растянуты STRETCH (по умолчанию 5), как в qa240-check.mjs. Результат: design/pd276-shots/<LABEL>-*.json.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const PW = createRequire(join(process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend", "noop.js"))("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:5301";
const BROWSERS = (process.env.BROWSERS ?? "chromium,webkit").split(",");
const ONLY = (process.env.ONLY ?? "T,R,F").split(",");
const LABEL = process.env.LABEL ?? "run";
const STRETCH = Number(process.env.STRETCH ?? 5);
const W = 393;
const H = 852;
const INSET = 34;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd276-shots");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TABS = ["today", "play", "year"];

let results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const note = (name, extra) => {
  results.push({ name, pass: null, extra });
  console.log(`NOTE  ${name}  ${extra}`);
};
const solve = (m) => {
  const g = [...m].map(Number);
  const okd = (i, d) => {
    const r = Math.floor(i / 9), c = i % 9;
    for (let k = 0; k < 9; k++) if (g[r * 9 + k] === d || g[k * 9 + c] === d) return false;
    const br = r - (r % 3), bc = c - (c % 3);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === d) return false;
    return true;
  };
  const go = () => {
    const i = g.indexOf(0);
    if (i < 0) return true;
    for (let d = 1; d <= 9; d++)
      if (okd(i, d)) {
        g[i] = d;
        if (go()) return true;
        g[i] = 0;
      }
    return false;
  };
  go();
  return g;
};

/** Инструмент страницы: эмулятор iOS ContentChangeObserver, журнал касаний, растяжка таймингов финала. */
function instrument(stretch) {
  // display-mode: standalone (установленная PWA): navigator.standalone + matchMedia — приложение их не ветвит, но как на iPhone.
  try {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : mm(q));
  } catch {
    /* не критично */
  }
  const ACT = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea, label, summary, [contenteditable="true"], [contenteditable=""], iframe';
  const opacity0 = (el) => Number(getComputedStyle(el).opacity) === 0;
  /** ≈ WebKit isVisuallyHidden + isConsideredVisible (Source/WebCore/page/cocoa/ContentChangeObserver.cpp). */
  const hidden = (el) => {
    if (!el.isConnected || !el.getClientRects().length) return true;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || opacity0(el)) return true;
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) if (opacity0(p)) return true;
    const r = el.getBoundingClientRect();
    return r.width <= 1 || r.height <= 1;
  };
  const name = (el) => {
    const pane = el.closest(".tab-pane")?.getAttribute("data-tab");
    const id = el.getAttribute("data-testid") ?? el.id ?? "";
    return `${pane ? pane + ":" : ""}${el.tagName.toLowerCase()}${id ? "#" + id : ""}`;
  };
  const card = () => !!document.querySelector('[data-testid="result-card"]');
  const anims = [];
  const running = () => anims.some((a) => a.playState === "running");
  const cco = { snap: null, log: [] };
  window.__pd276 = { cco, anims, log: [] };
  // Первыми среди capture-слушателей window (init script): снимок ДО обработчиков приложения.
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      const snap = new Map();
      for (const el of document.querySelectorAll(ACT)) snap.set(el, hidden(el));
      const tab = e.target?.closest?.('[role="tab"]');
      cco.snap = { snap, target: tab?.id ?? name(e.target), card: card(), flying: running(), tabSel: tab?.getAttribute("aria-selected") ?? null };
    },
    true,
  );
  window.addEventListener(
    "click",
    (e) => {
      const s = cco.snap;
      cco.snap = null;
      if (!s) return;
      const became = [];
      for (const el of document.querySelectorAll(ACT)) {
        if (hidden(el)) continue;
        const before = s.snap.get(el);
        if (before === undefined || before === true) became.push(name(el));
      }
      cco.log.push({ down: s.target, downCard: s.card, downFlying: s.flying, downTabSel: s.tabSel, click: e.target?.closest?.('[role="tab"]')?.id ?? name(e.target), became: became.length, sample: became.slice(0, 6) });
    },
    true,
  );
  document.addEventListener("click", (e) => {
    const tab = e.target?.closest?.('[role="tab"]');
    window.__pd276.log.push({ type: "click-reached", target: tab?.id ?? e.target?.closest?.("[data-testid]")?.getAttribute("data-testid"), prevented: e.defaultPrevented });
  });
  if (stretch !== 1) {
    const st = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 240 || ms === 60 ? ms * stretch : ms, ...a);
  }
  const an = Element.prototype.animate;
  Element.prototype.animate = function (kf, opts) {
    const fly = this.classList?.contains("flyer");
    if (fly && stretch !== 1 && opts && typeof opts === "object" && opts.duration === 300) opts = { ...opts, duration: 300 * stretch };
    const a = an.call(this, kf, opts);
    if (fly) anims.push(a);
    return a;
  };
}

async function ctxOf(browser, bname, tab, { reduced = false, stretch = STRETCH } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    isMobile: bname !== "firefox",
    hasTouch: true,
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: reduced ? "reduce" : "no-preference",
    serviceWorkers: "block",
  });
  await ctx.addInitScript(instrument, stretch);
  await ctx.addInitScript((inset) => {
    const add = () => {
      const s = document.createElement("style");
      s.textContent = `:root{--sa-bot:${inset}px !important}`;
      document.documentElement.appendChild(s);
    };
    if (document.documentElement) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, INSET);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/#/${tab}`);
  await page.waitForSelector('[role="tablist"]');
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}
const sel = (page) => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id.replace("tab-", ""));
const count = (page, css) => page.locator(css).count();
const takeCco = (page) => page.evaluate(() => window.__pd276.cco.log.splice(0));
const takeLog = (page) => page.evaluate(() => window.__pd276.log.splice(0));
async function points(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".tabbar").getBoundingClientRect();
    const out = {};
    for (const id of ["today", "play", "year"]) {
      const r = document.getElementById(`tab-${id}`).getBoundingClientRect();
      out[`${id}-center`] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      out[`${id}-home`] = { x: r.left + r.width / 2, y: innerHeight - 2.5 };
      out[`${id}-top`] = { x: r.left + r.width / 2, y: bar.top + 1.5 };
    }
    out["today-side"] = { x: Math.max(1.5, bar.left + 2.5), y: out["today-center"].y };
    out["year-side"] = { x: bar.right - 2.5, y: out["year-center"].y };
    for (const [k, p] of Object.entries(out)) p.owner = document.elementFromPoint(p.x, p.y)?.closest('[role="tab"]')?.id?.replace("tab-", "") ?? null;
    return out;
  });
}

/** Один тап, итог: переключилось ли, что увидел бы iOS. */
async function tapOnce(page, pt, settle = 700) {
  await takeCco(page);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(settle);
  const cco = await takeCco(page);
  return { sel: await sel(page), cco, became: cco.reduce((n, c) => n + c.became, 0), sample: cco.flatMap((c) => c.sample).slice(0, 4) };
}

const S = {
  async T(browser, bname, reduced = false) {
    const tag = reduced ? "R" : "T";
    const { ctx, page, errs } = await ctxOf(browser, bname, "today", { reduced, stretch: 1 });
    try {
      let pts = await points(page);
      // все вкладки посещены (смонтированы) — условие бага: прогрев трогал только смонтированные панели
      for (const id of ["play", "year", "today"]) {
        await page.touchscreen.tap(pts[`${id}-center`].x, pts[`${id}-center`].y);
        await page.waitForTimeout(800);
      }
      pts = await points(page);
      let n = 0;
      let bad = 0;
      for (const from of TABS) {
        for (const to of TABS) {
          if (to === from) continue;
          for (const z of ["center", "home", ...(to === "today" || to === "year" ? ["side"] : ["top"])]) {
            const pt = pts[`${to}-${z}`];
            if (!pt || pt.owner !== to) continue;
            if ((await sel(page)) !== from) {
              await page.touchscreen.tap(pts[`${from}-center`].x, pts[`${from}-center`].y);
              await page.waitForTimeout(800);
            }
            const r = await tapOnce(page, pt);
            n++;
            const pass = r.sel === to && r.became === 0;
            if (!pass) bad++;
            ok(`${tag} ${bname}: ${from} → ${to} (${z}) одним тапом; iOS-наблюдатель: ${r.became ? "HOVER — click потерян" : "click"}`, pass, JSON.stringify({ sel: r.sel, became: r.became, sample: r.sample }));
          }
        }
      }
      // быстрые повторы: тап по вкладке сразу после предыдущего перехода (< WARM_MS)
      for (const to of ["play", "year", "today", "year", "play"]) {
        const r = await tapOnce(page, pts[`${to}-center`], 250);
        ok(`${tag} ${bname}: быстрый тап → ${to} (250 мс после предыдущего); iOS: ${r.became ? "HOVER" : "click"}`, r.sel === to && r.became === 0, JSON.stringify({ sel: r.sel, became: r.became, sample: r.sample }));
      }
      // нажатие держат (палец на вкладке 300 мс) — отклик PD-254 и никакой смены видимости до click
      {
        const pt = pts[`${(await sel(page)) === "today" ? "play" : "today"}-center`];
        await takeCco(page);
        const to = pt.owner;
        const cdp = page.touchscreen;
        await cdp.tap(pt.x, pt.y);
        await page.waitForTimeout(700);
        const cco = await takeCco(page);
        ok(`${tag} ${bname}: контроль — после серии ${n} тапов матрицы ни одного «HOVER», ни одной пропущенной смены`, bad === 0, `bad=${bad}`);
        ok(`${tag} ${bname}: последний контрольный тап → ${to}`, (await sel(page)) === to && cco.every((c) => c.became === 0), JSON.stringify(cco));
      }
      ok(`${tag} ${bname}: на панелях нет следов прогрева/перехода в покое`, (await page.evaluate(() => [...document.querySelectorAll(".tab-pane")].filter((p) => p.hasAttribute("data-slide") || p.style.transform || p.style.willChange || p.style.opacity).length)) === 0);
      ok(`${tag} ${bname}: без ошибок страницы`, errs.length === 0, errs.join("|"));
      await page.screenshot({ path: join(OUT, `${LABEL}-${tag}-${bname}.png`) });
    } finally {
      await ctx.close();
    }
  },
  async R(browser, bname) {
    return S.T(browser, bname, true);
  },
  async F(browser, bname) {
    const grid = (page, pane) =>
      page.evaluate((pane) => {
        const out = new Array(81).fill("0");
        for (const c of document.querySelectorAll(`.tab-pane[data-tab="${pane}"] .board .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d")?.textContent?.trim() || "0";
        return out.join("");
      }, pane);
    const solveAllButLast = async (page, pane) => {
      await page.locator(`.tab-pane[data-tab="${pane}"] .board .cell .d.given`).first().waitFor({ timeout: 90000 });
      await page.waitForTimeout(400);
      const g = await grid(page, pane);
      const sol = solve(g);
      const empty = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
      const key = (d) => page.locator(`.tab-pane[data-tab="${pane}"] .pad .key`).nth(d - 1);
      for (const i of empty.slice(0, -1)) {
        await page.locator(`.tab-pane[data-tab="${pane}"] .board .cell[data-i="${i}"]`).tap();
        await key(sol[i]).tap();
      }
      const last = empty.at(-1);
      await page.locator(`.tab-pane[data-tab="${pane}"] .board .cell[data-i="${last}"]`).tap();
      await key(sol[last]).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const k = await page.evaluate(({ pane, d }) => {
        const r = document.querySelectorAll(`.tab-pane[data-tab="${pane}"] .pad .key`)[d - 1].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, { pane, d: sol[last] });
      return () => page.touchscreen.tap(k.x, k.y);
    };
    const startClassic = async (page) => {
      const hubBtn = page.locator('.tab-pane[data-tab="play"] [data-testid="mode-classic"]');
      const newBtn = page.locator('.tab-pane[data-tab="play"] [data-testid="new-puzzle"]');
      if (await newBtn.count()) await newBtn.tap();
      else {
        await hubBtn.waitFor({ timeout: 20000 });
        await hubBtn.tap();
      }
      await page.locator('[data-testid="sheet-start"]').waitFor();
      await page.waitForTimeout(400);
      if (await page.locator('[data-testid="difficulty-easy"]').count()) await page.locator('[data-testid="difficulty-easy"]').tap();
      await page.locator('[data-testid="sheet-start"]').tap();
      await page.waitForTimeout(400);
    };
    // Play dim: другая вкладка (Today/Year) и активная Play (PD-239)
    for (const to of ["year", "today", "play"]) {
      const { ctx, page, errs } = await ctxOf(browser, bname, "play");
      try {
        // все вкладки посещены
        let pts = await points(page);
        for (const id of ["today", "year", "play"]) {
          await page.touchscreen.tap(pts[`${id}-center`].x, pts[`${id}-center`].y);
          await page.waitForTimeout(800);
        }
        await startClassic(page);
        const placeLast = await solveAllButLast(page, "play");
        pts = await points(page);
        await takeLog(page);
        await placeLast();
        await takeCco(page); // ввод последней цифры — не предмет проверки
        await page.touchscreen.tap(pts[`${to}-center`].x, pts[`${to}-center`].y);
        await page.waitForTimeout(500 + 240 * STRETCH);
        const cco = await takeCco(page);
        const reached = (await takeLog(page)).filter((e) => e.type === "click-reached").map((e) => e.target);
        const c = cco.at(-1);
        if (!c || c.downCard !== false) {
          note(`F ${bname} Play dim → ${to}: касание не попало в dim-фазу — недействительно`, JSON.stringify(cco));
          continue;
        }
        if (to === "play") {
          const hub = await count(page, '.tab-pane[data-tab="play"] [data-testid="mode-classic"]');
          ok(`F ${bname} PD-239: Play dim, тап по АКТИВНОЙ Play — карточка, не хаб, click погашен`, (await sel(page)) === "play" && hub === 0 && (await count(page, '.tab-pane[data-tab="play"] [data-testid="result-card"]')) === 1 && !reached.includes("tab-play"), JSON.stringify({ reached, hub }));
        } else {
          ok(`F ${bname}: Play dim → ${to} одним тапом; iOS-наблюдатель: ${c.became ? "HOVER — click потерян" : "click"}`, (await sel(page)) === to && reached.includes(`tab-${to}`) && c.became === 0, JSON.stringify({ sel: await sel(page), c }));
          await page.touchscreen.tap(pts["play-center"].x, pts["play-center"].y);
          await page.waitForTimeout(900);
          ok(`F ${bname}: (Play dim → ${to}) назад на Play — карточка результата, не хаб`, (await count(page, '.tab-pane[data-tab="play"] [data-testid="result-card"]')) === 1 && (await count(page, '.tab-pane[data-tab="play"] [data-testid="mode-classic"]')) === 0);
        }
        ok(`F ${bname}: (Play dim → ${to}) без ошибок страницы`, errs.length === 0, errs.join("|"));
      } finally {
        await ctx.close();
      }
    }
    // Today: dim и полёт → Play/Year; активная Today в полёте (PD-239)
    for (const c0 of [
      { to: "play", phase: "flight" },
      { to: "year", phase: "dim" },
      { to: "today", phase: "flight" },
    ]) {
      const { ctx, page, errs } = await ctxOf(browser, bname, "today");
      try {
        let pts = await points(page);
        for (const id of ["play", "year", "today"]) {
          await page.touchscreen.tap(pts[`${id}-center`].x, pts[`${id}-center`].y);
          await page.waitForTimeout(800);
        }
        const placeLast = await solveAllButLast(page, "today");
        pts = await points(page);
        await takeLog(page);
        await page.evaluate(() => void (window.__pd276.anims.length = 0));
        await placeLast();
        await takeCco(page);
        if (c0.phase === "flight") await page.waitForFunction(() => window.__pd276.anims.some((a) => a.playState === "running"), null, { timeout: 15000, polling: 10 }).catch(() => {});
        else await sleep(60);
        await page.touchscreen.tap(pts[`${c0.to}-center`].x, pts[`${c0.to}-center`].y);
        await page.waitForTimeout(1500 + 300 * STRETCH);
        const cco = await takeCco(page);
        const reached = (await takeLog(page)).filter((e) => e.type === "click-reached").map((e) => e.target);
        const c = cco.at(-1);
        const inPhase = c && (c0.phase === "flight" ? c.downFlying === true : c.downCard === false && c.downFlying === false);
        if (!inPhase) {
          note(`F ${bname} Today ${c0.phase} → ${c0.to}: касание не попало в фазу — недействительно`, JSON.stringify(cco));
          continue;
        }
        const running = await page.evaluate(() => window.__pd276.anims.filter((a) => a.playState === "running").length);
        if (c0.to === "today") {
          ok(`F ${bname} PD-239: Today полёт, тап по АКТИВНОЙ Today — финал завершён, карточка, click погашен`, (await sel(page)) === "today" && running === 0 && !reached.includes("tab-today") && (await count(page, '.tab-pane[data-tab="today"] [data-testid="result-card"]')) === 1, JSON.stringify({ reached }));
        } else {
          ok(`F ${bname}: Today ${c0.phase} → ${c0.to} одним тапом; iOS-наблюдатель: ${c.became ? "HOVER — click потерян" : "click"}`, (await sel(page)) === c0.to && reached.includes(`tab-${c0.to}`) && c.became === 0 && running === 0, JSON.stringify({ sel: await sel(page), c, running }));
          await page.touchscreen.tap(pts["today-center"].x, pts["today-center"].y);
          await page.waitForTimeout(1200);
          ok(`F ${bname}: (Today ${c0.phase} → ${c0.to}) назад на Today — карточка дня, Grid ∞`, (await count(page, '.tab-pane[data-tab="today"] [data-testid="result-card"]')) === 1 && (await count(page, '[data-testid="grid-inf-section"]')) >= 1);
        }
        ok(`F ${bname}: (Today ${c0.phase} → ${c0.to}) без ошибок страницы`, errs.length === 0, errs.join("|"));
      } finally {
        await ctx.close();
      }
    }
  },
};

const summary = {};
for (const bname of BROWSERS) {
  results = [];
  const browser = await PW[bname].launch();
  const meta = { base: BASE, label: LABEL, engine: `${bname} ${browser.version()}`, w: W, h: H, inset: INSET, stretch: STRETCH, at: new Date().toISOString(), loadStart: os.loadavg() };
  try {
    for (const k of ONLY) {
      try {
        await S[k](browser, bname);
      } catch (e) {
        ok(`${k} ${bname} упал`, false, String(e.message).split("\n")[0]);
      }
    }
  } finally {
    await browser.close();
  }
  meta.loadEnd = os.loadavg();
  writeFileSync(join(OUT, `${LABEL}-${bname}.json`), JSON.stringify({ meta, results }, null, 2) + "\n");
  const real = results.filter((r) => r.pass !== null);
  summary[bname] = `${real.filter((r) => r.pass).length}/${real.length} PASS, недействительных ${results.length - real.length}`;
}
console.log("\n" + Object.entries(summary).map(([b, s]) => `${b}: ${s}`).join("\n"));
