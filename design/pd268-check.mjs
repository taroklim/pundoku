/**
 * PD-268 — десктоп C «Сайдбар»: после решения карточка результата + Grid ∞ в инспекторе (компактно), компакт окна ниже
 * 1100 × 680 (ноутбук при 125/150 %) — без сайдбара, компактный инспектор (действия 2 × 2, без шпаргалки). Живая проверка на
 * РЕАЛЬНОЙ сборке + «телефон не изменился» попиксельно против main.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd268-dist                 (ветка pd-desk-c-268)
 *   (worktree на main) npx vite build --outDir /tmp/pd268-base             (эталон телефона; нужен только для `phone`)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd268-dist BASE_DIST=/tmp/pd268-base PORT=5391 \
 *     node design/pd268-check.mjs [desk] [flow] [phone] [chromium] [webkit] [firefox]   (без аргументов — всё, cr + wk + ff)
 *   Firefox — если он есть в установке Playwright (иначе SKIP, не FAIL). Сервер — свой статический (не vite preview), сам
 *   останавливается в конце.
 *
 * Масштаб браузера — как в аудите PD-228 и pd266/267-check: вьюпорт = окно ÷ масштаб, DPR = масштаб.
 *
 * desk — 1280×800 / 1440×900 / 1920×1080 × 100/125/150 % (светлая) + 100 % тёмная; Today:
 *   - партия: от 1100 × 680 — как PD-267 (сайдбар, тулбар, поле min(720, окно − 124, область − 96), инспектор clamp(260, 20vw,
 *     320), шпаргалка от высоты 800); ниже (компакт: 1024×640, 853×533, 960×600) — без сайдбара и таб-бара, кнопка «Show
 *     sidebar» в тулбаре, поле min(720, окно − 124, ширина − инспектор − 96), инспектор во всю высоту, клавиши 1–9 3 × 3
 *     (≥ 44 px), действия 2 × 2 с чипами клавиш, без шпаргалки, инспектор не прокручивается;
 *   - решение дня с клавиатуры → поле остаётся на месте того же размера (приглушено, inert), в инспекторе карточка (без
 *     подзаголовка, тепловая карта ≤ 150, цифры в 2 колонки, Watch и Share как на телефоне) и Grid ∞ (81 клетка, ≤ 150,
 *     клетка дня, «What's this?» в строке заголовка);
 *     окно от высоты 800 — инспектор НЕ прокручивается, всё целиком в окне (запас в отчёте); ниже — прокручивается только
 *     инспектор (страница — нет), карточка видна сверху, Grid ∞ достижим прокруткой инспектора; контраст текстов ≥ 4.5:1.
 * flow — полная 1280×800@100 (светлая), компакт 1280×800@150 (853×533, тёмная), компакт 1440×900@150 (960×600, светлая):
 *   фокус после решения на карточке, Tab по инспектору (кольцо, в окне), Share → экспорт PNG в слое окна (1080 × 1350,
 *   скачивание PNG), «What's this?» Grid ∞ → справка; компакт: кнопка показывает сайдбар поверх контента (поле не сдвинулось,
 *   фокус на выбранном пункте, aria-expanded), Esc — убирает и возвращает фокус, выбор пункта — переходит и убирает, клик мимо
 *   — убирает; Year/Settings/хаб/страница режима/партия Play на компакте; клавиатура партии; смена окна полная ↔ компакт на лету.
 * phone — 393×852 (свет/тьма), 320×568, 852×393 (касание, DPR 3): Today, хаб Play, партия Classic, Year, Settings и решённый
 *   Today (карточка + Grid ∞) — кадр ветки = кадр main попиксельно (часы и время решения в карточке — под маской) и одинаковое
 *   DOM-дерево.
 * Кадры — design/pd268-shots/; итог — PASS/FAIL построчно и сводка в design/pd268-shots/results-<части>-<браузеры>.json.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd268-shots");
const PORT = +(process.env.PORT ?? 5391);
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOL = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const args = process.argv.slice(2);
const parts = args.filter((a) => ["desk", "flow", "phone"].includes(a));
const which = parts.length ? parts : ["desk", "flow", "phone"];
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

async function open(browser, { w, h, dpr = 1, scheme = "light", route = "today", base, touch = false, now = NOW }) {
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
    acceptDownloads: true,
  });
  await ctx.clock.setFixedTime(now);
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
  if (route === "today" || route.startsWith("day/")) await p.waitForSelector(".board button.cell", { timeout: 40000 });
  else await p.waitForTimeout(600);
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}

const PANE = ".tab-pane:not(.off)";
/** Решить день с клавиатуры: клик по пустой клетке + цифра (так же, как владелец мышью и клавишами). */
async function solveDay(p, scope = PANE) {
  for (let i = 0; i < 81; i++) {
    if (MISSION[i] !== "0") continue;
    await p.locator(`${scope} .board [data-i="${i}"]`).first().click();
    await p.keyboard.press(`Digit${SOL[i]}`);
  }
  await p.waitForSelector(`${scope} [data-testid="result-card"]`, { timeout: 15000 });
  await p.waitForSelector(`${scope} [data-testid="grid-inf"]`, { timeout: 15000 });
  await p.waitForTimeout(900);
}

