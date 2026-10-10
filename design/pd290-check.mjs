/**
 * PD-290 — сведение десктопа C (pd-desk-c-all = PD-266 + PD-267 + PD-268 + PD-269): живая проверка того, что появилось или могло
 * сломаться только при сведении, на РЕАЛЬНОЙ сборке + «телефон не изменился» попиксельно против main.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd290-dist                 (ветка pd-desk-c-all)
 *   (main) npx vite build --outDir /tmp/pd290-base                         (эталон телефона; нужен только для `phone`)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd290-dist BASE_DIST=/tmp/pd290-base PORT=5401 \
 *     node design/pd290-check.mjs [party] [overlays] [screens] [focus] [phone] [chromium] [webkit] [firefox]
 *   Без частей — все; без браузеров — cr + wk + ff (Firefox — если есть в установке Playwright, иначе SKIP, не FAIL).
 *   Сервер — свой статический (не vite preview), сам останавливается в конце.
 *
 * Масштаб браузера — как в аудите PD-228 и pd266–269-check: вьюпорт = окно ÷ масштаб, DPR = масштаб. Матрица: 1280×800 /
 * 1440×900 / 1920×1080 × 100/125/150 % + компакт 1024×640 (DPR 1.25) и 960×600 (DPR 1.5); светлая и тёмная.
 *
 * party (п. 3, 4) — вся матрица × light/dark: партия Today — раскладка PD-267/268 «тулбар + поле | инспектор» не задета
 *   колонкой PD-269: у области поля (.desk-stage) и инспектора нет полей, поле = min(720, окно − 124, область − 96) по центру
 *   области, инспектор clamp(260, 20vw, 320) у правого края, панель 1–9 и действия в нём. Решённый Today (часть матрицы):
 *   `.today:not(.play-fit)` (колонка 640 PD-269) не появляется, поле того же размера на месте, карточка и Grid ∞ — в
 *   инспекторе, у карточки полей колонки нет; Watch → Timelapse — шит ≤ 560 по центру области.
 * overlays (п. 2) — вся матрица (светлая; тёмная — 100 % и компакт): шиты в слое окна — ≤ 560 (--w-sheet) по центру области
 *   контента, правее сайдбара: правило подсказки (лампочка), Fill (правый клик по Notes), месяц Year, шит режима («⋯ → Новая
 *   сетка»); меню ≤ 320 (--w-menu): «⋯» — под кнопкой, правым краем по ней; контекстное меню строки режима — у строки (левой
 *   кромкой по ней), не во всю область; обвинение Лжеца (правый клик по подсказке) — у клетки, в окне.
 * screens (п. 5) — компакт 1024×640 / 960×600 / 853×533 × light/dark и полная раскладка 1280×800 / 1920×1080: хаб, страница
 *   режима, Year, Settings, справка — колонки шкалы (640 / 480 / 780 / 640 / 640) по центру области, ни один элемент не вылезает
 *   за область, нет обрезанного текста (overflow ≠ visible и содержимое шире), нет горизонтальной прокрутки, заголовок шапки не
 *   наезжает на кнопку сайдбара/шестерёнку; Tab (WebKit — ⌥Tab) по каждому экрану и партии компакта — у каждого фокуса видимое
 *   кольцо, не срезанное предками и окном.
 * focus (п. 6) — 1440×900 и компакт 1024×640: выбранная клетка Today → режим из сайдбара → фокус на «Start», чип ↩ → Enter —
 *   партия Play, клетка Today не тронута; клавиши идут в новую партию (инспектор), Enter в партии ничего не запускает заново;
 *   фокус на пункте сайдбара + Enter — действие пункта, а не «Start»; компакт: «Show sidebar» → режим → сайдбар ушёл, фокус на
 *   «Start» (не на <body>), Enter — партия в компактной раскладке; при показанном поверх сайдбаре Enter на пункте не запускает.
 * phone — 393×852 (свет/тьма), 320×568, 852×393 (касание, DPR 3): Today, хаб, шит режима, контекстное меню строки, партия
 *   Classic, Year, Settings — кадр ветки = кадр main попиксельно (часы под маской) и одинаковое DOM-дерево.
 * Кадры — design/pd290-shots/; итог — PASS/FAIL построчно и сводка design/pd290-shots/results-<части>-<браузеры>.json.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd290-shots");
const PORT = +(process.env.PORT ?? 5401);
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const PARTS = ["party", "overlays", "screens", "focus", "phone"];
const args = process.argv.slice(2);
const parts = args.filter((a) => PARTS.includes(a));
const which = parts.length ? parts : PARTS;
const brs = args.filter((a) => ["chromium", "webkit", "firefox"].includes(a));
const browsers = brs.length ? brs : ["chromium", "webkit", "firefox"];
const SHORT = { chromium: "cr", webkit: "wk", firefox: "ff" };
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

async function open(browser, { w, h, dpr = 1, scheme = "light", route = "today", base, touch = false }) {
  const name = browser.browserType().name();
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    screen: { width: w, height: h },
    deviceScaleFactor: dpr,
    isMobile: touch && name !== "firefox",
    hasTouch: touch,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: scheme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await ctx.clock.setFixedTime(NOW);
  // Детерминированная случайность (сид партий Play) — попиксельное сравнение base/new.
  await ctx.addInitScript(() => {
    let x = 0x9e3779b9;
    crypto.getRandomValues = (a) => {
      for (let i = 0; i < a.length; i++) {
        x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
        a[i] = x & (a.BYTES_PER_ELEMENT === 1 ? 0xff : a.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffffffff);
      }
      return a;
    };
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/#/${route}`);
  if (route === "today") await p.waitForSelector(".tab-pane:not(.off) .board button.cell", { timeout: 40000 });
  else await p.waitForTimeout(600);
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}

const WINDOWS = [[1280, 800], [1440, 900], [1920, 1080]];
const ZOOMS = [100, 125, 150];
const COMPACT = [[1024, 640, 125], [960, 600, 150]];
const css = (W, H, z) => [Math.round(W / (z / 100)), Math.round(H / (z / 100))];
/** Вся матрица: [метка, css-ширина, css-высота, масштаб %]. */
const MATRIX = [...WINDOWS.flatMap(([W, H]) => ZOOMS.map((z) => [`${W}x${H}@${z}`, ...css(W, H, z), z])), ...COMPACT.map(([w, h, z]) => [`compact ${w}x${h}`, w, h, z])];
const isFull = (w, h) => w >= 1100 && h >= 680;
const settle = (p, ms = 450) => p.waitForTimeout(ms);
const P = ".tab-pane:not(.off)";
const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;
const mid = (r) => (r.left + r.right) / 2;
const box = (r) => r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];

