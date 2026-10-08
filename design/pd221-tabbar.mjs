/**
 * PD-221 — стенд «нажатия на таб-бар»: WebKit с эмуляцией касаний (isMobile + hasTouch), реальная сборка.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd221-dist
 *   node design/pd159-serve.mjs /tmp/pd221-dist 5521 &                 # статика + заглушка /api/daily
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend BASE=http://127.0.0.1:5521 LABEL=before \
 *     node design/pd221-tabbar.mjs
 *
 * Только WebKit, один браузер (лёгкий прогон). Никаких pkill/killall. Результат: design/pd221-shots/<LABEL>.json + кадры.
 *
 * Что меряется на 320×568 (inset 0), 393×852 (iPhone 16, inset 34) и 430×932 (inset 34). Playwright не эмулирует
 * env(safe-area-inset-bottom) — подставляем `--sa-bot` (tokens.css) напрямую, как на iPhone в портрете.
 *   A. hit — сетка точек 1×1 px по таб-бару: elementFromPoint → какая вкладка (или «мёртвая» точка). Доля мёртвой площади
 *      в видимой полосе бара, мёртвая полоса под подписями, нижний край экрана (зона индикатора Home).
 *   B. latency — тап по центру вкладки в покое: touchstart → pointerdown → pointerup → click → aria-selected → первый кадр
 *      после выбора → первый кадр со сдвигом панели-цели.
 *   C. rapid — серии тапов с интервалом 60/120/200 мс (тап во время слайда): сколько переключений из ожидаемых,
 *      сколько click на касание (двойные), совпадает ли итоговая вкладка с последней нажатой, следы перехода после серии.
 *   D. edge — тапы по точкам, где палец реально промахивается мимо кнопки: под подписью, в зазоре между вкладками,
 *      у боковых краёв бара: переключилось или нет.
 *   E. feedback — есть ли вообще визуальный отклик нажатия (:active-правило, tap-highlight).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PW_HOME = process.env.PD_PW_HOME || "/tmp/pd16-pw";
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
const { webkit } = loadPlaywright();

const BASE = process.env.BASE ?? "http://127.0.0.1:5521";
const LABEL = process.env.LABEL ?? "run";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd221-shots");
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { name: "320", w: 320, h: 568, inset: 0 },
  { name: "393", w: 393, h: 852, inset: 34 },
  { name: "430", w: 430, h: 932, inset: 34 },
];
const TABS = ["today", "play", "year"];
const median = (a) => {
  const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null;
};
const p90 = (a) => {
  const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] * 10) / 10 : null;
};

/** Журнал событий касания и смены вкладки + кадры rAF со сдвигом выбранной панели. */
function instrument() {
  const log = [];
  window.__pd221 = { log, frames: [] };
  const desc = (t) => {
    const tab = t instanceof Element ? t.closest('[role="tab"]') : null;
    if (tab) return tab.id;
    return t instanceof Element ? `${t.tagName.toLowerCase()}.${(t.className && typeof t.className === "string" ? t.className : "").split(" ")[0]}` : String(t);
  };
  for (const type of ["touchstart", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel", "click"]) {
    window.addEventListener(
      type,
      (e) => {
        const p = e.changedTouches?.[0] ?? e;
        log.push({ type, t: performance.now(), target: desc(e.target), x: p.clientX, y: p.clientY });
      },
      true,
    );
  }
  const watch = () => {
    const bar = document.querySelector('[role="tablist"]');
    if (!bar) return requestAnimationFrame(watch);
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.attributeName === "aria-selected" && m.target.getAttribute("aria-selected") === "true") log.push({ type: "sel", t: performance.now(), target: m.target.id });
      }
    }).observe(bar, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] });
    const loop = (ts) => {
      const sel = document.querySelector('[role="tab"][aria-selected="true"]');
      const id = sel?.id.replace("tab-", "");
      const pane = id ? document.querySelector(`.tab-pane[data-tab="${id}"]`) : null;
      let x = 0;
      if (pane) {
        const tr = getComputedStyle(pane).transform;
        const m = /^matrix(3d)?\(([^)]*)\)$/.exec(tr);
        if (m) {
          const v = m[2].split(",").map(Number);
          x = m[1] ? v[12] : v[4];
        }
      }
      window.__pd221.frames.push({ ts, now: performance.now(), sel: id, x: Math.round(x) });
      if (window.__pd221.frames.length > 20000) window.__pd221.frames.splice(0, 10000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();
}