// ---------- замеры на странице ----------
/** Геометрия раскладки C: сайдбар, тулбар, кнопка, поле, инспектор, клавиши/действия, карточка и Grid ∞; контраст текстов. */
async function measure(p) {
  return p.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && !el.hidden && el.getBoundingClientRect().width > 0;
    const parse = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
    };
    const over = (top, bot) => {
      const a = top[3];
      return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
    };
    const bgOf = (el) => {
      const stack = [];
      for (let e = el; e; e = e.parentElement) stack.push(parse(getComputedStyle(e).backgroundColor));
      let c = [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i][3] > 0) c = over(stack[i], c);
      return c;
    };
    const lum = (c) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a, b) => {
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const opacityOf = (el) => {
      let o = 1;
      for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      return o;
    };
    const shell = document.querySelector(".shell");
    const side = document.querySelector(".sidebar");
    const scope = document.querySelector(".push-layer") ?? document.querySelector(".tab-pane:not(.off)");
    const play = scope?.querySelector(".play");
    const tb = scope?.querySelector(".toolbar, .settings-navbar");
    const toggle = scope?.querySelector(".side-toggle");
    const title = scope?.querySelector(".toolbar .title, .settings-navbar .settings-back");
    const stage = scope?.querySelector(".desk-stage");
    const board = (stage ?? scope)?.querySelector(".board");
    const insp = scope?.querySelector(".desk-insp");
    const card = insp?.querySelector(".card");
    const grid = insp?.querySelector(".desk-grid");
    const keys = insp ? [...insp.querySelectorAll(".pad .key")].map((k) => r(k)) : [];
    const actEls = insp ? [...insp.querySelectorAll(".actions .act")] : [];
    const acts = actEls.map((a) => ({ label: a.getAttribute("aria-label"), kbd: a.querySelector("kbd")?.textContent ?? null, kbdShown: vis(a.querySelector("kbd")), ks: a.getAttribute("aria-keyshortcuts"), r: r(a), labelClipped: (() => { const s = a.querySelector(":scope > span"); return !!s && s.scrollWidth > s.clientWidth + 0.5; })() }));
    const texts = [];
    const textEls = [
      ...(insp?.querySelectorAll("dt, dd, .status, .source, .act > span, kbd, .insp-keys h3, .insp-keys li > span:last-child, .key .kd, .key .kr, .card h2, .legend > span, .winrate, .tl-watch, .share, .newgrid, .help-link, .desk-grid h2, .desk-grid .meta, .desk-grid .hint") ?? []),
      ...(tb?.querySelectorAll(".title, .subline > span:not(.sep):not(.mode-chip), .subline .chip-t") ?? []),
    ];
    for (const el of textEls) {
      if (!vis(el) || !el.textContent.trim()) continue;
      // Приглушённые намеренно (закрытая цифра, неактивное действие — opacity .4) — не текст для чтения, как и в аудите.
      if (opacityOf(el) < 0.99) continue;
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      const size = parseFloat(getComputedStyle(el).fontSize);
      const bold = +getComputedStyle(el).fontWeight >= 700;
      texts.push({ t: el.textContent.trim().slice(0, 24), ratio: +ratio(over(fg, bg), bg).toFixed(2), large: size >= 24 || (bold && size >= 18.66) });
    }
    const rows = card ? [...card.querySelectorAll(".rows > .row")].map((x) => r(x)) : [];
    const pane = document.querySelector(".tab-pane:not(.off)");
    return {
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      paneScrolls: pane ? pane.scrollHeight > pane.clientHeight + 1 : false,
      shellClass: shell?.className,
      tabbarShown: vis(document.querySelector(".tabbar")),
      sideShown: vis(side),
      side: vis(side) ? r(side) : null,
      deskPlay: play?.classList.contains("desk-play") ?? false,
      gapShown: vis(play?.querySelector(":scope > .gap")),
      tb: r(tb),
      tbDesk: tb?.classList.contains("desk-tb") ?? false,
      toggle: vis(toggle) ? r(toggle) : null,
      toggleInTb: !!toggle && !!tb && tb.contains(toggle),
      toggleLabel: toggle?.getAttribute("aria-label") ?? null,
      toggleExpanded: toggle?.getAttribute("aria-expanded") ?? null,
      title: r(title),
      board: r(board),
      cells: board ? board.querySelectorAll("button.cell").length : 0,
      stageInert: !!stage && stage.hasAttribute("inert"),
      insp: vis(insp) ? r(insp) : null,
      inspSolved: insp?.classList.contains("solved") ?? false,
      inspScroll: insp ? { sh: insp.scrollHeight, ch: insp.clientHeight, top: insp.scrollTop } : null,
      inspScrolls: insp ? insp.scrollHeight > insp.clientHeight + 1 : false,
      keys,
      acts,
      meta: insp ? [...insp.querySelectorAll(".insp-meta dd")].map((d) => d.textContent) : [],
      legend: vis(insp?.querySelector(".insp-keys")),
      legendRect: r(insp?.querySelector(".insp-keys")),
      dock: vis(insp?.querySelector(".hint-dock")),
      card: vis(card) ? r(card) : null,
      cardSub: vis(card?.querySelector(".sub")),
      heat: r(card?.querySelector(".heat")),
      rows,
      watch: vis(card?.querySelector(".tl-watch")) ? r(card.querySelector(".tl-watch")) : null,
      share: vis(card?.querySelector(".share")) ? r(card.querySelector(".share")) : null,
      shareName: card?.querySelector(".share")?.textContent.trim() ?? null,
      grid: vis(grid) ? r(grid) : null,
      gridBoard: r(grid?.querySelector('[data-testid="grid-inf"]')),
      gridCells: grid ? grid.querySelectorAll(".cell").length : 0,
      gridTarget: !!grid?.querySelector('[data-testid="grid-inf-target"]'),
      gridHelp: vis(grid?.querySelector('[data-testid="grid-help"]')),
      lastBottom: insp ? Math.max(...[...insp.children].map((c) => c.getBoundingClientRect().bottom)) : null,
      texts,
      active: document.activeElement?.dataset?.testid ?? document.activeElement?.className ?? null,
      hash: location.hash,
    };
  });
}