async function rect(p, sel) {
  return p.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, sel);
}
/** Пункт сайдбара; на компакте сайдбар сначала показывается кнопкой (поверх контента) и сам уходит после выбора. */
async function side(p, testid, compact) {
  if (compact) {
    await p.locator('[data-testid="sidebar-toggle"]:visible').first().click();
    await p.waitForTimeout(250);
  }
  await p.locator(`[data-testid="${testid}"]`).click();
}

// ---------- партия: раскладка C ----------
async function party(p) {
  return p.evaluate(() => {
    const R = (el) => (el ? (({ left, top, width, height, right, bottom }) => ({ left, top, width, height, right, bottom }))(el.getBoundingClientRect()) : null);
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.hidden && el.getBoundingClientRect().width > 0;
    const pane = document.querySelector(".push-layer") ?? document.querySelector(".tab-pane:not(.off)");
    const play = pane?.querySelector(".play");
    const stage = play?.querySelector(":scope > .desk-stage");
    const insp = play?.querySelector(":scope > .desk-insp");
    const mg = (el) => (el ? [getComputedStyle(el).marginLeft, getComputedStyle(el).marginRight] : null);
    const card = insp?.querySelector(":scope > .card");
    return {
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      shell: document.querySelector(".shell")?.className,
      side: vis(document.querySelector(".sidebar")) ? R(document.querySelector(".sidebar")) : null,
      playClass: play?.className ?? null,
      todayNotFit: pane ? pane.querySelectorAll(".today:not(.play-fit)").length : -1,
      stage: R(stage),
      stageMargin: mg(stage),
      board: R(stage?.querySelector(".board")),
      cells: stage ? stage.querySelectorAll(".board button.cell").length : 0,
      insp: R(insp),
      inspMargin: mg(insp),
      inspSolved: insp?.classList.contains("solved") ?? false,
      inspClientW: insp?.clientWidth ?? 0,
      pad: R(insp?.querySelector(".pad")),
      actions: R(insp?.querySelector(".actions")),
      card: vis(card) ? R(card) : null,
      cardMargin: mg(card),
      grid: R(insp?.querySelector('[data-testid="grid-inf-section"] .board')),
      // Поля проверяются у детей потока (тулбар, область поля, инспектор); .sr-only (live-регион, margin −1px) и прочие вне потока — не колонка.
      kids: play ? [...play.children].filter((c) => !["absolute", "fixed"].includes(getComputedStyle(c).position) && getComputedStyle(c).display !== "none").map((c) => ({ cls: c.className, ml: getComputedStyle(c).marginLeft, mr: getComputedStyle(c).marginRight })) : [],
    };
  });
}

function partyChecks(T, m, { full }) {
  const deskX = full ? m.side.right + 8 : 0;
  const area = m.vw - deskX;
  const inspW = Math.min(320, Math.max(260, 0.2 * m.vw));
  const want = Math.min(720, m.vh - 124, area - inspW - 96);
  check(`${T}: раскладка ${full ? "с сайдбаром" : "компакт C"}, партия .play-fit.desk-play`, (full ? /^shell desk(?! compact)/.test(m.shell) && !!m.side : /^shell desk compact/.test(m.shell) && !m.side) && /play-fit/.test(m.playClass) && /desk-play/.test(m.playClass), { shell: m.shell, play: m.playClass });
  const noMargins = m.kids.every((k) => k.ml === "0px" && k.mr === "0px");
  check(`${T}: у детей партии (тулбар, область поля, инспектор) нет полей колонки PD-269`, noMargins, { kids: m.kids.filter((k) => k.ml !== "0px" || k.mr !== "0px") });
  check(`${T}: поле = min(720, окно − 124, область − 96) = ${Math.round(want)}, по центру области поля`, m.cells === 81 && near(m.board.width, want, 1) && near(m.board.width, m.board.height) && near(mid(m.board), mid(m.stage), 1) && near(m.stage.left, deskX, 1), { board: box(m.board), stage: box(m.stage), want: Math.round(want) });
  check(`${T}: инспектор clamp(260, 20vw, 320) = ${Math.round(inspW)} у правого края, во всю высоту`, near(m.insp.width, inspW, 1) && near(m.insp.right, m.vw, 0.5) && near(m.insp.top, 0, 0.5) && near(m.insp.bottom, m.vh, 0.5), { insp: box(m.insp) });
  check(`${T}: нет горизонтальной прокрутки`, m.scrollW <= m.vw, { scrollW: m.scrollW });
}

async function solveToday(p) {
  for (let i = 0; i < 81; i++)
    if (MISSION[i] === "0") {
      await p.locator(`${P} .board button.cell[data-i="${i}"]`).click();
      await p.keyboard.press(`Digit${SOLUTION[i]}`);
    }
  await p.waitForSelector(`${P} [data-testid="grid-inf-section"]`, { timeout: 20000 });
  await settle(p, 1200);
}

