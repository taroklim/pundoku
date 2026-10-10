/**
 * PD-285 — живая проверка дока действий карточки «решено» Play (вариант A, design/pd285-result-card.md §6, §7) на РЕАЛЬНОЙ
 * сборке ветки + сравнение с main там, где ничего не должно было измениться (AX3, ландшафт, десктоп C, карточка Today).
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd285-dist                       (ветка pd-285)
 *   (main)      npx vite build --outDir /tmp/pd285-base                          (эталон для «не изменилось»)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd285-dist BASE_DIST=/tmp/pd285-base PORT=5481 \
 *     node design/pd285-check.mjs [chromium] [webkit]
 *
 * Условия замера — как design/pd277-shots.mjs / pd285-shots.mjs: html font-size 17 px (40 px — AX3), --sa-top/--sa-bot 20/0
 * (320×568) и 59/34 (393×852, 430×932), isMobile + hasTouch, light/dark. Партия Play решается по-настоящему (тапы по клеткам
 * и паду); случайность детерминирована (одинаковая сетка у ветки и main), время зафиксировано.
 *
 * §7 п. 1 — покой, 320/393/430 × light/dark × en/uk/ru: Watch, Share, New puzzle целиком над таб-баром, elementFromPoint в центре
 *   каждой — сама кнопка; низ дока = верх таб-бара ±1. п. 2 — Лжец дня (пойман, решён) и он же без повтора (лог снят в
 *   IndexedDB → `logSynthetic`): в доке одна New puzzle, тонированная, во всю ширину; строка «повтор недоступен» — в карточке.
 * п. 3 — конец прокрутки: низ карточки ≤ верх дока, док на месте ±1. п. 4 — середина: под доком контент, растушёвка видна;
 *   prefers-contrast: more и (chromium) prefers-reduced-transparency — линии, растушёвки нет. п. 5 — AX3: дока нет, кнопки в конце
 *   карточки, в конце прокрутки над таб-баром; кадр = main. п. 6 — ландшафт 852×393: дока нет, кадр = main. п. 7 — десктоп C
 *   1440×900: .result-dock нет, кадр = main. п. 8 — карточка Today 393 = main. п. 9 — фокус после решения на карточке, Tab:
 *   «What's this?» → Watch → Share → New puzzle, фокус над доком; имя группы. п. 10 — Reduce Motion: у дока только fadeIn.
 *   Плюс: тап по New puzzle открывает шит (не вкладку); Play → Today → Play — док на месте (риск §8 п. 3).
 * ONLY_SAME=1 — только сравнения с main (AX3, ландшафт, десктоп C, Today). Время партии в этих кадрах — под маской.
 * Кадры — design/pd285-shots/impl-*.png; итог — design/pd285-shots/impl-results-<браузеры>.json.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd285-shots");
const PORT = +(process.env.PORT ?? 5481);
const NOW = new Date("2026-10-10T09:00:00Z");
const DATE = "2026-10-10";
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const args = process.argv.slice(2);
const brs = args.filter((a) => ["chromium", "webkit"].includes(a));
const browsers = brs.length ? brs : ["chromium", "webkit"];
const SHORT = { chromium: "cr", webkit: "wk" };
fs.mkdirSync(OUT, { recursive: true });

// ---------- сервер ----------
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function serve(root, port) {
  const server = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return r.end(JSON.stringify({ date: m[1], mission: MISSION, difficulty: "medium", source: "sudoku.com", winRate: 71 }));
    }
    if (u.startsWith("/api/")) {
      r.writeHead(503);
      return r.end();
    }
    let f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
    r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

const results = {};
const fails = [];
const check = (name, ok, detail = {}) => {
  results[name] = { ok: !!ok, ...detail };
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail));
};

// ---------- судоку: решатель с MRV (и для поиска лжеца) ----------
function solveGrid(str, count = false) {
  const g = [...str].map(Number);
  const row = new Array(9).fill(0), col = new Array(9).fill(0), box = new Array(9).fill(0);
  const bi = (i) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const b = 1 << d;
    if (row[Math.floor(i / 9)] & b || col[i % 9] & b || box[bi(i)] & b) return null;
    row[Math.floor(i / 9)] |= b; col[i % 9] |= b; box[bi(i)] |= b;
  }
  let nodes = 0;
  let found = 0;
  let first = null;
  const go = () => {
    if (++nodes > 2e6) return false;
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const mask = ~(row[Math.floor(i / 9)] | col[i % 9] | box[bi(i)]) & 0x3fe;
      let n = 0;
      for (let d = 1; d <= 9; d++) if (mask & (1 << d)) n++;
      if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) {
      if (!count) return true;
      if (++found === 1) first = g.slice();
      return found >= 2;
    }
    if (bestN === 0) return false;
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      const b = 1 << d, r = Math.floor(best / 9), c = best % 9, x = bi(best);
      g[best] = d; row[r] |= b; col[c] |= b; box[x] |= b;
      if (go()) return true;
      g[best] = 0; row[r] &= ~b; col[c] &= ~b; box[x] &= ~b;
    }
    return false;
  };
  const done = go();
  if (count) return { n: found, solution: first };
  return done ? g : null;
}
/** Лжец: подсказка, без которой сетка решается ОДНОЗНАЧНО, а решение в её клетке — другая цифра (как validateLiar). */
function findLiar(str) {
  for (let i = 0; i < 81; i++) {
    if (str[i] === "0") continue;
    const r = solveGrid(str.slice(0, i) + "0" + str.slice(i + 1), true);
    if (r.n === 1 && r.solution[i] !== Number(str[i])) return { cell: i, solution: r.solution };
  }
  return null;
}