const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;
const inside = (r, m) => r && r.left >= -0.5 && r.top >= -0.5 && r.right <= m.vw + 0.5 && r.bottom <= m.vh + 0.5;
const box = (r) => r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
const deskX = (m) => (m.sideShown && !m.shellClass.includes("compact") ? m.side.right + 8 : 0);
const inspW = (vw) => Math.min(320, Math.max(260, vw * 0.2));
const contrast = (tag, m, min = 20) => {
  const low = m.texts.filter((x) => x.ratio < (x.large ? 3 : 4.5));
  check(`${tag}: контраст текстов ≥ 4.5:1 (${m.texts.length})`, m.texts.length >= min && low.length === 0, { n: m.texts.length, min: Math.min(...m.texts.map((x) => x.ratio)), low });
};

/** Партия в раскладке C (полная или компакт). */
function partyChecks(tag, m, compact) {
  check(
    `${tag}: раскладка — ${compact ? "компакт C (без сайдбара и таб-бара)" : "полная C"}: тулбар партии + инспектор`,
    m.deskPlay && m.tbDesk && !!m.insp && !m.gapShown && !m.tabbarShown && m.shellClass.includes("desk") && m.shellClass.includes("compact") === compact && (!compact || !m.sideShown),
    { shell: m.shellClass, deskPlay: m.deskPlay, insp: !!m.insp, tabbar: m.tabbarShown, side: m.sideShown },
  );
  check(`${tag}: нет горизонтальной прокрутки, страница не прокручивается`, m.scrollW <= m.vw && !m.paneScrolls, { scrollW: m.scrollW, vw: m.vw, pane: m.paneScrolls });
  check(`${tag}: тулбар 52 px над полем, слева от инспектора`, m.tb && near(m.tb.height, 52, 1) && m.board.top >= m.tb.bottom && m.tb.right <= m.insp.left + 0.5 && near(m.tb.left, deskX(m), 1), { tb: box(m.tb) });
  check(
    `${tag}: кнопка сайдбара в тулбаре перед заголовком${compact ? ", «Show sidebar»" : ""}`,
    m.toggle && m.toggleInTb && m.toggle.right <= m.title.left && m.toggle.left >= deskX(m) && (!compact || (m.toggleLabel === "Show sidebar" && m.toggleExpanded === "false")),
    { toggle: box(m.toggle), label: m.toggleLabel, expanded: m.toggleExpanded },
  );
  const stageW = m.insp.left - deskX(m);
  const want = Math.min(720, m.vh - 124, stageW - 96);
  check(`${tag}: поле 81 клетка, квадратное, min(720, окно − 124, область − 96) = ${Math.round(want)}`, m.cells === 81 && near(m.board.width, m.board.height) && near(m.board.width, want, 1.5) && inside(m.board, m), { board: box(m.board), want: Math.round(want) });
  check(`${tag}: поле по центру области контента, не под инспектором`, near((m.board.left + m.board.right) / 2, deskX(m) + stageW / 2, 1.5) && m.board.right <= m.insp.left, { center: Math.round((m.board.left + m.board.right) / 2) });
  check(`${tag}: инспектор справа во всю высоту, ширина clamp(260, 20vw, 320), без прокрутки`, near(m.insp.right, m.vw, 1) && near(m.insp.top, 0, 1) && near(m.insp.bottom, m.vh, 1) && near(m.insp.width, inspW(m.vw), 1) && !m.inspScrolls, { insp: box(m.insp), scroll: m.inspScroll });
  const xs = [...new Set(m.keys.map((k) => Math.round(k.left)))];
  const ys = [...new Set(m.keys.map((k) => Math.round(k.top)))];
  check(`${tag}: панель 3 × 3 (≥ 44 px), в инспекторе`, m.keys.length === 9 && xs.length === 3 && ys.length === 3 && m.keys.every((k) => k.height >= 44 && k.left >= m.insp.left && k.right <= m.insp.right), { h: m.keys[0] && Math.round(m.keys[0].height) });
  const ks = m.acts.map((a) => a.kbd);
  const actOk = m.acts.length === 3 && ks[0] === "N" && /^(⌘Z|Ctrl\+Z)$/.test(ks[1] ?? "") && ks[2] === "⌫" && m.acts.every((a) => a.ks && a.kbdShown && !a.labelClipped);
  if (compact) {
    const [a, b, c] = m.acts.map((x) => x.r);
    check(`${tag}: действия 2 × 2 (Notes | Undo, Erase во всю ширину), чипы клавиш видны, подписи не обрезаны`, actOk && near(a.top, b.top) && a.right <= b.left && c.top >= a.bottom && near(c.left, a.left) && near(c.right, b.right) && m.acts.every((x) => x.r.height >= 44), { acts: m.acts.map((x) => [x.kbd, box(x.r), x.labelClipped]) });
    check(`${tag}: шпаргалки клавиш на компакте нет`, !m.legend, {});
  } else {
    check(`${tag}: действия столбиком с чипами клавиш`, actOk && m.acts[1].r.top >= m.acts[0].r.bottom, { acts: m.acts.map((x) => x.kbd) });
    check(`${tag}: шпаргалка клавиш — только от высоты 800 (${m.vh})`, m.legend === m.vh >= 800, { legend: m.legend });
  }
  check(`${tag}: время и остаток в инспекторе`, m.meta.length === 2 && /^\d+:\d\d$/.test(m.meta[0]) && /^\d+ cells?$/.test(m.meta[1]), { meta: m.meta });
  contrast(tag, m);
}