async function sheetCheck(p, T, name, sheetSel, scrimSel, m) {
  const sc = await rect(p, scrimSel);
  const sh = await rect(p, sheetSel);
  const want = sc ? Math.min(560, sc.width) : 560;
  const deskX = m.side ? m.side.right + 8 : 0;
  check(`${T}: ${name} — шит ${Math.round(want)} (≤ 560) по центру области контента, правее сайдбара, в окне`, !!sc && !!sh && near(sh.width, want, 1) && near(mid(sh), mid(sc), 1.5) && near(sc.left, deskX, 1) && sh.left >= deskX - 0.5 && sh.right <= m.vw + 0.5 && sh.bottom <= m.vh + 0.5 && sh.top >= -0.5, { sheet: box(sh), scrim: box(sc) });
}

async function runParty(browser, BR, NEW) {
  for (const [label, w, h, z] of MATRIX)
    for (const scheme of ["light", "dark"]) {
      const T = `${BR} party ${label} ${scheme} (${w}x${h})`;
      const full = isFull(w, h);
      const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
      const m = await party(p);
      partyChecks(T, m, { full });
      check(`${T}: панель 1–9 и действия — в инспекторе`, m.pad && m.actions && m.pad.left >= m.insp.left && m.pad.right <= m.insp.right + 0.5 && m.actions.left >= m.insp.left && m.actions.bottom <= m.vh + 0.5, { pad: box(m.pad), actions: box(m.actions) });
      // Решённый Today — часть матрицы (решение — 51 ход): 1280×800@100, 1440×900@125, 1920×1080@100, 1920×1080@150, оба компакта.
      const solve = ["1280x800@100", "1440x900@125", "1920x1080@100", "1920x1080@150", "compact 1024x640", "compact 960x600"].includes(label) && (scheme === "light") === !["1920x1080@100", "compact 960x600"].includes(label);
      if (solve) {
        const board0 = m.board;
        await solveToday(p);
        const s = await party(p);
        check(`${T} solved: Today остаётся партией — .today:not(.play-fit) (колонка 640 PD-269) нет`, s.todayNotFit === 0 && /play-fit/.test(s.playClass) && s.inspSolved, { notFit: s.todayNotFit, play: s.playClass });
        check(`${T} solved: поле того же размера на месте, область без полей`, near(s.board.width, board0.width, 0.5) && near(s.board.left, board0.left, 0.5) && near(s.board.top, board0.top, 0.5) && s.kids.every((k) => k.ml === "0px" && k.mr === "0px"), { board0: box(board0), board1: box(s.board) });
        check(`${T} solved: карточка — в инспекторе во всю его ширину (− 24), без полей колонки`, !!s.card && s.cardMargin.every((x) => x === "0px") && near(s.card.width, s.inspClientW - 24, 1) && s.card.left >= s.insp.left, { card: box(s.card), insp: box(s.insp), margin: s.cardMargin });
        check(`${T} solved: Grid ∞ — в инспекторе`, !!s.grid && s.grid.left >= s.insp.left && s.grid.right <= s.insp.right + 0.5, { grid: box(s.grid) });
        await p.screenshot({ path: path.join(OUT, `${BR}-party-${label.replace(" ", "-")}-${scheme}-solved.png`) });
        // Watch → Timelapse: шит ≤ 560 по центру области (п. 2).
        const watch = p.locator(`${P} .desk-insp .card .tl-watch`);
        if (await watch.count()) {
          await watch.click();
          await settle(p, 700);
          await sheetCheck(p, `${T} solved`, "Timelapse", ".desk-layer .tl-sheet", ".desk-layer .tl-root", s);
          await p.keyboard.press("Escape");
          await settle(p, 500);
        } else check(`${T} solved: Timelapse — есть кнопка Watch`, false, {});
      }
      check(`${T}: без ошибок JS`, errs.length === 0, { errs });
      await ctx.close();
    }
}