// ---------- браузер ----------
async function open(browser, { w, h, dpr = 2, scheme = "light", route = "play", base, touch = true, lang = "en-US", fsPx = 17, top = 59, bot = 34 }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    screen: { width: w, height: h },
    deviceScaleFactor: dpr,
    isMobile: touch,
    hasTouch: touch,
    locale: lang,
    timezoneId: "UTC",
    colorScheme: scheme,
    serviceWorkers: "block",
  });
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript(() => {
    let x = 0x9e3779b9;
    crypto.getRandomValues = (a) => {
      for (let i = 0; i < a.length; i++) {
        x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
        a[i] = x & (a.BYTES_PER_ELEMENT === 1 ? 0xff : a.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffffffff);
      }
      return a;
    };
    Math.random = () => {
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return x / 4294967296;
    };
  });
  if (touch) {
    await ctx.addInitScript(([f, t, b]) => {
      const add = () => {
        const st = document.createElement("style");
        st.id = "pd285-env";
        st.textContent = `html{font-size:${f}px !important}:root{--sa-top:${t}px !important;--sa-bot:${b}px !important}`;
        document.documentElement.appendChild(st);
      };
      if (document.documentElement) add();
      else document.addEventListener("DOMContentLoaded", add);
    }, [fsPx, top, bot]);
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/#/${route}`);
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}
/** Сменить «устройство» на той же странице: вьюпорт, размер шрифта, safe-area. */
async function env(p, { w, h, fsPx = 17, top = 59, bot = 34 }) {
  await p.setViewportSize({ width: w, height: h });
  await p.evaluate(([f, t, b]) => {
    document.getElementById("pd285-env").textContent = `html{font-size:${f}px !important}:root{--sa-top:${t}px !important;--sa-bot:${b}px !important}`;
  }, [fsPx, top, bot]);
  await p.waitForTimeout(450);
  await scrollTo(p, 0);
}
const PANE = '.tab-pane[data-tab="play"]';
const scrollTo = (p, where) =>
  p.evaluate(([sel, where]) => {
    const sc = document.querySelector(sel);
    const range = sc.scrollHeight - sc.clientHeight;
    sc.scrollTop = where === "end" ? range + 10 : where === "mid" ? Math.round(range / 2) : 0;
    return range;
  }, [PANE, where]);