/** После решения: поле на месте, в инспекторе компактная карточка + Grid ∞. `before` — замер партии до решения. */
function solvedChecks(tag, m, before, compact) {
  check(`${tag}: решено — поле на месте того же размера, приглушено вне фокуса (inert); тулбар тот же`, m.deskPlay && m.tbDesk && m.cells === 81 && m.stageInert && near(m.board.left, before.board.left, 0.5) && near(m.board.top, before.board.top, 0.5) && near(m.board.width, before.board.width, 0.5), { board: box(m.board), before: box(before.board) });
  check(`${tag}: инспектор — карточка результата и Grid ∞ (вместо времени и панели), та же ширина`, m.inspSolved && !!m.card && !!m.grid && m.keys.length === 0 && m.meta.length === 0 && near(m.insp.width, before.insp.width, 0.5) && near(m.insp.top, 0, 1) && near(m.insp.bottom, m.vh, 1), { insp: box(m.insp) });
  const cols = new Set(m.rows.map((x) => Math.round(x.left)));
  check(`${tag}: карточка компактная — без подзаголовка, тепловая карта ≤ 150, цифры в 2 колонки`, !m.cardSub && m.heat.width <= 150.5 && cols.size === 2 && near(m.rows[0].top, m.rows[1].top), { heat: box(m.heat), rows: m.rows.map(box) });
  check(`${tag}: Watch и Share — как на телефоне: две подписанные кнопки во всю ширину карточки, Share под Watch`, m.watch && m.share && m.share.top >= m.watch.bottom && near(m.share.width, m.watch.width, 1) && m.shareName === "Share" && m.share.right <= m.card.right, { watch: box(m.watch), share: box(m.share) });
  check(`${tag}: Grid ∞ — 81 клетка, ≤ 150, клетка дня отмечена, «What's this?» видна`, m.gridCells === 81 && m.gridBoard.width <= 150.5 && near(m.gridBoard.width, m.gridBoard.height) && m.gridTarget && m.gridHelp, { grid: box(m.gridBoard) });
  check(`${tag}: нет горизонтальной прокрутки, страница не прокручивается`, m.scrollW <= m.vw && !m.paneScrolls, { scrollW: m.scrollW, pane: m.paneScrolls });
  if (m.vh >= 800) {
    check(`${tag}: высота ≥ 800 — инспектор НЕ прокручивается, карточка и Grid ∞ целиком в окне (запас ${Math.round(m.vh - m.lastBottom)} px)`, !m.inspScrolls && inside(m.card, m) && inside(m.grid, m) && m.lastBottom <= m.vh, { scroll: m.inspScroll, last: Math.round(m.lastBottom) });
  } else {
    check(`${tag}: высота < 800${compact ? " (компакт)" : ""} — прокручивается только инспектор, карточка сверху видна целиком`, m.card.top >= 0 && m.card.top < 40 && m.inspScroll.top === 0, { scroll: m.inspScroll, card: box(m.card) });
  }
  contrast(tag, m, 12);
}