// ---------- оверлеи: шиты 560, меню 320 ----------
async function runOverlays(browser, BR, NEW) {
  for (const [label, w, h, z] of MATRIX)
    for (const scheme of z === 100 || label.startsWith("compact") ? ["light", "dark"] : ["light"]) {
      const T = `${BR} overlays ${label} ${scheme} (${w}x${h})`;
      const full = isFull(w, h);
      const compact = !full;
      const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
      const m = await party(p);
      const shot = (name) => (label === "1920x1080@100" || label === "compact 1024x640") && p.screenshot({ path: path.join(OUT, `${BR}-overlays-${label.replace(" ", "-")}-${scheme}-${name}.png`) });
      // 1. Лампочка → шит правила подсказки.
      await p.locator(`${P} [data-testid="hint-button"]`).click();
      await settle(p);
      await sheetCheck(p, T, "правило подсказки", ".desk-layer [data-testid='hint-rule-scrim'] .ink-sheet", ".desk-layer [data-testid='hint-rule-scrim']", m);
      await shot("hint-rule");
      await p.keyboard.press("Escape");
      await settle(p);
      // 2. Правый клик по Notes → шит Fill (ActionSheet).
      await p.locator(`${P} .desk-insp .act[aria-keyshortcuts="N"]`).click({ button: "right" });
      await settle(p);
      await sheetCheck(p, T, "Fill (действия)", ".desk-layer [data-testid='action-sheet']", ".desk-layer [data-testid='action-sheet-scrim']", m);
      await shot("fill");
      await p.keyboard.press("Escape");
      await settle(p);
      // 3. Year → месяц → шит месяца.
      await side(p, "side-year", compact);
      await settle(p);
      await p.locator(`${P} .year-month`).nth(9).click();
      await settle(p, 700);
      await sheetCheck(p, T, "месяц Year", ".desk-layer [data-testid='year-sheet']", ".desk-layer .ysheet-scrim", m);
      await shot("year-sheet");
      await p.keyboard.press("Escape");
      await settle(p, 600);
      // 4. Хаб → правый клик по строке режима → контекстное меню у строки, ≤ 320.
      await side(p, "side-play", compact);
      await settle(p);
      const row = await rect(p, `${P} [data-testid="mode-classic"]`);
      await p.locator(`${P} [data-testid="mode-classic"]`).click({ button: "right" });
      await settle(p);
      const ctxM = await rect(p, ".desk-layer [data-testid='ctx-menu']");
      const ctxScrim = await rect(p, ".desk-layer [data-testid='ctx-scrim']");
      // «Поднятая» копия строки — ровно на строке (размытое затемнение — containing block fixed-потомков: без поправки
      // portalHost.fixedOrigin копия и меню уезжали вправо на ширину сайдбара, найдено прогоном PD-290).
      const ctxLift = await rect(p, ".desk-layer [data-testid='ctx-scrim'] .ctx-lift");
      check(`${T}: копия строки режима над затемнением — ровно на строке`, !!ctxLift && near(ctxLift.left, row.left, 1) && near(ctxLift.top, row.top, 1) && near(ctxLift.width, row.width, 1), { lift: box(ctxLift), row: box(row) });
      const wantCtx = Math.min(320, m.vw - (ctxScrim?.left ?? 0) - 20);
      check(`${T}: контекстное меню строки режима — ${Math.round(wantCtx)} (≤ 320), левой кромкой по строке, под/над ней, в области`, !!ctxM && near(ctxM.width, wantCtx, 1) && near(ctxM.left, Math.max(ctxScrim.left + 10, Math.min(row.left, m.vw - 10 - ctxM.width)), 1) && (ctxM.top >= row.bottom - 0.5 || ctxM.bottom <= row.top + 0.5) && ctxM.left >= ctxScrim.left + 9.5 && ctxM.right <= m.vw - 9.5 && ctxM.bottom <= m.vh + 0.5, { menu: box(ctxM), row: box(row), scrim: box(ctxScrim) });
      await shot("ctx-menu");
      await p.keyboard.press("Escape");
      await settle(p);
      // 5. Страница режима → Start → партия Play → «⋯» (меню ≤ 320 под кнопкой) → «Новая сетка» → шит режима.
      await side(p, "side-mode-classic", compact);
      await settle(p);
      await p.locator(`${P} [data-testid="mode-page-start"]`).click();
      await p.waitForSelector(`${P} .desk-play .board button.cell`, { timeout: 40000 });
      await settle(p, 600);
      const more = await rect(p, `${P} [data-testid="more-button"]`);
      await p.locator(`${P} [data-testid="more-button"]`).click();
      await settle(p);
      const menu = await rect(p, ".desk-layer [data-testid='more-menu']");
      check(`${T}: меню «⋯» — ≤ 320, под кнопкой, правым краем по ней, в окне`, !!menu && menu.width <= 320.5 && menu.width >= 229.5 && near(menu.right, more.right, 2) && menu.top >= more.bottom && menu.bottom <= m.vh + 0.5, { menu: box(menu), more: box(more) });
      await shot("more-menu");
      await p.locator(".desk-layer [data-testid='menu-new']").click();
      await settle(p);
      await sheetCheck(p, T, "шит режима", ".desk-layer [data-testid='mode-sheet']", ".desk-layer [data-testid='mode-sheet-scrim']", m);
      await shot("mode-sheet");
      await p.keyboard.press("Escape");
      await settle(p);
      // 6. Лжец: правый клик по подсказке → меню «Обвинить» у клетки, ≤ 320.
      await side(p, "side-mode-liar", compact);
      await settle(p);
      const startBtn = p.locator(`${P} [data-testid="mode-page-start"]`);
      if (await startBtn.count()) await startBtn.click();
      await p.waitForSelector(`${P} .desk-play .board button.cell`, { timeout: 40000 });
      await settle(p, 600);
      const given = p.locator(`${P} .board button.cell:has(.d.given)`).nth(12);
      const cell = await given.boundingBox();
      await given.click({ button: "right" });
      await settle(p);
      const acc = await rect(p, ".desk-layer [data-testid='accuse-menu']");
      const accScrim = await rect(p, ".desk-layer [data-testid='accuse-scrim']");
      const accLift = await rect(p, ".desk-layer [data-testid='accuse-scrim'] .liar-lift");
      if (cell) check(`${T}: копия клетки Лжеца над затемнением — ровно на клетке`, !!accLift && near(accLift.left, cell.x, 1) && near(accLift.top, cell.y, 1) && near(accLift.width, cell.width, 1), { lift: box(accLift), cell: [Math.round(cell.x), Math.round(cell.y), Math.round(cell.width)] });
      if (acc && cell) {
        const wantAcc = Math.min(320, m.vw - accScrim.left - 20);
        check(`${T}: меню «Обвинить» Лжеца — ${Math.round(wantAcc)} (≤ 320), у клетки (левой кромкой по ней), под/над ней, в области`, near(acc.width, wantAcc, 1) && near(acc.left, Math.max(accScrim.left + 10, Math.min(cell.x, m.vw - 10 - acc.width)), 1) && (acc.top >= cell.y + cell.height - 0.5 || acc.bottom <= cell.y + 0.5) && acc.right <= m.vw - 9.5 && acc.bottom <= m.vh + 0.5, { menu: box(acc), cell: [Math.round(cell.x), Math.round(cell.y), Math.round(cell.width)] });
        await shot("accuse");
        await p.keyboard.press("Escape");
      } else check(`${T}: меню «Обвинить» Лжеца открылось`, false, { acc: !!acc, cell: !!cell });
      check(`${T}: без ошибок JS`, errs.length === 0, { errs });
      await ctx.close();
    }
}

