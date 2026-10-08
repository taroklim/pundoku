/**
 * PD-249 — ландшафт телефона в две колонки: кадры + замеры на РЕАЛЬНОЙ сборке; портрет — попиксельно против сборки main.
 *
 *   cd apps/web && pnpm exec vite build --outDir /tmp/pd249-dist            (ветка)
 *   git stash / другой worktree на main → vite build --outDir /tmp/pd249-base-dist   (эталон портрета; нужен только для `portrait`)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd249-dist BASE_DIST=/tmp/pd249-base-dist \
 *     node design/pd249-shots.mjs [land] [modes] [extra] [portrait] [webkit]   (без аргументов — всё)
 *
 * Сервер — встроенный статический + заглушка /api/daily (как pd159-serve/pd227-check), порт 5249/5250 (PORT). Один браузер за раз;
 * браузеры и сервер закрываются в finally; никаких pkill.
 *
 * Кадры в design/pd249-shots/ (cr-* chromium, wk-* webkit), DPR 2, isMobile + hasTouch:
 *   <br>-<w>x<h>-<scheme>-<screen>.png
 *     today (Today до первого хода: строка Ink mode в зазоре) · today-sel (клетка выбрана, цифра поставлена) · today-dock (док подсказки)
 *     · play (Play, Classic) · hub · year · settings · settings-end (прокручено до конца) · help · card (Today решён: карточка)
 *     · card-end (карточка прокручена до Grid ∞) · archive (прошлый день) · <mode> (Ink, Liar, Melody, Lantern, Glyphs — партия)
 *     · ink-sheet, mode-sheet, more (шиты/меню)
 *   portrait-<w>x<h>-<scheme>-<screen>-{base,new}.png + сводка SAME/DIFF (results.json).
 *
 * Автопроверки (FAIL печатается и попадает в results.json):
 *   ландшафт, экран партии: поле квадратное, целиком в окне и над таб-баром; поле слева от панели (не пересекаются);
 *   ряд действий / док над таб-баром; поле не заходит под вырез (левый край ≥ safe-area, подставляется 59 px как у iPhone 16);
 *   остальные экраны: прокрутка до конца — последний элемент целиком над таб-баром; ничего не шире окна (нет гориз. прокрутки).
 *   портрет: кадр ветки = кадр main попиксельно.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd249-shots");
const PORT = +(process.env.PORT ?? 5249);
const NOW = new Date("2026-10-08T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const which = process.argv.slice(2).length ? process.argv.slice(2) : ["land", "modes", "extra", "portrait", "webkit"];
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
    if (u.startsWith("/api/")) { r.writeHead(503); return r.end(); }
    if (u === "/health") { r.writeHead(200); return r.end("ok"); }
    let f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
    r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

// Решение сетки дня (перебор; сетка лёгкая).
function solve(m) {
  const g = [...m].map(Number);
  const ok = (i, d) => {
    const r = Math.floor(i / 9), c = i % 9;
    for (let k = 0; k < 9; k++) if (g[r * 9 + k] === d || g[k * 9 + c] === d) return false;
    const br = r - (r % 3), bc = c - (c % 3);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === d) return false;
    return true;
  };
  const go = () => { const i = g.indexOf(0); if (i < 0) return true; for (let d = 1; d <= 9; d++) if (ok(i, d)) { g[i] = d; if (go()) return true; g[i] = 0; } return false; };
  go();
  return g;
}

const results = {};
const fails = [];
const check = (name, ok, detail) => { results[name] = { ok, ...detail }; if (!ok) fails.push(name); console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail)); };

async function open(browser, { w, h, scheme = "light", route = "today", sa = null, ax3 = false, base }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 2, isMobile: browser.browserType().name() !== "firefox", hasTouch: true, locale: "en-US", timezoneId: "UTC", colorScheme: scheme, reducedMotion: "reduce", serviceWorkers: "block" });
  await ctx.clock.setFixedTime(NOW);
  // Детерминированная случайность (сид партий Play) — попиксельное сравнение портрета base/new.
  await ctx.addInitScript(() => { let x = 0x9e3779b9; crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) { x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; a[i] = x & (a.BYTES_PER_ELEMENT === 1 ? 0xff : a.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffffffff); } return a; }; });
  // Safe-area iPhone 16 в ландшафте подставляется переопределением токенов (env() в эмуляции = 0).
  if (sa) await ctx.addInitScript((sa) => { const add = () => { const s = document.createElement("style"); s.textContent = `:root{--sa-top:${sa[0]}px!important;--sa-r:${sa[1]}px!important;--sa-bot:${sa[2]}px!important;--sa-l:${sa[3]}px!important}`; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add); }, sa);
  // AX3 (крупнейший текст): корневой кегль 40 px, как в PD-159.
  if (ax3) await ctx.addInitScript(() => { const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add); });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  if (route.startsWith("day/")) {
    // Архив открыт с даты первого запуска: сначала «запуск» двумя днями раньше (пишет meta:firstUseDate), потом сегодня.
    await ctx.clock.setFixedTime(new Date(NOW.getTime() - 2 * 864e5));
    await p.goto(`${base}/#/today`);
    await p.waitForSelector(".board button.cell", { timeout: 40000 });
    await p.waitForTimeout(800);
    await ctx.clock.setFixedTime(NOW);
  }
  await p.goto(`${base}/#/${route}`);
  if (route.startsWith("day/")) await p.reload();
  await p.waitForSelector(".shell", { timeout: 40000 });
  if (route === "today" || route.startsWith("day/")) await p.waitForSelector(".board button.cell", { timeout: 40000 });
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

/** Замеры экрана партии. */
const gameGeom = (p) =>
  p.evaluate(() => {
    const R = (s) => { const e = document.querySelector(`.tab-pane:not(.off) ${s}, .push-layer ${s}`) ?? document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const play = document.querySelector(".tab-pane:not(.off) .play-fit, .push-layer .play-fit");
    const sc = play?.closest(".scroll");
    return {
      fit: !!play, board: R(".play-fit .board"), pad: R(".play-fit .pad"), actions: R(".play-fit .actions"), dock: R(".play-fit .hint-dock"),
      toolbar: R(".play-fit .toolbar"), tab: R(".tabbar"), vw: innerWidth, vh: innerHeight,
      scroll: sc ? { st: sc.scrollTop, sh: sc.scrollHeight, ch: sc.clientHeight } : null,
      hscroll: document.documentElement.scrollWidth > innerWidth + 0.5,
    };
  });
function checkGame(label, g, { sa = 0 } = {}) {
  const b = g.board, tab = g.tab, low = g.dock ?? g.actions;
  const square = b && Math.abs(b.w - b.h) < 1.5;
  const inWin = b && b.t >= -0.5 && b.b <= tab.t + 0.5 && b.l >= Math.max(16, sa) - 0.5;
  const right = (g.pad ?? g.dock) && b ? (g.pad ?? g.dock).l >= b.r + 8 : false;
  const above = low ? low.b <= tab.t + 0.5 : false;
  const rightEdge = (g.pad ?? g.dock) ? (g.pad ?? g.dock).r <= g.vw - Math.max(16, sa) + 0.5 : false;
  check(label, g.fit && square && inWin && right && above && rightEdge && !g.hscroll, { board: b && [Math.round(b.l), Math.round(b.t), Math.round(b.w), Math.round(b.h)], padL: Math.round((g.pad ?? g.dock)?.l ?? -1), lowB: Math.round(low?.b ?? -1), tabT: Math.round(tab.t), square, inWin, right, above, rightEdge, hscroll: g.hscroll });
}
/** Прокрутка активной панели до конца: последний видимый элемент над таб-баром, без горизонтальной прокрутки. */
async function scrollEnd(p, label) {
  const r = await p.evaluate(async () => {
    const sc = document.querySelector(".scroll.push-layer") ?? document.querySelector(".scroll.tab-pane:not(.off)");
    const inner = sc.querySelector(".hub-scroll") ?? sc;
    inner.scrollTop = inner.scrollHeight;
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const tab = document.querySelector(".tabbar")?.getBoundingClientRect();
    const tbs = document.querySelector(".tabbar") && getComputedStyle(document.querySelector(".tabbar"));
    const limit = tab && tab.height > 0 && tbs.visibility !== "hidden" && tbs.display !== "none" ? tab.top : innerHeight;
    const all = [...inner.querySelectorAll("button, p, h2, h3, li, a, input, select, .card, section > *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== "hidden"; });
    const last = all.reduce((m, e) => (e.getBoundingClientRect().bottom > (m?.getBoundingClientRect().bottom ?? -1) ? e : m), null);
    const lb = last?.getBoundingClientRect();
    const wide = [...inner.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== "fixed"; }).map((e) => e.className?.toString().slice(0, 30));
    return { st: inner.scrollTop, sh: inner.scrollHeight, ch: inner.clientHeight, lastB: lb ? Math.round(lb.bottom) : null, lastTxt: last?.textContent?.trim().slice(0, 30), limit: Math.round(limit), wide: wide.slice(0, 5), hscroll: document.documentElement.scrollWidth > innerWidth + 0.5 };
  });
  check(label, r.lastB !== null && r.lastB <= r.limit + 0.5 && r.wide.length === 0 && !r.hscroll, r);
  return r;
}

async function toHub(p) {
  await p.locator("#tab-play").click();
  await p.locator('[data-testid="mode-classic"]').waitFor({ timeout: 30000 });
  await p.waitForTimeout(500);
}
async function startMode(p, mode) {
  await p.locator(`[data-testid="mode-${mode}"]`).click();
  await p.locator('[data-testid="sheet-start"]').waitFor();
  await p.waitForTimeout(400);
  await p.locator('[data-testid="difficulty-easy"]').click().catch(() => {});
  await p.locator('[data-testid="sheet-start"]').click();
  if (mode === "ink") {
    await p.locator('[data-testid="ink-rule-start"]').click({ timeout: 5000 }).catch(() => {});
  }
  await p.waitForSelector(".tab-pane:not(.off) .play-fit .board .cell .d.given", { timeout: 90000 });
  await p.waitForTimeout(900);
}

const SIZES = [[852, 393], [932, 430]];
// iPhone 16 в ландшафте: верх 0, вырез сбоку 59, Home 21.
const SA16 = [0, 59, 21, 59];

let browser = null;
const servers = [];
try {
  servers.push(await serve(DIST, PORT));
  const NEW = `http://127.0.0.1:${PORT}`;

  if (which.includes("land") || which.includes("modes")) {
    browser = await pw.chromium.launch();
    if (which.includes("land"))
      for (const [w, h] of SIZES)
        for (const scheme of ["light", "dark"]) {
          const tag = `cr-${w}x${h}-${scheme}`;
          const { ctx, p, errs } = await open(browser, { w, h, scheme, base: NEW });
          await shot(p, `${tag}-today`);
          checkGame(`${tag} today: поле слева, панель справа, всё над таб-баром`, await gameGeom(p));
          // Выбор клетки + цифра
          const sol = solve(MISSION);
          const first = [...MISSION].findIndex((c) => c === "0");
          await p.locator(`.board button.cell[data-i="${first}"]`).tap();
          await p.locator(".tab-pane:not(.off) .pad .key").nth(sol[first] - 1).tap();
          await p.waitForTimeout(400);
          await shot(p, `${tag}-today-sel`);
          // Док подсказки
          await p.locator('.tab-pane:not(.off) [data-testid="hint-button"]').tap();
          await p.waitForTimeout(400);
          if (await p.locator('[data-testid="hint-rule-go"]').isVisible().catch(() => false)) {
            if (scheme === "light" && w === 852) await shot(p, `${tag}-hint-rule-sheet`);
            await p.locator('[data-testid="hint-rule-go"]').tap();
          }
          await p.locator('[data-testid="hint-dock"]').waitFor({ timeout: 5000 });
          await p.waitForTimeout(500);
          await shot(p, `${tag}-today-dock`);
          checkGame(`${tag} today-dock: док справа, над таб-баром`, await gameGeom(p));
          await p.locator('[data-testid="hint-close"]').tap();
          await p.waitForTimeout(300);
          // Решить → карточка
          for (let i = 0; i < 81; i++) {
            if (MISSION[i] !== "0" || i === first) continue;
            await p.locator(`.board button.cell[data-i="${i}"]`).tap();
            await p.locator(".tab-pane:not(.off) .pad .key").nth(sol[i] - 1).tap();
          }
          await p.waitForSelector('[data-testid="result-card"]', { timeout: 20000 });
          await p.waitForTimeout(7000); // последовательность «решено» (PD-147) + посадка клетки Grid ∞
          await p.evaluate(() => { const s = document.querySelector(".scroll.tab-pane:not(.off)"); s.scrollTop = 0; });
          await p.waitForTimeout(300);
          await shot(p, `${tag}-card`);
          await scrollEnd(p, `${tag} card: прокрутка до конца, всё над таб-баром`);
          await shot(p, `${tag}-card-end`);
          // Хаб Play
          await toHub(p);
          await shot(p, `${tag}-hub`);
          await scrollEnd(p, `${tag} hub: прокрутка до конца`);
          await shot(p, `${tag}-hub-end`);
          // Play Classic
          await p.evaluate(() => { const s = document.querySelector(".tab-pane:not(.off) .hub-scroll"); if (s) s.scrollTop = 0; });
          await startMode(p, "classic");
          await shot(p, `${tag}-play`);
          checkGame(`${tag} play classic`, await gameGeom(p));
          if (scheme === "light") {
            await p.locator('.tab-pane:not(.off) [data-testid="more-button"]').tap();
            await p.waitForTimeout(400);
            await shot(p, `${tag}-more`);
            await p.keyboard.press("Escape");
            await p.waitForTimeout(300);
          }
          // Year
          await p.locator("#tab-year").click();
          await p.waitForTimeout(800);
          await shot(p, `${tag}-year`);
          await scrollEnd(p, `${tag} year: прокрутка до конца`);
          await shot(p, `${tag}-year-end`);
          // Settings
          await p.locator('.tab-pane:not(.off) [data-testid="open-settings"]').click();
          await p.waitForTimeout(800);
          await shot(p, `${tag}-settings`);
          await scrollEnd(p, `${tag} settings: прокрутка до конца`);
          await shot(p, `${tag}-settings-end`);
          // Help
          await p.goto(`${NEW}/#/help`);
          await p.waitForTimeout(1200);
          await shot(p, `${tag}-help`);
          await scrollEnd(p, `${tag} help: прокрутка до конца`);
          check(`${tag} без ошибок страницы`, errs.length === 0, { errs });
          await ctx.close();

          // Архивный день + iPhone 16 safe-area (вырез слева/справа, Home снизу)
          const a = await open(browser, { w, h, scheme, route: "day/2026-10-07", sa: SA16, base: NEW });
          await shot(a.p, `${tag}-archive-sa`);
          checkGame(`${tag} archive + safe-area iPhone 16`, await gameGeom(a.p), { sa: 59 });
          await a.ctx.close();
        }

    if (which.includes("modes")) {
      // Режимы Play — по одному кадру (852 light; Lantern/Glyphs ещё в dark), шит режима и шит правил Ink.
      for (const [mode, scheme] of [["ink", "light"], ["liar", "light"], ["melody", "light"], ["lantern", "light"], ["lantern", "dark"], ["glyphs", "light"], ["glyphs", "dark"]]) {
        const tag = `cr-852x393-${scheme}`;
        const { ctx, p, errs } = await open(browser, { w: 852, h: 393, scheme, base: NEW });
        await toHub(p);
        if (mode === "ink" && scheme === "light") {
          await p.locator('[data-testid="mode-ink"]').click();
          await p.locator('[data-testid="sheet-start"]').waitFor();
          await p.waitForTimeout(500);
          await shot(p, `${tag}-mode-sheet`);
          await p.locator('[data-testid="sheet-cancel"]').click();
          await p.waitForTimeout(400);
        }
        await startMode(p, mode);
        await shot(p, `${tag}-${mode}`);
        checkGame(`${tag} play ${mode}`, await gameGeom(p));
        check(`${tag} ${mode} без ошибок страницы`, errs.length === 0, { errs });
        await ctx.close();
      }
      // Шит правил Ink на Today (строка «Ink mode» в зазоре)
      const { ctx, p } = await open(browser, { w: 852, h: 393, base: NEW });
      await p.locator(".tab-pane:not(.off) .ink-entry button").first().tap();
      await p.waitForTimeout(600);
      await shot(p, "cr-852x393-light-ink-sheet");
      const sh = await p.evaluate(() => { const e = document.querySelector('[data-testid="ink-sheet"]'); const r = e?.getBoundingClientRect(); return r ? { t: Math.round(r.top), b: Math.round(r.bottom), sh: e.scrollHeight, ch: e.clientHeight } : null; });
      check("cr-852x393 ink-sheet в окне", sh && sh.t >= 0 && sh.b <= 393.5, sh ?? {});
      await ctx.close();
    }
    await browser.close();
    browser = null;
  }

  if (which.includes("extra")) {
    // Крайние случаи (не матрица тикета): 320-класс 568×320 и AX3 на 852×393 — не обрезано, докручивается, не наезжает.
    browser = await pw.chromium.launch();
    for (const [w, h, ax3] of [[568, 320, false], [852, 393, true]]) {
      const tag = `cr-${w}x${h}-light${ax3 ? "-ax3" : ""}`;
      const { ctx, p } = await open(browser, { w, h, ax3, base: NEW });
      await shot(p, `${tag}-today`);
      const g = await gameGeom(p);
      const ok = g.fit && g.board && Math.abs(g.board.w - g.board.h) < 1.5 && (g.pad ?? g.dock).l >= g.board.r + 8 && !g.hscroll;
      // ряд действий достижим: либо над таб-баром сразу, либо после прокрутки страницы
      const sc = await scrollEnd(p, `${tag} today: ряд действий достижим прокруткой`);
      await shot(p, `${tag}-today-end`);
      check(`${tag} today: две колонки, поле слева, панель справа`, ok, { board: g.board && [Math.round(g.board.l), Math.round(g.board.t), Math.round(g.board.w)], padL: Math.round((g.pad ?? g.dock).l), sc: sc.st });
      await ctx.close();
    }
    await browser.close();
    browser = null;
  }

  if (which.includes("webkit")) {
    browser = await pw.webkit.launch();
    for (const [w, h, scheme, route] of [[852, 393, "light", "today"], [932, 430, "dark", "today"], [852, 393, "dark", "day/2026-10-07"]]) {
      const tag = `wk-${w}x${h}-${scheme}`;
      const { ctx, p } = await open(browser, { w, h, scheme, route, base: NEW, sa: route === "today" ? null : SA16 });
      await shot(p, `${tag}-${route === "today" ? "today" : "archive-sa"}`);
      checkGame(`${tag} ${route} (webkit)`, await gameGeom(p), { sa: route === "today" ? 0 : 59 });
      if (route === "today" && scheme === "light") {
        await toHub(p);
        await startMode(p, "classic");
        await shot(p, `${tag}-play`);
        checkGame(`${tag} play (webkit)`, await gameGeom(p));
        await p.locator("#tab-year").click();
        await p.waitForTimeout(800);
        await shot(p, `${tag}-year`);
        await scrollEnd(p, `${tag} year (webkit)`);
      }
      await ctx.close();
    }
    await browser.close();
    browser = null;
  }

  if (which.includes("portrait")) {
    if (!BASE_DIST) throw new Error("portrait: нужен BASE_DIST (сборка main)");
    servers.push(await serve(BASE_DIST, PORT + 1));
    const OLD = `http://127.0.0.1:${PORT + 1}`;
    browser = await pw.chromium.launch();
    const cmp = await browser.newPage();
    const diff = async (a, b) =>
      cmp.evaluate(async ([a, b]) => {
        const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + s; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return -1;
        const px = (i) => { const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
        const da = px(ia), db = px(ib);
        let n = 0;
        for (let k = 0; k < da.length; k += 4) if (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2]) n++;
        return n;
      }, [a.toString("base64"), b.toString("base64")]);
    for (const [w, h] of [[393, 852], [320, 568], [430, 932]])
      for (const scheme of ["light", "dark"]) {
        const pics = {};
        for (const [k, base] of [["base", OLD], ["new", NEW]]) {
          const { ctx, p } = await open(browser, { w, h, scheme, base });
          // Часы партии тикают независимо от сборки (0:00/0:01) — закрыты маской, остальное сравнивается попиксельно.
          const take = async (screen) => { const buf = await p.screenshot({ mask: [p.locator(".subline .clock")], maskColor: "#f0f" }); (pics[screen] ??= {})[k] = buf; if (w === 393) fs.writeFileSync(path.join(OUT, `portrait-${w}x${h}-${scheme}-${screen}-${k}.png`), buf); };
          await take("today");
          await toHub(p);
          await take("hub");
          await startMode(p, "classic");
          await take("play");
          await p.locator("#tab-year").click();
          await p.waitForTimeout(800);
          await take("year");
          await ctx.close();
        }
        for (const [screen, v] of Object.entries(pics)) {
          const n = await diff(v.base, v.new);
          check(`portrait ${w}x${h} ${scheme} ${screen}: = main`, n === 0, { diffPx: n });
        }
      }
    await browser.close();
    browser = null;
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const s of servers) await new Promise((ok) => s.close(ok));
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ fails, results }, null, 1));
  console.log(fails.length ? `FAIL ${fails.length}:\n` + fails.join("\n") : "ALL PASS");
}