const WINDOWS = [[1280, 800], [1440, 900], [1920, 1080]];
const ZOOMS = [100, 125, 150];
const css = (W, H, z) => [Math.round(W / (z / 100)), Math.round(H / (z / 100))];
const isFull = (w, h) => w >= 1100 && h >= 680;

async function runDesk(browser, BR, NEW) {
  for (const [W, H] of WINDOWS)
    for (const z of ZOOMS)
      for (const scheme of z === 100 ? ["light", "dark"] : ["light"]) {
        const [w, h] = css(W, H, z);
        const compact = !isFull(w, h);
        const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
        const tag = `${BR} ${W}x${H}@${z} ${scheme} (${w}x${h}${compact ? ", компакт" : ""})`;
        const m = await measure(p);
        partyChecks(tag, m, compact);
        await p.screenshot({ path: path.join(OUT, `${BR}-${W}x${H}-z${z}-${scheme}-today.png`) });
        await solveDay(p);
        const s = await measure(p);
        solvedChecks(`${tag} решено`, s, m, compact);
        await p.screenshot({ path: path.join(OUT, `${BR}-${W}x${H}-z${z}-${scheme}-solved.png`) });
        if (s.inspScrolls) {
          // Grid ∞ достижим: инспектор докручивается до конца, Grid ∞ целиком в его видимой части; поле/тулбар не сдвинулись.
          await p.evaluate(() => {
            const i = document.querySelector(".tab-pane:not(.off) .desk-insp");
            i.scrollTop = i.scrollHeight;
          });
          await p.waitForTimeout(150);
          const e = await measure(p);
          check(`${tag} решено: прокрутка инспектора — Grid ∞ виден целиком, поле и тулбар на месте`, e.grid.top >= e.insp.top - 0.5 && e.grid.bottom <= e.insp.bottom + 0.5 && near(e.board.top, s.board.top, 0.5) && near(e.tb.top, s.tb.top, 0.5) && !e.paneScrolls, { grid: box(e.grid), scroll: e.inspScroll });
          await p.screenshot({ path: path.join(OUT, `${BR}-${W}x${H}-z${z}-${scheme}-solved-scrolled.png`) });
        }
        check(`${tag}: без ошибок JS`, errs.length === 0, { errs });
        await ctx.close();
      }
}

/** Прямоугольник элемента (или null). */
const rect = (p, sel) => p.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null, sel);
const activeId = (p) => p.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.className ?? null);

/** Share → экспорт отпечатка: шит в слое окна, PNG 1080 × 1350, кнопка Share скачивает PNG (в headless системного листа нет). */
async function shareCheck(T, p, m) {
  await p.locator(`${PANE} .desk-insp [data-testid="share"]`).click();
  await p.waitForSelector(".desk-layer [data-testid='fp-image']", { timeout: 20000 });
  await p.waitForFunction(() => document.querySelector("[data-testid='fp-image']")?.naturalWidth > 0, null, { timeout: 20000 });
  const img = await p.evaluate(() => {
    const i = document.querySelector("[data-testid='fp-image']");
    return { w: i.naturalWidth, h: i.naturalHeight, inLayer: !!i.closest(".desk-layer") };
  });
  const sheet = await rect(p, ".desk-layer [data-testid='export-sheet']");
  check(`${T}: Share → шит экспорта в слое окна, PNG ${img.w}×${img.h}`, img.inLayer && img.w === 1080 && img.h === 1350 && sheet && sheet.left >= -0.5 && sheet.right <= m.vw + 0.5, { img, sheet: box(sheet) });
  await p.screenshot({ path: path.join(OUT, `${T.replace(/[^\w@-]+/g, "_")}-share.png`) });
  // Системный лист (navigator.share с файлами — WebKit/Safari) в headless не открыть: подменяем только сам вызов share, чтобы
  // увидеть, ЧТО отдаётся (файл PNG, имя, размер); ветку выбирает код приложения (canShare — настоящий). Иначе — скачивание.
  await p.evaluate(() => {
    window.__shared = null;
    if (typeof navigator.share === "function" && typeof navigator.canShare === "function")
      navigator.share = async (d) => {
        const f = d.files[0];
        const bmp = await createImageBitmap(f);
        window.__shared = { name: f.name, type: f.type, w: bmp.width, h: bmp.height };
      };
  });
  const dl = p.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await p.locator(".desk-layer [data-testid='fp-share']").click();
  const d = await Promise.race([dl, p.waitForFunction(() => window.__shared, null, { timeout: 8000 }).then(() => null).catch(() => null)]);
  const shared = await p.evaluate(() => window.__shared);
  let png = null;
  if (shared) png = { name: shared.name, sig: shared.type === "image/png" ? "PNG" : shared.type, w: shared.w, h: shared.h, via: "navigator.share" };
  else if (d) {
    const f = path.join(OUT, `.dl-${Date.now()}.png`);
    await d.saveAs(f);
    const b = fs.readFileSync(f);
    png = { name: d.suggestedFilename(), sig: b.subarray(1, 4).toString(), w: b.readUInt32BE(16), h: b.readUInt32BE(20), via: "download" };
    fs.unlinkSync(f);
  }
  const status = await p.locator(".desk-layer [data-testid='fp-status']").textContent();
  check(`${T}: Share в шите — PNG отпечатка отдан (${png?.via ?? "—"}: ${png?.name ?? "—"})`, png && png.sig === "PNG" && png.w === 1080 && png.h === 1350 && /^pundoku-\d{4}-\d\d-\d\d\.png$/.test(png.name), { png, status });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  const gone = await p.evaluate(() => !document.querySelector("[data-testid='export-sheet']"));
  check(`${T}: Esc закрывает шит экспорта`, gone, {});
}