// ---------- экраны (компакт): колонки, обрезка, Tab ----------
async function screen(p) {
  return p.evaluate(() => {
    const R = (el) => (el ? (({ left, top, width, height, right, bottom }) => ({ left, top, width, height, right, bottom }))(el.getBoundingClientRect()) : null);
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && !el.hidden && el.getBoundingClientRect().width > 0;
    const layer = document.querySelector(".push-layer") ?? document.querySelector(".tab-pane:not(.off)");
    const sr = layer.getBoundingClientRect();
    const area = { left: sr.left + layer.clientLeft, width: layer.clientWidth };
    area.right = area.left + area.width;
    const all = (sel) => [...layer.querySelectorAll(sel)].filter(vis).map(R);
    const union = (rs) => (rs.length ? { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), width: Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left)) } : null);
    // Вылезает за область по горизонтали / обрезано (overflow ≠ visible, содержимое шире) — кроме sr-only и прокручиваемых.
    const out = [];
    const clipped = [];
    for (const el of layer.querySelectorAll("*")) {
      if (!vis(el) || el.closest(".sr-only") || el.matches("svg *")) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "absolute" && el.closest(".srow")) continue; // слой «Удалить» под строкой (свайп) — за кадром намеренно
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.left < area.left - 0.5 || r.right > area.right + 0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(r.left)}…${Math.round(r.right)}]`);
      const ox = cs.overflowX;
      if ((ox === "hidden" || ox === "clip") && el.scrollWidth > el.clientWidth + 1 && !el.matches(".scroll, .tab-pane, .push-layer, .stack")) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) clipped.push(`ellipsis ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
    }
    const head = layer.querySelector(".toolbar, .settings-navbar");
    const tg = head?.querySelector(".side-toggle");
    const title = head?.querySelector(".title, .settings-back");
    const gear = head?.querySelector('[data-testid="open-settings"]');
    return {
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      shell: document.querySelector(".shell")?.className,
      side: vis(document.querySelector(".sidebar")) ? R(document.querySelector(".sidebar")) : null,
      area,
      hubCards: all(".hub-scroll > .hub-sec .hub-card"),
      modePage: R(layer.querySelector(".mode-page")),
      settingsCards: all(".settings > .settings-sec .settings-card"),
      year: union(all(".year-months > .year-month")),
      toggle: vis(tg) ? R(tg) : null,
      title: vis(title) ? R(title) : null,
      gear: vis(gear) ? R(gear) : null,
      out: out.slice(0, 8),
      outN: out.length,
      clipped: clipped.slice(0, 8),
      clippedN: clipped.length,
    };
  });
}
function colOk(c, m, want) {
  return !!c && near(c.width, want) && near(mid(c), mid(m.area), 1.5) && (!m.side || c.left >= m.side.right - 0.5) && c.right <= m.vw + 0.5;
}

/** Нажимать Tab, пока фокус не вернётся к первому; для каждого — видимое кольцо, не срезанное предками и окном (как pd269-check). */
async function tabWalk(p, max = 70, key = "Tab") {
  await p.evaluate(() => {
    document.activeElement?.blur?.();
    window.__seen = new Set();
  });
  const out = [];
  for (let i = 0; i < max; i++) {
    await p.keyboard.press(key);
    await p.waitForTimeout(60);
    const r = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { none: true };
      const id = el.dataset.testid || el.getAttribute("aria-label") || el.className || el.tagName;
      if (window.__seen.has(el)) return { repeat: true, id };
      window.__seen.add(el);
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const alpha = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return c === "transparent" ? 0 : 1;
        const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return v.length > 3 ? v[3] : 1;
      };
      const ow = parseFloat(cs.outlineWidth) || 0;
      const outline = cs.outlineStyle !== "none" && ow > 0 && alpha(cs.outlineColor) > 0;
      const inset = /inset/.test(cs.boxShadow) && cs.boxShadow !== "none" && alpha(cs.boxShadow) > 0;
      const cellRing = el.matches(".cell") && !!el.closest(".board")?.querySelector(".ring");
      let ring = null;
      if (outline) {
        const d = (parseFloat(cs.outlineOffset) || 0) + ow;
        ring = { left: rect.left - d, top: rect.top - d, right: rect.right + d, bottom: rect.bottom + d };
      } else if (inset || cellRing) ring = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const clips = [];
      if (ring) {
        for (let a = el.parentElement; a; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX !== "visible" || s.overflowY !== "visible") {
            const ar = a.getBoundingClientRect();
            const c = { left: ar.left + a.clientLeft, top: ar.top + a.clientTop };
            c.right = c.left + a.clientWidth;
            c.bottom = c.top + a.clientHeight;
            if (ring.left < c.left - 0.5 || ring.top < c.top - 0.5 || ring.right > c.right + 0.5 || ring.bottom > c.bottom + 0.5) clips.push(a.className || a.tagName);
          }
        }
        if (ring.left < -0.5 || ring.top < -0.5 || ring.right > innerWidth + 0.5 || ring.bottom > innerHeight + 0.5) clips.push("viewport");
      }
      return { id: String(id).slice(0, 60), visible: !!ring, kind: outline ? "outline" : inset ? "inset" : cellRing ? "cell-ring" : "none", clips };
    });
    if (r.none) continue;
    if (r.repeat) break;
    out.push(r);
  }
  return out;
}