const selected = (page) => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id.replace("tab-", ""));
const tabCenter = (page, id) =>
  page.evaluate((id) => {
    const r = document.getElementById(`tab-${id}`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
const clearLog = (page) => page.evaluate(() => (window.__pd221.log.length = 0));
const getLog = (page) => page.evaluate(() => window.__pd221.log.slice());
const getFrames = (page, since) => page.evaluate((since) => window.__pd221.frames.filter((f) => f.now >= since), since);
const residue = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".tab-pane")].filter((p) => p.hasAttribute("data-slide") || p.style.transform || p.style.willChange).map((p) => p.dataset.tab),
  );

async function hitGrid(page, size) {
  return page.evaluate(
    ({ inset }) => {
      const bar = document.querySelector(".tabbar");
      const br = bar.getBoundingClientRect();
      const tabs = [...bar.querySelectorAll('[role="tab"]')].map((b) => ({ id: b.id, r: b.getBoundingClientRect(), lab: b.querySelector(".lab").getBoundingClientRect() }));
      const H = innerHeight;
      const visBottom = H - inset; // нижняя граница «видимой» части бара (выше индикатора Home)
      let total = 0;
      let dead = 0;
      let deadVisible = 0;
      let totalVisible = 0;
      let homeZone = 0;
      let homeZoneDead = 0;
      const grid = [];
      for (let y = Math.ceil(br.top); y < Math.floor(br.bottom); y++) {
        const row = [];
        for (let x = Math.ceil(br.left); x < Math.floor(br.right); x++) {
          const el = document.elementFromPoint(x + 0.5, y + 0.5);
          const t = el?.closest('[role="tab"]');
          const isDead = !t;
          total++;
          if (isDead) dead++;
          if (y < visBottom) {
            totalVisible++;
            if (isDead) deadVisible++;
          } else {
            homeZone++;
            if (isDead) homeZoneDead++;
          }
          row.push(t ? t.id.replace("tab-", "")[0] : ".");
        }
        grid.push(row.join(""));
      }
      // Мёртвая полоса под подписью: от низа подписи до низа видимой части бара, в колонке шириной подписи.
      const underLabel = tabs.map(({ id, r, lab }) => {
        let n = 0;
        let d = 0;
        for (let y = Math.ceil(lab.bottom); y < visBottom; y++) {
          for (let x = Math.ceil(lab.left); x < Math.floor(lab.right); x++) {
            n++;
            if (!document.elementFromPoint(x + 0.5, y + 0.5)?.closest(`#${id}`)) d++;
          }
        }
        return { id, labBottom: Math.round(lab.bottom), btnBottom: Math.round(r.bottom), visBottom, bandPx: Math.max(0, visBottom - Math.ceil(lab.bottom)), deadPct: n ? Math.round((d / n) * 1000) / 10 : 0 };
      });
      return {
        bar: { top: Math.round(br.top), bottom: Math.round(br.bottom), left: br.left, right: br.right, h: Math.round(br.height) },
        tabs: tabs.map(({ id, r }) => ({ id, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) })),
        deadPctAll: Math.round((dead / total) * 1000) / 10,
        deadPctVisible: Math.round((deadVisible / totalVisible) * 1000) / 10,
        homeZoneDeadPct: homeZone ? Math.round((homeZoneDead / homeZone) * 1000) / 10 : null,
        underLabel,
        grid,
      };
    },
    { inset: size.inset },
  );
}

async function paintHitMap(page, hit, file) {
  await page.evaluate((hit) => {
    const c = document.createElement("canvas");
    c.id = "pd221-map";
    c.width = innerWidth;
    c.height = innerHeight;
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 99999, pointerEvents: "none" });
    const g = c.getContext("2d");
    const col = { t: "rgba(0,160,255,.35)", p: "rgba(0,200,90,.35)", y: "rgba(255,170,0,.35)", ".": "rgba(255,0,0,.75)" };
    hit.grid.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        g.fillStyle = col[row[i]];
        g.fillRect(Math.ceil(hit.bar.left) + i, hit.bar.top + j, 1, 1);
      }
    });
    document.body.append(c);
  }, hit);
  const clip = { x: 0, y: hit.bar.top - 10, width: page.viewportSize().width, height: page.viewportSize().height - hit.bar.top + 10 };
  await page.screenshot({ path: file, clip });
  await page.evaluate(() => document.getElementById("pd221-map")?.remove());
}