const grid = (p, pane) =>
  p.evaluate((pane) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`.tab-pane[data-tab="${pane}"] .board .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d")?.textContent?.trim() || "0";
    return out.join("");
  }, pane);
async function fill(p, pane, g, sol, desk = false) {
  const root = desk ? ".play" : `.tab-pane[data-tab="${pane}"]`;
  for (let i = 0; i < 81; i++) {
    if (g[i] !== "0") continue;
    const cell = p.locator(`${root} .board .cell[data-i="${i}"]`).first();
    if (desk) {
      await cell.click();
      await p.keyboard.press(String(sol[i]));
    } else {
      await cell.tap();
      await p.locator(`${root} .pad .key`).nth(sol[i] - 1).tap();
    }
  }
}
/** Новая партия Classic (Easy) на хабе Play и решение до карточки. */
async function solvePlay(p, desk = false) {
  const hub = desk ? "" : `${PANE} `;
  await p.locator(`${hub}[data-testid="mode-classic"]`).first().waitFor({ timeout: 60000 });
  await (desk ? p.locator(`[data-testid="mode-classic"]`).first().click() : p.locator(`${hub}[data-testid="mode-classic"]`).tap());
  await p.locator('[data-testid="sheet-start"]').waitFor();
  await p.waitForTimeout(400);
  const easy = p.locator('[data-testid="difficulty-easy"]');
  if (await easy.count()) await (desk ? easy.click() : easy.tap());
  await (desk ? p.locator('[data-testid="sheet-start"]').click() : p.locator('[data-testid="sheet-start"]').tap());
  await p.locator(`${desk ? ".play" : PANE} .board .cell .d.given`).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(400);
  const g = desk
    ? await p.evaluate(() => {
        const out = new Array(81).fill("0");
        for (const c of document.querySelectorAll(".play .board .cell")) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d")?.textContent?.trim() || "0";
        return out.join("");
      })
    : await grid(p, "play");
  const sol = solveGrid(g);
  await fill(p, "play", g, sol, desk);
  await p.locator('[data-testid="new-puzzle"]').first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(900);
}
/** Лжец дня: найти ложную подсказку, обвинить (клавиша A → «Обвинить»), заполнить сетку. */
async function solveLiar(p) {
  await p.locator(`${PANE} [data-testid="mode-liar"]`).waitFor({ timeout: 60000 });
  await p.locator(`${PANE} [data-testid="mode-liar"]`).tap();
  await p.locator('[data-testid="liar-daily"]').waitFor();
  await p.waitForTimeout(350);
  await p.locator('[data-testid="liar-daily"]').tap();
  await p.locator(`${PANE} .board .cell .d.given`).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(400);
  const g = await grid(p, "play");
  const liar = findLiar(g);
  if (!liar) throw new Error("лжец не найден");
  await p.locator(`${PANE} .board .cell[data-i="${liar.cell}"]`).tap();
  await p.keyboard.press("a");
  await p.locator('[data-testid="accuse-confirm"]').waitFor({ timeout: 5000 });
  await p.locator('[data-testid="accuse-confirm"]').tap();
  await p.waitForTimeout(600);
  await fill(p, "play", g, liar.solution);
  await p.locator('[data-testid="new-puzzle"]').waitFor({ timeout: 20000 });
  await p.waitForTimeout(900);
}

/** Замер карточки Play и дока. */
const measure = (p) =>
  p.evaluate((PANE) => {
    const pane = document.querySelector(PANE);
    const bar = document.querySelector(".tabbar").getBoundingClientRect();
    const dock = pane.querySelector(".result-dock");
    const card = pane.querySelector('[data-testid="result-card"]');
    const R = (el) => {
      const r = el.getBoundingClientRect();
      return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const btn = (id) => {
      const el = pane.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = R(el);
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      const cs = getComputedStyle(el);
      return { ...r, where: el.closest(".result-dock") ? "dock" : el.closest(".card") ? "card" : "?", hitsSelf: el.contains(hit), hitTab: hit?.closest('[role="tab"]') ? true : false, bg: cs.backgroundColor, fw: cs.fontWeight };
    };
    const before = dock ? getComputedStyle(dock, "::before") : null;
    const r0 = (v) => +v.toFixed(1);
    const dcs = dock ? getComputedStyle(dock) : null;
    return {
      barTop: +bar.top.toFixed(1),
      type: document.documentElement.dataset.type ?? null,
      playClass: pane.querySelector(".play")?.className ?? null,
      range: pane.scrollHeight - pane.clientHeight,
      scrollTop: pane.scrollTop,
      dock: dock ? { ...R(dock), role: dock.getAttribute("role"), label: dock.getAttribute("aria-label"), kids: [...dock.children].map((c) => c.getAttribute("data-testid")), anim: dcs.animationName, coverBottom: r0(dock.getBoundingClientRect().bottom + parseFloat(getComputedStyle(dock, "::after").height || "0")), vh: innerHeight, fade: before.display !== "none" && /gradient/.test(before.backgroundImage), fadeH: before.height, line: dcs.boxShadow !== "none" || dcs.borderTopStyle !== "none", bg: dcs.backgroundColor, cw: dock.clientWidth - parseFloat(dcs.paddingLeft) - parseFloat(dcs.paddingRight) } : null,
      card: card ? R(card) : null,
      cardTitle: card?.querySelector("h2")?.textContent ?? null,
      nolog: !!card?.querySelector('[data-testid="tl-nolog"]'),
      cardActs: card ? [...card.querySelectorAll('[data-testid="tl-watch"], [data-testid="share"], [data-testid="new-puzzle"]')].map((b) => b.getAttribute("data-testid")) : [],
      watch: btn("tl-watch"),
      share: btn("share"),
      newp: btn("new-puzzle"),
      inkTint: getComputedStyle(document.documentElement).getPropertyValue("--ink-tint").trim(),
      /** Что лежит под доком в его верхней трети — карточка (контент уходит под док) или фон. */
      underDock: dock ? (() => { const r = dock.getBoundingClientRect(); dock.style.visibility = "hidden"; const e = document.elementFromPoint(r.left + 40, r.top + 6); dock.style.visibility = ""; return e?.closest(".card") ? "card" : e?.className ?? null; })() : null,
    };
  }, PANE);

const near = (a, b, eps = 1) => Math.abs(a - b) <= eps;
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `impl-${name}.png`) });
/** Кадры ветки и main — попиксельно (в странице: canvas). */
let diffSeq = 0;
/** Кадр для сравнения ветка/main: время партии (подпись, строка Time) — под маской, оно зависит от темпа прогона. */
const cmpShot = (p) => p.screenshot({ mask: [p.locator(".clock"), p.locator(".card dd.mono")], maskColor: "#ff00ff" });
async function samePixels(p, a, b) {
  if (Buffer.compare(a, b) === 0) return { same: true, diff: 0 };
  const n = ++diffSeq;
  fs.writeFileSync(`/tmp/pd285-diff-${n}-branch.png`, a);
  fs.writeFileSync(`/tmp/pd285-diff-${n}-main.png`, b);
  const diff = await p.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = `data:image/png;base64,${s}`; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return -1;
    const c = document.createElement("canvas");
    c.width = x.width; c.height = x.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(x, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(y, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < da.length; i += 4)
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
        n++;
        const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
    return { n, box: n ? [x0, y0, x1, y1] : null, h: c.height };
  }, [a.toString("base64"), b.toString("base64")]);
  if (diff === -1) return { same: false, diff: -1 };
  // Время партии под маской, но стекло таб-бара размывает то, что под ним (в т. ч. цифры времени) — разница, целиком лежащая
  // в полосе таб-бара (нижние 98 px × DPR при inset 34, 64 px при 0), — шум темпа прогона, а не раскладка.
  const barTopPx = await p.evaluate(() => document.querySelector(".tabbar")?.getBoundingClientRect().top ?? innerHeight).then((t) => t * (diff.h / (p.viewportSize()?.height || diff.h)));
  const underGlass = diff.box && diff.box[1] >= barTopPx - 2;
  // ≤ 4 px — шум сглаживания (встречен 1 px у иконки секции Grid ∞ на Today, код которой ветка не трогает).
  return { same: diff.n === 0 || underGlass || diff.n <= 4, diff: diff.n, box: diff.box, underGlass: !!underGlass };
}

const SIZES = [
  { name: "320", w: 320, h: 568, top: 20, bot: 0 },
  { name: "393", w: 393, h: 852, top: 59, bot: 34 },
  { name: "430", w: 430, h: 932, top: 59, bot: 34 },
];

/** п. 1/3/4: покой, середина, конец прокрутки — на текущей решённой карточке. */
async function dockChecks(p, T, { shots = true, expectKids = ["tl-watch", "share", "new-puzzle"], scheme = "light" } = {}) {
  const rest = await measure(p);
  const acts = expectKids.map((k) => ({ "tl-watch": rest.watch, share: rest.share, "new-puzzle": rest.newp })[k]);
  check(`${T} покой: док есть, класс .play-result-dock, кнопки в доке [${expectKids}]`, !!rest.dock && /play-result-dock/.test(rest.playClass) && JSON.stringify(rest.dock.kids) === JSON.stringify(expectKids), { kids: rest.dock?.kids, cardActs: rest.cardActs });
  check(`${T} покой: низ дока = верх таб-бара ±1`, rest.dock && near(rest.dock.bottom, rest.barTop), { dockBottom: rest.dock?.bottom, barTop: rest.barTop });
  check(`${T} покой: все кнопки целиком над таб-баром, тап по центру — в кнопку (не во вкладку)`, acts.every((a) => a && a.bottom <= rest.barTop + 0.5 && a.top >= 0 && a.hitsSelf && !a.hitTab), { acts: acts.map((a) => a && { t: a.top, b: a.bottom, hit: a.hitsSelf }) });
  check(`${T} покой: цели ≥ 44 px`, acts.every((a) => a && a.h >= 44), { h: acts.map((a) => a?.h) });
  if (shots) await shot(p, `${T}-rest`);
  let mid = null;
  if (rest.range > 4) {
    await scrollTo(p, "mid");
    await p.waitForTimeout(150);
    mid = await measure(p);
    check(`${T} середина: под стеклом таб-бара — фон дока (::after до низа экрана), карточка снизу не проступает`, mid.dock.coverBottom >= mid.dock.vh - 0.5, { coverBottom: mid.dock.coverBottom, vh: mid.dock.vh });
    check(`${T} середина: док на месте (±1), под ним карточка, растушёвка 16 px видна`, near(mid.dock.top, rest.dock.top) && mid.underDock === "card" && mid.dock.fade && mid.dock.fadeH === "16px" && !mid.dock.line, { top: mid.dock.top, under: mid.underDock, fade: mid.dock.fade, line: mid.dock.line });
    if (shots) await shot(p, `${T}-mid`);
  }
  await scrollTo(p, "end");
  await p.waitForTimeout(150);
  const end = await measure(p);
  check(`${T} конец прокрутки: между карточкой и доком ровно 16 px (лишнего переполнения нет)`, near(end.dock.top - end.card.bottom, 16), { gap: +(end.dock.top - end.card.bottom).toFixed(1) });
  check(`${T} конец прокрутки: низ карточки ≤ верх дока, док на месте ±1 (без прыжка)`, end.card.bottom <= end.dock.top + 0.5 && near(end.dock.top, rest.dock.top) && near(end.dock.bottom, rest.barTop), { cardBottom: end.card.bottom, dockTop: end.dock.top, restTop: rest.dock.top, range: rest.range });
  if (shots) await shot(p, `${T}-end`);
  await scrollTo(p, 0);
  await p.waitForTimeout(100);
  return { rest, mid, end };
}

async function runBrowser(name) {
  const B = SHORT[name];
  const browser = await pw[name].launch();
  const srv = await serve(DIST, PORT);
  const base = `http://127.0.0.1:${PORT}`;
  const srvB = BASE_DIST ? await serve(BASE_DIST, PORT + 1) : null;
  const baseB = `http://127.0.0.1:${PORT + 1}`;
  const ctxs = [];
  const track = (o) => (ctxs.push(o.ctx), o);
  try {
    // ---------- en: полная матрица на одной решённой партии ----------
    if (!process.env.ONLY_SAME) {
      const { p, errs } = track(await open(browser, { w: 393, h: 852, base }));
      await solvePlay(p);
      // п. 9: фокус после решения — на карточке; имя группы
      const focus0 = await p.evaluate(() => document.activeElement?.getAttribute("data-testid"));
      check(`${B} п.9: после решения фокус на карточке`, focus0 === "result-card", { focus0 });
      for (const scheme of ["light", "dark"]) {
        await p.emulateMedia({ colorScheme: scheme });
        for (const s of SIZES) {
          await env(p, s);
          const T = `${B}-${s.name}-${scheme}`;
          const r = await dockChecks(p, T);
          if (s.name === "393" && scheme === "light") {
            check(`${B} п.9: у группы дока role=group и имя «Solved»`, r.rest.dock.role === "group" && r.rest.dock.label === "Solved", { role: r.rest.dock.role, label: r.rest.dock.label });
            check(`${B} п.10: док появляется кроссфейдом (fadeIn), без сдвига`, r.rest.dock.anim === "fadeIn", { anim: r.rest.dock.anim });
            check(`${B} 393: геометрия дока 120 px (10 + 46 + 8 + 46 + 10), Watch во всю ширину, ряд Share | New puzzle`, near(r.rest.dock.h, 120, 1.5) && near(r.rest.watch.w, r.rest.dock.cw, 1) && near(r.rest.share.top, r.rest.newp.top) && r.rest.share.right < r.rest.newp.left, { h: r.rest.dock.h, watchW: r.rest.watch.w, cw: r.rest.dock.cw });
          }
          if (s.name === "320" && scheme === "light") check(`${B} 320×568: док 112 px (PD-87: 8 + 44 + 8 + 44 + 8)`, near(r.rest.dock.h, 112, 1.5), { h: r.rest.dock.h });
        }
      }
      await p.emulateMedia({ colorScheme: "light" });
      await env(p, SIZES[1]);
      // п. 4: Increase Contrast / Reduce Transparency — линия, без растушёвки
      const variants = [["contrast", { contrast: "more" }]];
      for (const [label, media] of variants) {
        await p.emulateMedia({ colorScheme: "light", ...media });
        await scrollTo(p, "mid");
        await p.waitForTimeout(150);
        const m = await measure(p);
        check(`${B} п.4 ${label}: растушёвки нет, над доком линия`, !m.dock.fade && m.dock.line, { fade: m.dock.fade, line: m.dock.line });
        await shot(p, `${B}-393-light-mid-${label}`);
        await p.emulateMedia({ colorScheme: "light", contrast: null });
        await scrollTo(p, 0);
      }
      if (name === "chromium") {
        const cdp = await p.context().newCDPSession(p);
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
        await p.waitForTimeout(150);
        const rtOn = await p.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches);
        await scrollTo(p, "mid");
        await p.waitForTimeout(150);
        const m = await measure(p);
        check(`${B} п.4 reduce transparency: растушёвки нет, над доком линия`, rtOn && !m.dock.fade && m.dock.line, { rtOn, fade: m.dock.fade, line: m.dock.line });
        await shot(p, `${B}-393-light-mid-rt`);
        await p.emulateMedia({ colorScheme: "dark" });
        const m2 = await measure(p);
        check(`${B} п.4 reduce transparency, dark: линия, без растушёвки`, !m2.dock.fade && m2.dock.line, { fade: m2.dock.fade });
        await shot(p, `${B}-393-dark-mid-rt`);
        await cdp.send("Emulation.setEmulatedMedia", { features: [] });
        await p.emulateMedia({ colorScheme: "light" });
        await scrollTo(p, 0);
      }
      // п. 9: Tab с карточки: строки → Watch → Share → New puzzle; фокус не под доком
      {
        await p.evaluate(() => document.querySelector('[data-testid="result-card"]').focus({ preventScroll: true }));
        const seq = [];
        const tabKey = name === "webkit" ? "Alt+Tab" : "Tab";
        for (let k = 0; k < 5; k++) {
          await p.keyboard.press(tabKey);
          await p.waitForTimeout(120);
          seq.push(
            await p.evaluate((PANE) => {
              const a = document.activeElement;
              const r = a.getBoundingClientRect();
              const dock = document.querySelector(`${PANE} .result-dock`).getBoundingClientRect();
              const bar = document.querySelector(".tabbar").getBoundingClientRect();
              const inDock = !!a.closest(".result-dock");
              return { id: a.getAttribute("data-testid"), visible: inDock ? r.bottom <= bar.top + 0.5 : r.bottom <= dock.top + 0.5 && r.top >= 0 };
            }, PANE),
          );
          if (seq.at(-1).id === "new-puzzle") break;
        }
        const ids = seq.map((s) => s.id);
        check(`${B} п.9: Tab с карточки — What's this? → Watch → Share → New puzzle, каждый фокус виден (не под доком/баром)`, JSON.stringify(ids.slice(-4)) === JSON.stringify(["technique-help", "tl-watch", "share", "new-puzzle"]) && seq.every((s) => s.visible), { seq });
        await p.evaluate(() => document.activeElement?.blur());
        await scrollTo(p, 0);
      }
      // тап по New puzzle в покое — шит режима, а не вкладка
      {
        await p.locator('[data-testid="new-puzzle"]').tap();
        await p.waitForTimeout(450);
        const sheet = await p.locator('[data-testid="mode-sheet"]').count();
        const tab = await p.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null);
        check(`${B} 393: тап по New puzzle в покое открывает шит режима (не вкладку)`, sheet === 1, { sheet, tab });
        await p.locator('[data-testid="sheet-cancel"]').tap();
        await p.waitForTimeout(450);
      }
      // риск §8 п. 3: Play → Today → Play на решённой карточке — док на месте
      {
        const before = await measure(p);
        await p.locator('[role="tab"]').nth(0).tap();
        await p.waitForTimeout(900);
        await p.locator('[role="tab"]').nth(1).tap();
        await p.waitForTimeout(900);
        const after = await measure(p);
        check(`${B} Play → Today → Play: док на месте у таб-бара`, after.dock && near(after.dock.top, before.dock.top) && near(after.dock.bottom, after.barTop), { before: before.dock?.top, after: after.dock?.top });
      }
      // п. 5: AX3 — дока нет, кнопки в конце карточки
      for (const s of [SIZES[1], SIZES[0]]) {
        await env(p, { ...s, fsPx: 40 });
        await p.waitForTimeout(300);
        const m = await measure(p);
        check(`${B}-${s.name} п.5 AX3: data-type=ax3, дока нет, кнопки в карточке Watch → Share → New puzzle`, m.type === "ax3" && !m.dock && !/play-result-dock/.test(m.playClass) && JSON.stringify(m.cardActs) === JSON.stringify(["tl-watch", "share", "new-puzzle"]), { type: m.type, dock: !!m.dock, acts: m.cardActs });
        await shot(p, `${B}-${s.name}-light-rest-ax3`);
        await scrollTo(p, "end");
        await p.waitForTimeout(150);
        const e = await measure(p);
        check(`${B}-${s.name} п.5 AX3: в конце прокрутки все кнопки над таб-баром (peek)`, [e.watch, e.share, e.newp].every((a) => a && a.bottom <= e.barTop + 0.5), { b: [e.watch?.bottom, e.share?.bottom, e.newp?.bottom], bar: e.barTop });
        await shot(p, `${B}-${s.name}-light-end-ax3`);
      }
      // смена размера текста обратно — док возвращается без перезагрузки
      await env(p, SIZES[1]);
      const back = await measure(p);
      check(`${B} AX3 → обычный текст: док вернулся без перезагрузки`, !!back.dock && near(back.dock.bottom, back.barTop), { dock: !!back.dock });
      // п. 6: ландшафт
      for (const [lw, lh, ln] of [[852, 393, "852x393"], [568, 320, "568x320"]]) {
        await env(p, { w: lw, h: lh, top: 0, bot: ln === "852x393" ? 21 : 0 });
        await p.waitForTimeout(300);
        const m = await measure(p);
        check(`${B} п.6 ландшафт ${ln}: дока нет, кнопки в карточке`, !m.dock && JSON.stringify(m.cardActs) === JSON.stringify(["tl-watch", "share", "new-puzzle"]), { dock: !!m.dock, acts: m.cardActs });
        await shot(p, `${B}-land-${ln}`);
      }
      await env(p, SIZES[1]);
      const back2 = await measure(p);
      check(`${B} ландшафт → портрет: док вернулся`, !!back2.dock && near(back2.dock.bottom, back2.barTop), { dock: !!back2.dock });
    }
    // ---------- uk / ru: самая длинная подпись ----------
    for (const lang of process.env.ONLY_SAME ? [] : ["uk-UA", "ru-RU"]) {
      const { p } = track(await open(browser, { w: 393, h: 852, base, lang }));
      await solvePlay(p);
      for (const s of SIZES) {
        await env(p, s);
        const T = `${B}-${s.name}-light-${lang.slice(0, 2)}`;
        const r = await dockChecks(p, T, { shots: s.name !== "430" });
        check(`${T}: подписи не обрезаны (кнопки не шире ячейки, текст в кнопке целиком)`, await p.evaluate((PANE) => [...document.querySelectorAll(`${PANE} .result-dock > *`)].every((b) => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1)), {});
        if (s.name === "393") check(`${T}: имя группы — локализованный заголовок`, r.rest.dock.label === r.rest.cardTitle && r.rest.dock.label !== "Solved", { label: r.rest.dock.label });
      }
    }
    // ---------- Лжец дня: с повтором и без ----------
    if (!process.env.ONLY_SAME) {
      const { p } = track(await open(browser, { w: 393, h: 852, base }));
      await solveLiar(p);
      for (const s of [SIZES[1], SIZES[0]]) {
        await env(p, s);
        const T = `${B}-${s.name}-light-liar`;
        const r = await dockChecks(p, T);
        if (s.name === "393") check(`${T}: заголовок «Liar caught», имя группы дока — он же`, r.rest.cardTitle === "Liar caught" && r.rest.dock.label === "Liar caught", { title: r.rest.cardTitle, label: r.rest.dock.label });
      }
      // Без повтора: снять лог у записи Лжеца дня в IndexedDB (как запись с сервера без moveLog) и открыть день заново.
      const patched = await p.evaluate(
        (date) =>
          new Promise((ok) => {
            const rq = indexedDB.open("pundoku");
            rq.onsuccess = () => {
              const db = rq.result;
              const tx = db.transaction("kv", "readwrite");
              const st = tx.objectStore("kv");
              const g = st.get(`meta:liar:${date}`);
              g.onsuccess = () => {
                const rec = g.result;
                if (!rec) return ok(false);
                rec.play = { ...rec.play, log: [], logSynthetic: true };
                st.put(rec, `meta:liar:${date}`);
              };
              tx.oncomplete = () => ok(true);
              tx.onerror = () => ok(false);
            };
            rq.onerror = () => ok(false);
          }),
        DATE,
      );
      await p.reload();
      await p.waitForTimeout(1200);
      await env(p, SIZES[1]);
      await p.locator(`${PANE} [data-testid="mode-liar"]`).tap();
      await p.locator('[data-testid="liar-daily"]').waitFor();
      await p.waitForTimeout(350);
      await p.locator('[data-testid="liar-daily"]').tap();
      await p.locator('[data-testid="new-puzzle"]').waitFor({ timeout: 20000 });
      await p.waitForTimeout(900);
      for (const s of [SIZES[1], SIZES[0], SIZES[2]]) {
        await env(p, s);
        for (const scheme of s.name === "393" ? ["light", "dark"] : ["light"]) {
          await p.emulateMedia({ colorScheme: scheme });
          const T = `${B}-${s.name}-${scheme}-nolog`;
          const r = await dockChecks(p, T, { expectKids: ["new-puzzle"] });
          check(`${T}: запись без лога (patched=${patched}) — строка «повтор недоступен» в карточке, Watch/Share нет`, r.rest.nolog && !r.rest.watch && !r.rest.share, { nolog: r.rest.nolog });
          check(`${T}: New puzzle тонированная во всю ширину, 600`, near(r.rest.newp.w, r.rest.dock.cw, 1) && r.rest.newp.bg !== "rgba(0, 0, 0, 0)" && r.rest.newp.fw === "600", { w: r.rest.newp.w, cw: r.rest.dock.cw, bg: r.rest.newp.bg, fw: r.rest.newp.fw });
        }
        await p.emulateMedia({ colorScheme: "light" });
      }
    }
    // ---------- «не изменилось»: AX3 / ландшафт / десктоп C / Today — кадр ветки = кадр main ----------
    if (srvB) {
      const pair = [];
      for (const [label, u] of [["branch", base], ["main", baseB]]) {
        const o = track(await open(browser, { w: 393, h: 852, base: u }));
        await solvePlay(o.p);
        const shots = {};
        await env(o.p, { ...SIZES[1], fsPx: 40 });
        await o.p.waitForTimeout(300);
        shots.ax3 = await cmpShot(o.p);
        await scrollTo(o.p, "end");
        await o.p.waitForTimeout(150);
        shots.ax3end = await cmpShot(o.p);
        await env(o.p, { w: 852, h: 393, top: 0, bot: 21 });
        await o.p.waitForTimeout(300);
        shots.land = await cmpShot(o.p);
        pair.push({ label, p: o.p, shots });
      }
      for (const k of ["ax3", "ax3end", "land"]) {
        const d = await samePixels(pair[0].p, pair[0].shots[k], pair[1].shots[k]);
        check(`${B} не изменилось: ${k} — кадр ветки = кадр main`, d.same, d);
      }
      // десктоп C 1440×900
      const desk = [];
      for (const u of [base, baseB]) {
        const o = track(await open(browser, { w: 1440, h: 900, dpr: 1, touch: false, base: u }));
        await solvePlay(o.p, true);
        desk.push({ p: o.p, shot: await cmpShot(o.p), dock: await o.p.locator(".result-dock").count(), insp: await o.p.locator("aside.desk-insp [data-testid='new-puzzle']").count() });
      }
      check(`${B} п.7 десктоп C 1440×900: .result-dock нет, New puzzle в инспекторе`, desk[0].dock === 0 && desk[0].insp === 1, { dock: desk[0].dock, insp: desk[0].insp });
      fs.writeFileSync(path.join(OUT, `impl-${B}-desk-1440.png`), desk[0].shot);
      const dd = await samePixels(desk[0].p, desk[0].shot, desk[1].shot);
      check(`${B} п.7 десктоп C 1440×900: кадр ветки = кадр main`, dd.same, dd);
      // Today 393: решённая карточка дня
      const today = [];
      for (const u of [base, baseB]) {
        const o = track(await open(browser, { w: 393, h: 852, base: u, route: "today" }));
        await o.p.locator('.tab-pane[data-tab="today"] .board .cell').first().waitFor({ timeout: 60000 });
        await o.p.waitForTimeout(500);
        const g = await grid(o.p, "today");
        await fill(o.p, "today", g, [...SOLUTION].map(Number));
        await o.p.waitForTimeout(1500);
        const sc = await o.p.evaluate(() => {
          const sc = document.querySelector('.tab-pane[data-tab="today"]');
          return { card: !!sc.querySelector('[data-testid="result-card"]'), dock: document.querySelectorAll(".result-dock").length };
        });
        today.push({ p: o.p, sc, shot: await cmpShot(o.p) });
        await o.p.evaluate(() => (document.querySelector('.tab-pane[data-tab="today"]').scrollTop = 1e6));
        await o.p.waitForTimeout(200);
        today.at(-1).end = await cmpShot(o.p);
      }
      check(`${B} п.8 Today: карточка дня есть, .result-dock нет`, today[0].sc.card && today[0].sc.dock === 0, today[0].sc);
      fs.writeFileSync(path.join(OUT, `impl-${B}-today-393.png`), today[0].shot);
      for (const k of ["shot", "end"]) {
        const d = await samePixels(today[0].p, today[0][k], today[1][k]);
        check(`${B} п.8 Today 393 (${k === "shot" ? "покой" : "конец"}): кадр ветки = кадр main`, d.same, d);
      }
    }
  } catch (e) {
    check(`${B} прогон упал`, false, { err: String(e.message).split("\n")[0] });
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
    await browser.close();
    srv.close();
    srvB?.close();
  }
}

for (const b of browsers) await runBrowser(b);
const total = Object.keys(results).length;
fs.writeFileSync(path.join(OUT, `impl-results-${browsers.map((b) => SHORT[b]).join("-")}.json`), JSON.stringify({ at: new Date().toISOString(), total, fails, results }, null, 2) + "\n");
console.log(`\n${total - fails.length}/${total} PASS${fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : ""}`);
process.exitCode = fails.length ? 1 : 0;