async function runScreens(browser, BR, NEW) {
  const SIZES = [
    ["compact 1024x640", 1024, 640, 125],
    ["compact 960x600", 960, 600, 150],
    ["compact 853x533", 853, 533, 150],
    ["1280x800@100", 1280, 800, 100],
    ["1920x1080@100", 1920, 1080, 100],
  ];
  for (const [label, w, h, z] of SIZES)
    for (const scheme of ["light", "dark"]) {
      const T = `${BR} screens ${label} ${scheme} (${w}x${h})`;
      const full = isFull(w, h);
      const compact = !full;
      const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
      const shot = (name) => scheme === "light" && p.screenshot({ path: path.join(OUT, `${BR}-screens-${label.replace(" ", "-")}-${name}.png`) });
      const tab = async (name) => {
        if (scheme !== "light") return;
        const list = await tabWalk(p, 80, BR === "wk" ? "Alt+Tab" : "Tab");
        const bad = list.filter((x) => !x.visible || x.clips.length);
        // Справка на компакте — две остановки («назад» и ссылка), сайдбара в порядке Tab нет; остальные экраны — от трёх.
        const min = compact && name === "help" ? 2 : 3;
        check(`${T} ${name}: Tab — у каждого фокуса видимое кольцо, не срезано (${list.length} шт.)`, list.length >= min && bad.length === 0, { n: list.length, ids: name === "help" || list.length < min ? list.map((x) => x.id) : undefined, bad: bad.slice(0, 6) });
      };
      const common = (name, m) => {
        check(`${T} ${name}: раскладка ${compact ? "компакт C" : "с сайдбаром"}; нет горизонтальной прокрутки`, (compact ? /^shell desk compact/.test(m.shell) && !m.side : /^shell desk/.test(m.shell) && !!m.side) && m.scrollW <= m.vw, { shell: m.shell, scrollW: m.scrollW });
        check(`${T} ${name}: ничего не вылезает за область и не обрезано`, m.outN === 0 && m.clippedN === 0, { out: m.out, clipped: m.clipped });
        check(`${T} ${name}: шапка — кнопка сайдбара, заголовок, шестерёнка не наезжают`, !!m.toggle && !!m.title && m.toggle.right <= m.title.left + 0.5 && (!m.gear || m.title.right <= m.gear.left + 0.5) && m.toggle.left >= (m.side ? m.side.right : 0), { toggle: box(m.toggle), title: box(m.title), gear: box(m.gear) });
      };
      // Партия Today на компакте — Tab по тулбару, полю и инспектору.
      if (compact) await tab("today party");
      // Хаб.
      await side(p, "side-play", compact);
      await settle(p);
      let m = await screen(p);
      const read = Math.min(640, m.area.width - 32);
      common("hub", m);
      check(`${T} hub: карточки = ${read} по центру`, m.hubCards.length >= 1 && m.hubCards.every((c) => colOk(c, m, read)), { cards: m.hubCards.map(box), area: [Math.round(m.area.left), Math.round(m.area.width)] });
      await shot("hub");
      await tab("hub");
      // Страница режима.
      await side(p, "side-mode-liar", compact);
      await settle(p);
      m = await screen(p);
      common("mode page", m);
      check(`${T} mode page: колонка ${Math.min(480, m.area.width - 32)} (≤ 480) по центру`, colOk(m.modePage, m, Math.min(480, m.area.width - 32)), { page: box(m.modePage) });
      await shot("mode-page");
      await tab("mode page");
      // Year.
      await side(p, "side-year", compact);
      await settle(p);
      m = await screen(p);
      const yw = Math.min(780, m.area.width - 32);
      common("year", m);
      check(`${T} year: полотно = ${yw} по центру`, colOk(m.year, m, yw), { year: box(m.year) });
      await shot("year");
      await tab("year");
      // Settings.
      await p.locator(`${P} [data-testid="open-settings"]`).click();
      await settle(p, 600);
      m = await screen(p);
      common("settings", m);
      check(`${T} settings: карточки = ${read} по центру`, m.settingsCards.length >= 4 && m.settingsCards.every((c) => colOk(c, m, read)), { n: m.settingsCards.length, first: box(m.settingsCards[0]) });
      await shot("settings");
      await tab("settings");
      // Справка.
      await p.locator('.push-layer [data-testid="open-help"]').click();
      await settle(p, 700);
      m = await screen(p);
      common("help", m);
      check(`${T} help: карточки = ${read} по центру`, m.settingsCards.length >= 4 && m.settingsCards.every((c) => colOk(c, m, read)), { n: m.settingsCards.length, first: box(m.settingsCards[0]) });
      await shot("help");
      await tab("help");
      check(`${T}: без ошибок JS`, errs.length === 0, { errs });
      await ctx.close();
    }
}

// ---------- фокус: «Start ↩» и инспектор ----------
const focusState = (p) =>
  p.evaluate(() => {
    const el = document.activeElement;
    const b = document.querySelector('.tab-pane:not(.off) [data-testid="mode-page-start"]');
    const k = b?.querySelector(".mp-key");
    const br = b?.getBoundingClientRect();
    const kr = k?.getBoundingClientRect();
    return {
      active: el === document.body ? "body" : (el?.dataset?.testid ?? el?.className ?? el?.tagName),
      onStart: !!b && el === b,
      fv: !!b && el === b && b.matches(":focus-visible"),
      chip: k?.textContent ?? null,
      chipIn: !!(br && kr && kr.left >= br.left && kr.right <= br.right && kr.top >= br.top && kr.bottom <= br.bottom),
      page: !!document.querySelector('.tab-pane:not(.off) [data-testid="mode-page"]'),
      sideShown: (() => { const s = document.querySelector(".sidebar"); return !!s && !s.hidden && getComputedStyle(s).display !== "none"; })(),
    };
  });
/** Сколько цифр игрока стоит на поле Today (вкладка Today — первая панель, в том числе когда она скрыта). */
const todayPlaced = (p) => p.evaluate(() => document.querySelectorAll('.tab-pane:first-child .board .d.player').length);
const todaySel = (p) => p.evaluate(() => document.querySelector(".tab-pane:first-child .board button.cell.sel")?.dataset.i ?? null);
const playPlaced = (p) => p.evaluate(() => document.querySelectorAll(".tab-pane:not(.off) .desk-play .board .d.player").length);