/** Один тап в покое: разбор журнала. */
function analyseTap(log, frames, to) {
  const ts = log.find((e) => e.type === "touchstart");
  const pd = log.find((e) => e.type === "pointerdown");
  const pu = log.find((e) => e.type === "pointerup");
  const cl = log.filter((e) => e.type === "click");
  const sel = log.find((e) => e.type === "sel" && e.target === `tab-${to}`);
  const t0 = ts?.t ?? pd?.t;
  const f1 = sel ? frames.find((f) => f.now > sel.t) : undefined;
  const startX = f1?.x;
  const move = sel ? frames.find((f) => f.now > sel.t && f.sel === to && f.x !== startX) : undefined;
  const r = (v) => (v === undefined ? null : Math.round((v - t0) * 10) / 10);
  return {
    to,
    pointerdown: r(pd?.t),
    pointerup: r(pu?.t),
    click: r(cl[0]?.t),
    clicks: cl.length,
    sel: r(sel?.t),
    firstFrame: r(f1?.now),
    moveStart: r(move?.now),
    switched: !!sel,
    clickTarget: cl[0]?.target ?? null,
  };
}

async function runSize(browser, size) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "en-US",
    colorScheme: "light",
    serviceWorkers: "block",
  });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript((inset) => {
    const add = () => {
      const s = document.createElement("style");
      s.textContent = `:root{--sa-bot:${inset}px !important}`;
      document.head.append(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, size.inset);
  const page = await ctx.newPage();
  const res = { size: size.name, viewport: [size.w, size.h], inset: size.inset };
  try {
    await page.goto(`${BASE}/#/today`);
    await page.waitForSelector('[role="tablist"]');
    await page.waitForTimeout(800);
    // Первые визиты: смонтировать все три панели (иначе prewarm нечего греть).
    for (const id of ["play", "year", "today"]) {
      const c = await tabCenter(page, id);
      await page.touchscreen.tap(c.x, c.y);
      await page.waitForTimeout(700);
    }

    // A. Хит-боксы.
    const hit = await hitGrid(page, size);
    await paintHitMap(page, hit, join(OUT, `${LABEL}-hit-${size.name}.png`));
    res.hit = { ...hit, grid: undefined };
    writeFileSync(join(OUT, `${LABEL}-hitgrid-${size.name}.txt`), hit.grid.join("\n") + "\n");

    // B. Латентность в покое: 12 тапов по центру, пауза 700 мс.
    const seq = ["play", "year", "today", "year", "play", "today", "play", "year", "today", "year", "play", "today"];
    const taps = [];
    for (const to of seq) {
      await clearLog(page);
      const since = await page.evaluate(() => performance.now());
      const c = await tabCenter(page, to);
      await page.touchscreen.tap(c.x, c.y);
      await page.waitForTimeout(650);
      taps.push(analyseTap(await getLog(page), await getFrames(page, since), to));
    }
    res.latency = {
      taps,
      switched: `${taps.filter((t) => t.switched).length}/${taps.length}`,
      doubleClicks: taps.filter((t) => t.clicks > 1).length,
      median: Object.fromEntries(["pointerdown", "pointerup", "click", "sel", "firstFrame", "moveStart"].map((k) => [k, median(taps.map((t) => t[k]))])),
      p90: Object.fromEntries(["click", "sel", "firstFrame", "moveStart"].map((k) => [k, p90(taps.map((t) => t[k]))])),
    };

    // C. Быстрые серии (тап во время идущего слайда).
    res.rapid = [];
    for (const gap of [60, 120, 200]) {
      const order = ["play", "year", "today", "play", "today", "year", "play", "year", "today", "year", "today", "play", "year", "play", "today"];
      await clearLog(page);
      let cur = await selected(page);
      let expected = 0;
      const centers = Object.fromEntries(await Promise.all(TABS.map(async (id) => [id, await tabCenter(page, id)])));
      for (const to of order) {
        if (to !== cur) expected++;
        cur = to;
        await page.touchscreen.tap(centers[to].x, centers[to].y);
        await page.waitForTimeout(gap);
      }
      await page.waitForTimeout(700);
      const log = await getLog(page);
      const touches = log.filter((e) => e.type === "touchstart").length;
      const clicks = log.filter((e) => e.type === "click").length;
      const sels = log.filter((e) => e.type === "sel").length;
      res.rapid.push({ gap, taps: order.length, touches, clicks, expectedSwitches: expected, switches: sels, final: await selected(page), last: order.at(-1), residue: await residue(page) });
    }

    // D. Тапы у края кнопки: под подписью (видимая часть бара), в зазоре, у бокового края, в зоне индикатора Home.
    const pts = await page.evaluate((inset) => {
      const bar = document.querySelector(".tabbar").getBoundingClientRect();
      const b = (id) => document.getElementById(`tab-${id}`).getBoundingClientRect();
      const lab = (id) => document.querySelector(`#tab-${id} .lab`).getBoundingClientRect();
      const vis = innerHeight - inset;
      const out = [];
      for (const id of ["play", "year"]) {
        const r = b(id);
        const cx = r.left + r.width / 2;
        out.push({ name: `${id}: 4 px под подписью`, to: id, x: cx, y: lab(id).bottom + 4 });
        out.push({ name: `${id}: 2 px ниже кнопки`, to: id, x: cx, y: r.bottom + 2 });
        out.push({ name: `${id}: верхний край бара (2 px)`, to: id, x: cx, y: bar.top + 2 });
        if (inset) out.push({ name: `${id}: зона индикатора Home (+10 px)`, to: id, x: cx, y: vis + 10 });
        if (inset) out.push({ name: `${id}: 3 px над краем видимой части`, to: id, x: cx, y: vis - 3 });
      }
      const y = b("year");
      out.push({ name: "year: 4 px от правого края экрана", to: "year", x: innerWidth - 4, y: y.top + y.height / 2 });
      const p = b("play");
      out.push({ name: "play: зазор слева от кнопки", to: "play", x: p.left - 1, y: p.top + p.height / 2 });
      return out;
    }, size.inset);
    res.edge = [];
    for (const pt of pts) {
      // Стартуем с вкладки, отличной от цели.
      const from = pt.to === "today" ? "play" : "today";
      if ((await selected(page)) !== from) {
        const c = await tabCenter(page, from);
        await page.touchscreen.tap(c.x, c.y);
        await page.waitForTimeout(500);
      }
      await clearLog(page);
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForTimeout(450);
      const log = await getLog(page);
      res.edge.push({ ...pt, x: Math.round(pt.x), y: Math.round(pt.y), hitTarget: log.find((e) => e.type === "touchstart")?.target ?? null, switched: (await selected(page)) === pt.to });
    }

    // E. Отклик нажатия.
    res.feedback = await page.evaluate(() => {
      const rules = [];
      for (const sh of document.styleSheets) {
        let list;
        try {
          list = sh.cssRules;
        } catch {
          continue;
        }
        const walk = (rs) => {
          for (const r of rs) {
            if (r.cssRules) walk(r.cssRules);
            if (r.selectorText && /\.tab(\b|[:\[.])/.test(r.selectorText) && /:active|\[data-pressed|\.pressed/.test(r.selectorText)) rules.push(r.cssText);
          }
        };
        walk(list);
      }
      const tab = document.querySelector('[role="tab"]');
      const cs = getComputedStyle(tab);
      return { activeRules: rules, tapHighlight: cs.webkitTapHighlightColor, touchAction: cs.touchAction, userSelect: cs.webkitUserSelect || cs.userSelect, touchCallout: cs.webkitTouchCallout ?? null };
    });
    await page.screenshot({ path: join(OUT, `${LABEL}-bar-${size.name}.png`), clip: { x: 0, y: res.hit.bar.top - 10, width: size.w, height: size.h - res.hit.bar.top + 10 } });
  } finally {
    await ctx.close();
  }
  return res;
}

const browser = await webkit.launch();
const all = { label: LABEL, base: BASE, at: new Date().toISOString(), engine: "webkit " + browser.version(), sizes: [] };
try {
  for (const size of SIZES) {
    const r = await runSize(browser, size);
    all.sizes.push(r);
    const h = r.hit;
    console.log(`\n== ${size.name}×${size.h} inset ${size.inset}`);
    console.log(`hit: bar ${h.bar.top}..${h.bar.bottom} (h ${h.bar.h}); tabs ${h.tabs.map((t) => `${t.id.slice(4)} ${t.left}-${t.right}×${t.top}-${t.bottom}`).join(", ")}`);
    console.log(`hit: dead ${h.deadPctAll}% бара, ${h.deadPctVisible}% видимой части, зона Home dead ${h.homeZoneDeadPct}%; под подписью: ${h.underLabel.map((u) => `${u.id.slice(4)} ${u.bandPx}px dead ${u.deadPct}%`).join(", ")}`);
    console.log(`latency (медиана, мс от touchstart): ${JSON.stringify(r.latency.median)} p90 ${JSON.stringify(r.latency.p90)} switched ${r.latency.switched} double ${r.latency.doubleClicks}`);
    for (const s of r.rapid) console.log(`rapid ${s.gap}ms: ${s.switches}/${s.expectedSwitches} переключений, touches ${s.touches}, clicks ${s.clicks}, итог ${s.final} (последний ${s.last}), следы ${JSON.stringify(s.residue)}`);
    for (const e of r.edge) console.log(`edge ${e.switched ? "OK  " : "MISS"} ${e.name} @${e.x},${e.y} -> ${e.hitTarget}`);
    console.log(`feedback: ${JSON.stringify(r.feedback)}`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(all, null, 2) + "\n");
console.log(`\n-> ${join(OUT, LABEL + ".json")}`);