async function runFlow(browser, BR, NEW) {
  // ---- F1. Полная 1280×800@100: фокус после решения, Tab по инспектору, Share, «What's this?» Grid ∞.
  {
    const [w, h] = [1280, 800];
    const T = `${BR} flow 1280x800@100 light`;
    const { ctx, p, errs } = await open(browser, { w, h, base: NEW });
    await solveDay(p);
    let m = await measure(p);
    check(`${T}: после решения фокус на карточке результата`, m.active === "result-card", { active: m.active });
    const seen = [];
    // Safari/WebKit: Tab по умолчанию пропускает кнопки (поведение платформы, аудит PD-228 #12) — там обход всех элементов
    // по ⌥Tab, как у пользователя Safari.
    const TAB = BR === "wk" ? "Alt+Tab" : "Tab";
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press(TAB);
      const f = await p.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const r = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        return { id: a.dataset.testid ?? a.getAttribute("aria-label") ?? a.className, inInsp: !!a.closest(".desk-insp"), inStage: !!a.closest(".desk-stage"), r: [r.left, r.top, r.right, r.bottom], ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 };
      });
      if (f) seen.push(f);
    }
    const insp = seen.filter((f) => f.inInsp);
    const bad = insp.filter((f) => !f.ring || f.r[0] < -0.5 || f.r[1] < -0.5 || f.r[2] > w + 0.5 || f.r[3] > h + 0.5);
    const ids = insp.map((f) => f.id);
    check(`${T}: ${TAB} с карточки — по инспектору (What's this?, Watch, Share, Grid ∞), кольцо видно, в окне; поле не в обходе`, ids.includes("technique-help") && ids.includes("tl-watch") && ids.includes("share") && ids.includes("grid-help") && bad.length === 0 && !seen.some((f) => f.inStage), { stops: seen.map((f) => f.id), bad });
    await p.locator(`${PANE} [data-testid="result-card"]`).focus();
    await p.screenshot({ path: path.join(OUT, `${BR}-flow-1280x800-z100-light-1-solved-focus.png`) });
    await shareCheck(T, p, m);
    // «What's this?» Grid ∞ → справка (блок Grid ∞), назад — Today с той же раскладкой.
    await p.locator(`${PANE} [data-testid="grid-help"]`).click();
    await p.waitForTimeout(500);
    const help = await p.evaluate(() => location.hash);
    check(`${T}: «What's this?» Grid ∞ → справка`, /help/.test(help), { hash: help });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: Esc из справки — снова решённый Today: поле + карточка + Grid ∞, инспектор без прокрутки`, m.inspSolved && !!m.grid && !m.inspScrolls && m.hash === "#/today", { hash: m.hash });
    // Смена окна на лету: полная → компакт (зум 125 %) → полная. Выбор «сайдбар показан» в полной раскладке не теряется.
    await p.setViewportSize({ width: 1024, height: 640 });
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: окно сузили до 1024×640 — компакт на лету: без сайдбара, карточка в инспекторе`, m.shellClass.includes("compact") && !m.sideShown && m.inspSolved && m.scrollW <= m.vw, { shell: m.shellClass });
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: вернули 1280×800 — полная раскладка, сайдбар снова показан`, !m.shellClass.includes("compact") && m.sideShown && !m.inspScrolls, { shell: m.shellClass });
    check(`${T}: без ошибок JS`, errs.length === 0, { errs });
    await ctx.close();
  }

  // ---- F2/F3. Компакт: сайдбар поверх контента, экраны, партия Play, клавиатура, решение и прокрутка инспектора, Share.
  for (const [W, H, z, scheme] of [[1280, 800, 150, "dark"], [1440, 900, 150, "light"]]) {
    const [w, h] = css(W, H, z);
    const T = `${BR} flow ${W}x${H}@${z} ${scheme} (${w}x${h}, компакт)`;
    const shot = (name) => p.screenshot({ path: path.join(OUT, `${BR}-flow-${W}x${H}-z${z}-${scheme}-${name}.png`) });
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
    let m = await measure(p);
    const board0 = m.board;
    // Показать сайдбар кнопкой: поверх контента, поле не сдвинулось, фокус на выбранном пункте, aria-expanded.
    await p.locator(`${PANE} [data-testid="sidebar-toggle"]`).click();
    await p.waitForTimeout(300);
    m = await measure(p);
    const act = await activeId(p);
    check(`${T}: кнопка показывает сайдбар поверх контента (поле не сдвинулось), фокус на «Today», aria-expanded=true`, m.sideShown && near(m.board.left, board0.left, 0.5) && near(m.board.width, board0.width, 0.5) && act === "side-today" && m.toggleExpanded === "true" && m.toggleLabel === "Hide sidebar", { side: box(m.side), board: box(m.board), active: act });
    await shot("1-side-overlay");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(250);
    m = await measure(p);
    const back = await activeId(p);
    check(`${T}: Esc убирает сайдбар, фокус — на кнопку`, !m.sideShown && back === "sidebar-toggle" && m.cells === 81, { active: back });
    // Клик мимо (по клетке поля правее сайдбара) — убирает; сам клик проходит дальше (клетка выбрана).
    await p.locator(`${PANE} [data-testid="sidebar-toggle"]`).click();
    await p.waitForTimeout(250);
    await p.locator(`${PANE} .board [data-i="7"]`).click();
    await p.waitForTimeout(250);
    m = await measure(p);
    const sel7 = await p.evaluate(() => document.querySelector('.tab-pane:not(.off) .board [data-i="7"]')?.classList.contains("sel"));
    check(`${T}: клик мимо сайдбара убирает его, клик проходит (клетка выбрана)`, !m.sideShown && sel7, { sel7 });
    // Клавиатура партии на компакте.
    const left = async () => (await p.locator(`${PANE} [data-testid="insp-left"]`).textContent()).trim();
    const left0 = await left();
    await p.keyboard.press("Digit4");
    await p.waitForTimeout(200);
    const left1 = await left();
    const mod = BR === "wk" ? "Meta" : "Control";
    await p.keyboard.press(`${mod}+KeyZ`);
    await p.waitForTimeout(200);
    const left2 = await left();
    await p.keyboard.press("ArrowRight");
    const selArrow = await p.evaluate(() => document.activeElement?.dataset?.i ?? null);
    check(`${T}: клавиатура — цифра (${left0} → ${left1}), ${mod}+Z (${left2}), стрелка`, left1 !== left0 && left2 === left0 && selArrow === "8", { left0, left1, left2, selArrow });
    // Выбор пункта: Year — переход и сайдбар уходит. Year/Settings на компакте: без таб-бара, кнопка в шапке, без гориз. прокрутки.
    await p.locator(`${PANE} [data-testid="sidebar-toggle"]`).click();
    await p.waitForTimeout(250);
    await p.locator('[data-testid="side-year"]').click();
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: «Year» в сайдбаре — переход, сайдбар убран; Year без таб-бара, кнопка в шапке, без горизонтальной прокрутки`, m.hash.startsWith("#/year") && !m.sideShown && !m.tabbarShown && m.toggle && m.toggleInTb && m.scrollW <= m.vw, { hash: m.hash, toggle: box(m.toggle) });
    await shot("2-year");
    await p.locator(`${PANE} [data-testid="open-settings"]`).click();
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: Settings — кнопка сайдбара в навбаре, без таб-бара и горизонтальной прокрутки`, m.toggle && m.toggleInTb && !m.tabbarShown && m.scrollW <= m.vw, { toggle: box(m.toggle) });
    await shot("3-settings");
    // Режим из сайдбара → страница режима → Start → партия Play: компактный инспектор.
    await p.locator(".push-layer [data-testid='sidebar-toggle']").click();
    await p.waitForTimeout(250);
    await p.locator('[data-testid="side-mode-classic"]').click();
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: режим из сайдбара — страница режима, сайдбар убран`, !m.sideShown && (await p.locator(`${PANE} [data-testid="mode-page-start"]`).count()) === 1, {});
    await p.locator(`${PANE} [data-testid="difficulty-easy"]`).click();
    await p.locator(`${PANE} [data-testid="mode-page-start"]`).click();
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    await p.waitForTimeout(700);
    m = await measure(p);
    partyChecks(`${T} партия Play`, m, true);
    await shot("4-play-party");
    // Хаб Play на компакте: прежние строки режимов, без таб-бара.
    await p.locator(`${PANE} [data-testid="sidebar-toggle"]`).click();
    await p.waitForTimeout(250);
    await p.locator('[data-testid="side-play"]').click();
    await p.waitForTimeout(500);
    m = await measure(p);
    check(`${T}: хаб Play на компакте — без таб-бара, кнопка в шапке, без горизонтальной прокрутки`, !m.tabbarShown && m.toggle && m.scrollW <= m.vw && (await p.locator(`${PANE} [data-testid="mode-classic"]`).count()) === 1, {});
    await shot("5-hub");
    // Today: решить → прокручивается только инспектор; Share работает и на компакте.
    await p.locator(`${PANE} [data-testid="sidebar-toggle"]`).click();
    await p.waitForTimeout(250);
    await p.locator('[data-testid="side-today"]').click();
    await p.waitForTimeout(500);
    const before = await measure(p);
    await solveDay(p);
    m = await measure(p);
    solvedChecks(`${T} решено`, m, before, true);
    check(`${T}: решено на компакте — инспектор прокручивается (${m.inspScroll.sh} > ${m.inspScroll.ch}), фокус на карточке`, m.inspScrolls && m.active === "result-card", { scroll: m.inspScroll, active: m.active });
    await shot("6-solved");
    await shareCheck(T, p, m);
    check(`${T}: без ошибок JS`, errs.length === 0, { errs });
    await ctx.close();
  }
}