async function runFocus(browser, BR, NEW) {
  for (const [label, w, h, z] of [["1440x900@100", 1440, 900, 100], ["compact 1024x640", 1024, 640, 125]]) {
    const T = `${BR} focus ${label} (${w}x${h})`;
    const compact = !isFull(w, h);
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, base: NEW });
    // Выбранная клетка Today с цифрой: на странице режима клавиши в Today не попадают.
    await p.locator(`${P} .board button.cell[data-i="2"]`).click();
    await p.keyboard.press("Digit4");
    await settle(p, 250);
    const placed0 = await todayPlaced(p);
    const sel0 = await todaySel(p);
    // Режим из сайдбара (на компакте — кнопкой «Show sidebar» поверх контента).
    await side(p, "side-mode-classic", compact);
    await settle(p);
    let f = await focusState(p);
    check(`${T}: страница режима — фокус на «Start», чип ↩ внутри кнопки${compact ? ", сайдбар ушёл" : ""}`, f.page && f.onStart && f.chip === "↩" && f.chipIn && (!compact || !f.sideShown), f);
    await p.screenshot({ path: path.join(OUT, `${BR}-focus-${label.replace(" ", "-")}-mode-page.png`) });
    // Цифры и стирание на странице режима — не в Today. WebKit Playwright (MiniBrowser) на Backspace вне поля ввода уходит
    // назад по истории (Safari с 13-й версии так не делает) — там стирание клавишей Delete (та же команда «стереть», logic.ts).
    await p.keyboard.press("Digit7");
    await p.keyboard.press(BR === "wk" ? "Delete" : "Backspace");
    await settle(p, 200);
    check(`${T}: клавиши на странице режима не доходят до партии Today`, (await todayPlaced(p)) === placed0 && (await todaySel(p)) === sel0, { placed0, sel0 });
    // Фокус на пункте сайдбара + Enter — действие пункта (Year), а не «Start».
    if (compact) {
      await p.locator('[data-testid="sidebar-toggle"]:visible').first().click();
      await settle(p, 300);
      f = await focusState(p);
      const onItem = await p.evaluate(() => !!document.activeElement?.closest(".sidebar"));
      await p.keyboard.press("ArrowDown");
      await p.keyboard.press("Enter");
      await settle(p);
      const after = await focusState(p);
      const cells = await p.evaluate(() => document.querySelectorAll(".tab-pane:not(.off) .desk-play .board button.cell").length);
      check(`${T}: сайдбар поверх страницы режима — фокус на пункте, Enter нажимает пункт, партия не запускается`, f.sideShown && onItem && cells === 0 && !after.sideShown, { onItem, cells, after });
      await side(p, "side-mode-classic", compact);
      await settle(p);
    } else {
      await p.locator('[data-testid="side-year"]').focus();
      await p.keyboard.press("Enter");
      await settle(p);
      const hash = await p.evaluate(() => location.hash);
      const cells = await p.evaluate(() => document.querySelectorAll(".tab-pane:not(.off) .desk-play .board button.cell").length);
      check(`${T}: фокус на пункте сайдбара (Year) + Enter — Year, а не «Start»`, hash === "#/year" && cells === 0, { hash, cells });
      await side(p, "side-mode-classic", compact);
      await settle(p);
    }
    f = await focusState(p);
    check(`${T}: снова страница режима — фокус на «Start»`, f.page && f.onStart, f);
    // Enter — партия Play в раскладке C (инспектор), клетка Today не тронута.
    await p.keyboard.press("Enter");
    await p.waitForSelector(`${P} .desk-play .board button.cell`, { timeout: 40000 }).catch(() => null);
    await settle(p, 700);
    const started = await p.evaluate(() => ({
      cells: document.querySelectorAll(".tab-pane:not(.off) .desk-play .board button.cell").length,
      insp: !!document.querySelector(".tab-pane:not(.off) .desk-play > .desk-insp .pad"),
      page: !!document.querySelector('.tab-pane:not(.off) [data-testid="mode-page"]'),
      active: document.activeElement === document.body ? "body" : document.activeElement?.className,
      inPane: !!document.activeElement?.closest(".tab-pane:not(.off)") || document.activeElement === document.body,
    }));
    check(`${T}: Enter — партия Classic в раскладке C (поле + инспектор), фокус не в скрытой панели`, started.cells === 81 && started.insp && !started.page && started.inPane, started);
    check(`${T}: партия Today не тронута (цифр ${placed0}, выбор ${sel0})`, (await todayPlaced(p)) === placed0 && (await todaySel(p)) === sel0, {});
    // Клавиши — в новую партию: стрелка выбирает клетку, цифра встаёт в пустую.
    const before = await playPlaced(p);
    const empty = await p.evaluate(() => [...document.querySelectorAll(".tab-pane:not(.off) .desk-play .board button.cell")].find((c) => !c.querySelector(".d"))?.dataset.i ?? null);
    await p.locator(`${P} .desk-play .board button.cell[data-i="${empty}"]`).click();
    await p.keyboard.press("Digit5");
    await settle(p, 250);
    const after1 = await playPlaced(p);
    check(`${T}: цифра с клавиатуры — в партии Play (${before} → ${after1})`, after1 === before + 1, { empty });
    // Enter в партии ничего не запускает заново (страница режима ушла, её обработчика нет).
    await p.keyboard.press("Enter");
    await settle(p, 500);
    const after2 = await playPlaced(p);
    const still = await p.evaluate(() => document.querySelectorAll(".tab-pane:not(.off) .desk-play .board button.cell").length);
    check(`${T}: Enter в партии — партия та же (цифр ${after2}), новой не началось`, after2 === after1 && still === 81, { after2, still });
    // Tab по партии (тулбар, поле, инспектор) — кольца видимы и не срезаны.
    const list = await tabWalk(p, 120, BR === "wk" ? "Alt+Tab" : "Tab");
    const bad = list.filter((x) => !x.visible || x.clips.length);
    check(`${T}: Tab по партии Play — у каждого фокуса видимое кольцо, не срезано (${list.length} шт.)`, list.length >= 5 && bad.length === 0, { n: list.length, bad: bad.slice(0, 6) });
    check(`${T}: без ошибок JS`, errs.length === 0, { errs });
    await ctx.close();
  }
}

// ---------- телефон = main ----------
const domSig = (p) =>
  p.evaluate(() => {
    const walk = (el) => {
      const a = [...el.attributes].filter((x) => x.name === "class" || x.name === "role" || x.name.startsWith("aria-") || x.name === "data-testid").map((x) => `${x.name}=${x.value}`).sort().join(" ");
      return `<${el.tagName.toLowerCase()} ${a}>${[...el.children].map(walk).join("")}`;
    };
    return walk(document.body) + `|html.class=${document.documentElement.className}`;
  });

async function pixDiff(browser) {
  const cmp = await browser.newPage();
  const diff = (a, b) =>
    cmp.evaluate(
      async ([a, b]) => {
        const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + s; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return -1;
        const px = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
        const da = px(ia), db = px(ib);
        let n = 0;
        for (let k = 0; k < da.length; k += 4) if (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2]) n++;
        return n;
      },
      [a.toString("base64"), b.toString("base64")],
    );
  return { diff, close: () => cmp.close() };
}
async function stableShot(p) {
  let prev = null;
  for (let i = 0; i < 5; i++) {
    const buf = await p.screenshot({ mask: [p.locator(".subline .clock")], maskColor: "#f0f" });
    if (prev && buf.equals(prev)) return buf;
    prev = buf;
    await p.waitForTimeout(300);
  }
  return prev;
}

async function runPhone(browser, BR, NEW, OLD) {
  const { diff, close } = await pixDiff(browser);
  for (const [w, h, scheme] of [[393, 852, "light"], [393, 852, "dark"], [320, 568, "light"], [852, 393, "light"]]) {
    const capture = async (base) => {
      const pics = {};
      const doms = {};
      const { ctx, p } = await open(browser, { w, h, dpr: 3, scheme, base, touch: true });
      const take = async (screen) => {
        await p.waitForTimeout(500);
        pics[screen] = await stableShot(p);
        doms[screen] = await domSig(p);
      };
      await take("today");
      await p.locator("#tab-play").click();
      await take("hub");
      // Контекстное меню строки режима (PD-290 трогал его позиционирование — на телефоне оно прежнее, во всю ширину).
      await p.locator(`${P} [data-testid="mode-classic"]`).click({ button: "right" });
      await take("ctx-menu");
      await p.keyboard.press("Escape");
      await p.waitForTimeout(400);
      await p.locator(`${P} [data-testid="mode-classic"]`).click();
      await take("mode-sheet");
      await p.locator('[data-testid="sheet-start"]').click();
      await p.waitForSelector(`${P} .board button.cell`, { timeout: 40000 });
      await take("play");
      await p.locator("#tab-year").click();
      await take("year");
      await p.locator(`${P} [data-testid="open-settings"]`).click();
      await take("settings");
      await ctx.close();
      return { pics, doms };
    };
    const base = await capture(OLD);
    const neu = await capture(NEW);
    for (const screen of Object.keys(base.pics)) {
      let n = await diff(base.pics[screen], neu.pics[screen]);
      let tries = 1;
      while (n !== 0 && tries < 3) {
        tries++;
        const b2 = await capture(OLD);
        const n2 = await capture(NEW);
        base.pics[screen] = b2.pics[screen];
        neu.pics[screen] = n2.pics[screen];
        n = await diff(base.pics[screen], neu.pics[screen]);
      }
      if (n !== 0 || (w === 393 && scheme === "light")) for (const [k, v] of [["base", base], ["new", neu]]) fs.writeFileSync(path.join(OUT, `${BR}-phone-${w}x${h}-${scheme}-${screen}-${k}.png`), v.pics[screen]);
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: кадр = main`, n === 0, { diffPx: n, tries });
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: DOM = main`, base.doms[screen] === neu.doms[screen], { len: neu.doms[screen].length });
    }
  }
  await close();
}

const servers = [];
let browser = null;
try {
  servers.push(await serve(DIST, PORT));
  const NEW = `http://127.0.0.1:${PORT}`;
  let OLD = null;
  if (which.includes("phone")) {
    if (!BASE_DIST) throw new Error("phone: нужен BASE_DIST (сборка main)");
    servers.push(await serve(BASE_DIST, PORT + 1));
    OLD = `http://127.0.0.1:${PORT + 1}`;
  }
  for (const name of browsers) {
    try {
      browser = await pw[name].launch();
    } catch (e) {
      console.log(`SKIP ${name}: нет в установке Playwright (${String(e.message).split("\n")[0]})`);
      results[`${name}: skipped`] = { ok: true, skipped: true };
      continue;
    }
    const BR = SHORT[name];
    // Тяжёлые прогоны по одному: браузер за браузером, часть за частью.
    if (which.includes("party")) await runParty(browser, BR, NEW);
    if (which.includes("overlays")) await runOverlays(browser, BR, NEW);
    if (which.includes("screens")) await runScreens(browser, BR, NEW);
    if (which.includes("focus")) await runFocus(browser, BR, NEW);
    if (which.includes("phone")) await runPhone(browser, BR, NEW, OLD);
    await browser.close();
    browser = null;
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const s of servers) await new Promise((ok) => s.close(ok));
}

fs.writeFileSync(path.join(OUT, `results-${which.join("-")}-${browsers.map((b) => SHORT[b]).join("-")}.json`), JSON.stringify({ total: Object.keys(results).length, fails }, null, 1));
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} PASS${fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : ""}`);
process.exitCode = fails.length ? 1 : 0;