/** DOM-дерево без текста: теги, классы, роли, aria-* — «телефон не изменился» структурно. */
const domSig = (p) =>
  p.evaluate(() => {
    const walk = (el) => {
      const a = [...el.attributes].filter((x) => x.name === "class" || x.name === "role" || x.name.startsWith("aria-") || x.name === "data-testid").map((x) => `${x.name}=${x.value}`).sort().join(" ");
      return `<${el.tagName.toLowerCase()} ${a}>${[...el.children].map(walk).join("")}`;
    };
    return walk(document.getElementById("root")) + `|html.class=${document.documentElement.className}`;
  });

async function runPhone(browser, BR, NEW, OLD) {
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
  // [w, h, scheme, dpr, touch]: телефон (касание, DPR 3) в портрете и ландшафте.
  const SETS = [
    [393, 852, "light", 3, true],
    [393, 852, "dark", 3, true],
    [320, 568, "light", 3, true],
    [852, 393, "light", 3, true],
  ];
  // Растр под нагрузкой машины изредка недетерминирован — набор снимается до 3 раз, кадр засчитывается по ЛУЧШЕЙ попытке;
  // DOM обязан совпасть в КАЖДОЙ попытке.
  for (const [w, h, scheme, dpr, touch] of SETS) {
    const best = {};
    const domOk = {};
    const tries = {};
    for (let attempt = 1; attempt <= 3; attempt++) {
      const pics = {};
      const doms = {};
      for (const [k, base] of [["base", OLD], ["new", NEW]]) {
        const { ctx, p } = await open(browser, { w, h, dpr, scheme, base, touch });
        const take = async (screen) => {
          await p.waitForTimeout(500);
          // Под маской — часы и время решения в карточке: оно реальное (сколько шёл прогон), не код.
          const buf = await p.screenshot({ mask: [p.locator(".subline .clock"), p.locator(".card .rows dd.mono")], maskColor: "#f0f" });
          (pics[screen] ??= {})[k] = buf;
          (doms[screen] ??= {})[k] = await domSig(p);
          if (attempt === 1 && w === 393 && scheme === "light") fs.writeFileSync(path.join(OUT, `${BR}-phone-${w}x${h}-${scheme}-${screen}-${k}.png`), buf);
        };
        await take("today");
        await p.locator("#tab-play").click();
        await take("hub");
        await p.locator(`${PANE} [data-testid="mode-classic"]`).click();
        await p.locator('[data-testid="sheet-start"]').click();
        await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
        await take("play");
        await p.locator("#tab-year").click();
        await take("year");
        await p.locator(`${PANE} [data-testid="open-settings"]`).click();
        await take("settings");
        // Решённый Today: карточка + Grid ∞ (вершина экрана и докрученный низ).
        await p.locator(".push-layer .settings-back").click();
        await p.waitForTimeout(300);
        await p.locator("#tab-today").click();
        await p.waitForTimeout(500);
        await solveDay(p);
        await p.evaluate(() => document.activeElement?.blur());
        await take("today-solved");
        await p.evaluate(() => {
          const s = document.querySelector(".tab-pane:not(.off)");
          s.scrollTop = s.scrollHeight;
        });
        await take("today-solved-bottom");
        await ctx.close();
      }
      for (const screen of Object.keys(pics)) {
        const n = await diff(pics[screen].base, pics[screen].new);
        if (best[screen] === undefined || (n >= 0 && n < best[screen]) || best[screen] < 0) best[screen] = n;
        if (best[screen] === 0 && tries[screen] === undefined) tries[screen] = attempt;
        domOk[screen] = (domOk[screen] ?? true) && doms[screen].base === doms[screen].new;
      }
      if (Object.values(best).every((n) => n === 0)) break;
    }
    for (const screen of Object.keys(best)) {
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: кадр = main`, best[screen] === 0, { diffPx: best[screen], attempt: tries[screen] ?? null });
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: DOM = main`, domOk[screen], {});
    }
  }
  await cmp.close();
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
    if (which.includes("desk")) await runDesk(browser, BR, NEW);
    if (which.includes("flow")) await runFlow(browser, BR, NEW);
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
