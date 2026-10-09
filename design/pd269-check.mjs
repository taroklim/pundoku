/**
 * PD-269 — десктоп C: шкала ширин, наведение/курсор, фокус с клавиатуры, «Start ↩» — живая проверка на РЕАЛЬНОЙ сборке
 * + «телефон и компакт не изменились» попиксельно против main.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd269-dist                 (ветка pd-desk-c-269)
 *   (main) npx vite build --outDir /tmp/pd269-base                         (эталон телефона и компакта)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd269-dist BASE_DIST=/tmp/pd269-base PORT=5381 \
 *     node design/pd269-check.mjs [widths] [solved] [hover] [keys] [compact] [phone] [chromium] [webkit] [firefox]
 *   Без частей — все; без браузеров — cr + wk + ff (Firefox — если есть в установке Playwright, иначе SKIP, не FAIL).
 *
 * Масштаб браузера эмулируется как в аудите PD-228 и pd266-check: вьюпорт = окно ÷ масштаб, DPR = масштаб.
 *
 * widths — 1280×800 / 1440×900 / 1920×1080 × 100/125/150 % × светлая/тёмная. Today (партия), хаб Play, страница режима,
 *   Year, Settings, справка. В раскладке с сайдбаром: поле ≤ 720, квадрат 81 клетка в окне; панель 1–9, Notes/Undo/Erase и
 *   строка Ink — шириной и центром с поле; карточки хаба/Settings/справки = min(640, область − 32), полотно Year =
 *   min(780, область − 32), страница режима ≤ 480; каждая колонка по центру области контента и правее сайдбара; нет
 *   горизонтальной прокрутки, нет ошибок JS. Ниже 1100 × 680 — прежняя оболочка (таб-бар), колонок нет.
 * solved — Today после решения (1280×800, 1440×900, 1920×1080, 1920×1080 @150): карточка дня и Grid ∞ — колонка 640 по центру.
 * hover — 1440×900 светлая/тёмная: наведение даёт ровно значения §2 (--hover / --key-hover / --elev / кольцо --hover-ring) на
 *   сайдбаре, кнопке сайдбара, шестерёнке, строках хаба/страницы режима/Settings, тумблере, клавишах, действиях, клетке, месяце
 *   Year; выбранное/неактивное не подсвечивается; контраст label-2 на подсвеченной строке ≥ 4.5:1; курсор: «рука» на кнопках,
 *   строках, тумблере, стрелка на поле и неактивном Undo; касание (iPad 1180×820, coarse) — ни подсветки, ни смены курсора.
 * keys — 1440×900 и 1920×1080 @150: Tab (WebKit — ⌥Tab, как Safari) по Today, хабу, странице режима, Year, Settings, справке: у КАЖДОГО фокуса есть видимое
 *   кольцо (outline или inset-тень; клетка — кольцо выбора), кольцо не срезано ни одним предком с overflow и окном; программный
 *   фокус заголовка справки после клика — без кольца; страница режима: фокус на «Start», чип ↩, Enter запускает партию.
 * compact — 1280×800 @125/@150, 1440×900 @150 (мышь, без касания): Today, хаб, Year, Settings — кадр и DOM = main (кадр:
 *   отличий больше 1 уровня канала — 0; ровно на 1 уровень — шум растеризации Chromium при дробном DPR, печатается как noise1).
 * phone — 393×852 (свет/тьма), 320×568, 852×393, касание + DPR 3: Today, хаб, партия, Year, Settings — кадр и DOM = main.
 * Кадры — design/pd269-shots/; итог — PASS/FAIL построчно и сводка design/pd269-shots/results-<части>-<браузеры>.json.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd269-shots");
const PORT = +(process.env.PORT ?? 5381);
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const PARTS = ["widths", "solved", "hover", "keys", "compact", "phone"];
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
  results[name] = { ok, ...detail };
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
const css = (W, H, z) => [Math.round(W / (z / 100)), Math.round(H / (z / 100))];
const isDesk = (w, h) => w >= 1100 && h >= 680;
const settle = (p, ms = 450) => p.waitForTimeout(ms);
const hashGo = async (p, hash) => {
  await p.evaluate((h) => (location.hash = h), hash);
  await settle(p, 600);
};

// ---------- замеры колонок ----------
/** Прямоугольники колонок активного экрана + область контента (клиентская часть прокручиваемой панели). */
async function cols(p) {
  return p.evaluate(() => {
    const R = (el) => (el ? (({ left, top, width, height, right, bottom }) => ({ left, top, width, height, right, bottom }))(el.getBoundingClientRect()) : null);
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.hidden && el.getBoundingClientRect().width > 0;
    const layer = document.querySelector(".push-layer") ?? document.querySelector(".tab-pane:not(.off)");
    const scroll = layer;
    const sr = scroll.getBoundingClientRect();
    const area = { left: sr.left + scroll.clientLeft, width: scroll.clientWidth };
    area.right = area.left + area.width;
    const all = (sel) => [...layer.querySelectorAll(sel)].filter(vis).map(R);
    const union = (rs) => (rs.length ? { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), width: Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left)) } : null);
    const side = document.querySelector(".sidebar");
    return {
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      shell: document.querySelector(".shell")?.className,
      side: vis(side) ? R(side) : null,
      area,
      board: R(layer.querySelector(".play-fit .board")),
      cells: layer.querySelectorAll(".play-fit .board button.cell").length,
      pad: R(layer.querySelector(".play-fit .pad")),
      actions: R(layer.querySelector(".play-fit .actions")),
      ink: R(layer.querySelector(".play-fit .ink-list")),
      hubCards: all(".hub-scroll > .hub-sec .hub-card"),
      modePage: R(layer.querySelector(".mode-page")),
      settingsCards: all(".settings > .settings-sec .settings-card"),
      year: union(all(".year-months > .year-month")),
      card: R(layer.querySelector(".today:not(.play-fit) > .card")),
      gridInf: R(layer.querySelector('[data-testid="grid-inf-section"] .board')),
      hash: location.hash,
    };
  });
}
const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;
const mid = (r) => (r.left + r.right) / 2;
const rr = (r) => r && [Math.round(r.left), Math.round(r.width)];
/** Колонка: ширина = ожидаемой, центр — центр области, левее не заходит за сайдбар. */
function colOk(c, m, want) {
  return !!c && near(c.width, want) && near(mid(c), mid(m.area), 1.5) && (!m.side || c.left >= m.side.right - 0.5) && c.right <= m.vw + 0.5;
}

async function runWidths(browser, BR, NEW) {
  for (const [W, H] of WINDOWS)
    for (const z of ZOOMS)
      for (const scheme of ["light", "dark"]) {
        const [w, h] = css(W, H, z);
        const desk = isDesk(w, h);
        const tag = `${BR} ${W}x${H}@${z} ${scheme} (${w}x${h})`;
        const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
        const shot = (name) => (scheme === "light" || z === 100) && p.screenshot({ path: path.join(OUT, `${BR}-${W}x${H}-z${z}-${scheme}-${name}.png`) });
        let m = await cols(p);
        check(`${tag}: раскладка ${desk ? "с сайдбаром" : "прежняя"}`, desk ? m.shell?.startsWith("shell desk") && !!m.side : m.shell === "shell" && !m.side, { shell: m.shell });
        check(`${tag}: нет горизонтальной прокрутки`, m.scrollW <= m.vw, { scrollW: m.scrollW });
        // Today — партия.
        const b = m.board;
        check(`${tag} today: поле 81 клетка, квадрат, в окне${desk ? ", ≤ 720" : ""}`, m.cells === 81 && near(b.width, b.height) && b.left >= 0 && b.right <= m.vw + 0.5 && b.bottom <= m.vh + 0.5 && (!desk || b.width <= 720.5), { board: [Math.round(b.left), Math.round(b.top), Math.round(b.width)] });
        if (desk) {
          const same = (r) => r && near(r.width, b.width) && near(mid(r), mid(b));
          check(`${tag} today: панель 1–9, Notes/Undo/Erase, строка Ink — по ширине и центру поля`, same(m.pad) && same(m.actions) && same(m.ink) && near(mid(b), mid(m.area)), { board: rr(b), pad: rr(m.pad), actions: rr(m.actions), ink: rr(m.ink), area: rr(m.area) });
          check(`${tag} today: поле правее сайдбара, ряд действий в окне`, b.left >= m.side.right && m.actions.bottom <= m.vh + 0.5, { boardLeft: Math.round(b.left), sideRight: Math.round(m.side.right), actionsBottom: Math.round(m.actions.bottom) });
        }
        await shot("today");
        // Хаб Play.
        if (desk) await p.locator('[data-testid="side-play"]').click();
        else await p.locator("#tab-play").click();
        await settle(p);
        m = await cols(p);
        const read = Math.min(640, m.area.width - 32);
        check(`${tag} hub: ${desk ? `карточки = ${read} по центру` : "прежняя ширина"}`, m.hubCards.length >= 1 && m.hubCards.every((c) => (desk ? colOk(c, m, read) : near(c.width, m.area.width - 32))), { cards: m.hubCards.map(rr), area: rr(m.area) });
        await shot("hub");
        if (desk) {
          await p.locator('[data-testid="side-mode-classic"]').click();
          await settle(p);
          m = await cols(p);
          check(`${tag} mode page: колонка ≤ 480 по центру`, colOk(m.modePage, m, Math.min(480, m.area.width - 32)), { page: rr(m.modePage), area: rr(m.area) });
          await shot("mode");
        }
        // Year.
        if (desk) await p.locator('[data-testid="side-year"]').click();
        else await p.locator("#tab-year").click();
        await settle(p);
        m = await cols(p);
        const yw = Math.min(780, m.area.width - 32);
        check(`${tag} year: ${desk ? `полотно = ${yw} по центру` : "прежняя ширина"}`, desk ? colOk(m.year, m, yw) : near(m.year.width, m.area.width - 32), { year: rr(m.year), area: rr(m.area) });
        await shot("year");
        // Settings, справка.
        await p.locator('.tab-pane:not(.off) [data-testid="open-settings"]').click();
        await settle(p, 600);
        m = await cols(p);
        check(`${tag} settings: ${desk ? `карточки = ${read} по центру` : "прежняя ширина"}`, m.settingsCards.length >= 4 && m.settingsCards.every((c) => (desk ? colOk(c, m, read) : near(c.width, m.area.width - 32))), { n: m.settingsCards.length, first: rr(m.settingsCards[0]), area: rr(m.area) });
        await shot("settings");
        await hashGo(p, "#/help");
        m = await cols(p);
        check(`${tag} help: ${desk ? `текст в карточках = ${read} по центру` : "прежняя ширина"}`, m.settingsCards.length >= 4 && m.settingsCards.every((c) => (desk ? colOk(c, m, read) : near(c.width, m.area.width - 32))), { n: m.settingsCards.length, first: rr(m.settingsCards[0]) });
        m = await cols(p);
        check(`${tag}: нет горизонтальной прокрутки (после всех экранов), без ошибок JS`, m.scrollW <= m.vw && errs.length === 0, { scrollW: m.scrollW, errs });
        await ctx.close();
      }
}

async function solveToday(p) {
  for (let i = 0; i < 81; i++)
    if (MISSION[i] === "0") {
      await p.locator(`.tab-pane:not(.off) .board button.cell[data-i="${i}"]`).click();
      await p.keyboard.press(SOLUTION[i]);
    }
  await p.waitForSelector('.tab-pane:not(.off) [data-testid="grid-inf-section"]', { timeout: 20000 });
  await settle(p, 1200);
}

async function runSolved(browser, BR, NEW) {
  for (const [W, H, z] of [[1280, 800, 100], [1440, 900, 100], [1920, 1080, 100], [1920, 1080, 150]]) {
    const [w, h] = css(W, H, z);
    const tag = `${BR} solved ${W}x${H}@${z}`;
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, base: NEW });
    await solveToday(p);
    const m = await cols(p);
    const read = Math.min(640, m.area.width - 32);
    check(`${tag}: карточка дня = ${read} по центру`, colOk(m.card, m, read), { card: rr(m.card), area: rr(m.area) });
    check(`${tag}: Grid ∞ = ${read} по центру`, colOk(m.gridInf, m, read), { grid: rr(m.gridInf) });
    check(`${tag}: нет горизонтальной прокрутки, без ошибок JS`, m.scrollW <= m.vw && errs.length === 0, { errs });
    await p.screenshot({ path: path.join(OUT, `${BR}-solved-${W}x${H}-z${z}.png`) });
    await ctx.close();
  }
}

// ---------- наведение и курсор ----------
/** Computed-стиль элемента + цвет фона под ним (со смешиванием слоёв и градиента-слоя наведения). */
async function look(p, sel) {
  return p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const parse = (s) => {
      const m = s && s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
    };
    const over = (top, bot) => [0, 1, 2].map((i) => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
    const layers = (e) => {
      const cs = getComputedStyle(e);
      const out = [];
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) out.push(c);
      const g = cs.backgroundImage.match(/gradient\((rgba?\([^)]+\))/);
      if (g) out.push(parse(g[1]));
      return out;
    };
    const stack = [];
    for (let e = el; e; e = e.parentElement) stack.push(layers(e));
    let bg = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) for (const l of stack[i]) bg = over(l, bg);
    const cs = getComputedStyle(el);
    return { bgColor: cs.backgroundColor, bgImage: cs.backgroundImage, shadow: cs.boxShadow, cursor: cs.cursor, bg: bg.map((v) => Math.round(v)) };
  }, sel);
}
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

async function runHover(browser, BR, NEW) {
  for (const scheme of ["light", "dark"]) {
    const T = `${BR} hover 1440x900 ${scheme}`;
    const { ctx, p, errs } = await open(browser, { w: 1440, h: 900, scheme, base: NEW });
    const HOV = scheme === "light" ? "rgba(60, 60, 67, 0.06)" : "rgba(235, 235, 245, 0.08)";
    const KEYH = scheme === "light" ? "rgb(243, 243, 244)" : "rgb(45, 45, 47)";
    const ELEV = scheme === "light" ? "rgb(255, 255, 255)" : "rgb(28, 28, 30)";
    const LABEL2 = scheme === "light" ? [110, 110, 115] : [152, 152, 157];
    const away = () => p.mouse.move(2, 896);
    /** Навести на элемент; вернуть стиль до и после. */
    const hov = async (sel) => {
      await away();
      await settle(p, 200);
      const before = await look(p, sel);
      await p.locator(sel).first().hover();
      await settle(p, 250);
      const after = await look(p, sel);
      return { before, after };
    };
    const P = ".tab-pane:not(.off)";
    // Today: клавиша, действие, клетка, неактивный Undo, сайдбар, кнопка сайдбара, шестерёнка.
    let r = await hov(`${P} .pad .key:nth-child(1)`);
    check(`${T}: клавиша 1–9 → --key-hover, «рука»`, r.after.bgColor === KEYH && r.before.bgColor !== KEYH && r.after.cursor === "pointer", { before: r.before.bgColor, after: r.after.bgColor, cursor: r.after.cursor });
    r = await hov(`${P} .actions .act:nth-child(1)`);
    check(`${T}: Notes → поднимается до --elev, «рука»`, r.after.bgColor === ELEV && r.before.bgColor !== ELEV && r.after.cursor === "pointer", { before: r.before.bgColor, after: r.after.bgColor });
    const undoSel = `${P} .actions .act[aria-disabled="true"]`;
    if (await p.locator(undoSel).count()) {
      r = await hov(undoSel);
      check(`${T}: неактивный Undo — без наведения, стрелка`, r.after.bgColor === r.before.bgColor && r.after.cursor === "default", { bg: r.after.bgColor, cursor: r.after.cursor });
    } else check(`${T}: неактивный Undo — без наведения, стрелка`, false, { err: "нет aria-disabled Undo" });
    r = await hov(`${P} .board button.cell[data-i="40"]`);
    check(`${T}: клетка под курсором — кольцо 1.5 px --hover-ring, стрелка`, /1\.5px/.test(r.after.shadow) && /inset/.test(r.after.shadow) && !/1\.5px/.test(r.before.shadow) && r.after.cursor === "default", { shadow: r.after.shadow, cursor: r.after.cursor });
    r = await hov(`${P} .board button.cell.sel`);
    check(`${T}: выбранная клетка — без кольца наведения`, !/1\.5px/.test(r.after.shadow), { shadow: r.after.shadow });
    r = await hov('[data-testid="side-year"]');
    check(`${T}: пункт сайдбара → --hover, «рука»`, r.after.bgColor === HOV && r.after.cursor === "pointer", { after: r.after.bgColor });
    r = await hov('.sidebar [aria-current="page"]');
    check(`${T}: выбранный пункт сайдбара — без наведения`, r.after.bgColor === r.before.bgColor, { bg: r.after.bgColor });
    r = await hov('[data-testid="sidebar-toggle"]');
    check(`${T}: кнопка сайдбара → слой --hover над подложкой`, /gradient/.test(r.after.bgImage) && !/gradient/.test(r.before.bgImage), { img: r.after.bgImage });
    r = await hov(`${P} [data-testid="open-settings"]`);
    check(`${T}: шестерёнка → --hover`, r.after.bgColor === HOV, { after: r.after.bgColor });
    // Хаб: строка режима (над слоем «Удалить» — градиент поверх --card); контраст подписи.
    await p.locator('[data-testid="side-play"]').click();
    await settle(p);
    r = await hov(`${P} [data-testid="mode-ink"]`);
    const sub = await look(p, `${P} [data-testid="mode-ink"] .sub`);
    const cr = ratio(LABEL2, sub.bg);
    check(`${T}: строка хаба → слой --hover над --card, «рука»; label-2 ≥ 4.5:1`, /gradient/.test(r.after.bgImage) && r.after.cursor === "pointer" && cr >= 4.5, { img: r.after.bgImage, bg: sub.bg, ratio: +cr.toFixed(2) });
    // Страница режима: строка сложности (выбранная — без наведения).
    await p.locator('[data-testid="side-mode-classic"]').click();
    await settle(p);
    r = await hov(`${P} [data-testid="difficulty-hard"]`);
    check(`${T}: строка сложности → --hover`, r.after.bgColor === HOV, { after: r.after.bgColor });
    r = await hov(`${P} .mode-page [role="radio"][aria-checked="true"]`);
    check(`${T}: выбранная сложность — без наведения`, r.after.bgColor === r.before.bgColor, { bg: r.after.bgColor });
    // Year: месяц.
    await p.locator('[data-testid="side-year"]').click();
    await settle(p);
    r = await hov(`${P} .year-month:nth-child(2)`);
    check(`${T}: месяц Year → слой --hover над --elev, «рука»`, /gradient/.test(r.after.bgImage) && r.after.cursor === "pointer", { img: r.after.bgImage });
    // Settings: строка языка (не выбранная), тумблер (вся строка + «рука» на самом тумблере), строка-переход.
    await p.locator(`${P} [data-testid="open-settings"]`).click();
    await settle(p, 600);
    r = await hov('.push-layer .settings-radio[aria-checked="false"]');
    const lab = await look(p, '.push-layer .settings-radio[aria-checked="false"]');
    check(`${T}: строка Settings → --hover, «рука»`, r.after.bgColor === HOV && r.after.cursor === "pointer", { after: r.after.bgColor });
    r = await hov('.push-layer .settings-radio[aria-checked="true"]');
    check(`${T}: выбранный язык — без наведения`, r.after.bgColor === r.before.bgColor, { bg: r.after.bgColor });
    r = await hov(".push-layer .settings-switch");
    const sw = await look(p, ".push-layer .st-switch");
    check(`${T}: строка тумблера → --hover; «рука» на тумблере`, r.after.bgColor === HOV && sw.cursor === "pointer", { after: r.after.bgColor, cursor: sw.cursor });
    const foot = await look(p, ".push-layer .settings-foot");
    check(`${T}: label-2 на подсвеченной строке ≥ 4.5:1`, ratio(LABEL2, lab.bg) >= 4.5, { bg: lab.bg, ratio: +ratio(LABEL2, lab.bg).toFixed(2), foot: foot && foot.bg });
    r = await hov('.push-layer [data-testid="open-help"]');
    check(`${T}: строка «How Pundoku works» → --hover`, r.after.bgColor === HOV, { after: r.after.bgColor });
    check(`${T}: без ошибок JS`, errs.length === 0, { errs });
    await p.screenshot({ path: path.join(OUT, `${BR}-hover-1440x900-${scheme}-settings.png`) });
    await ctx.close();
  }
  // Касание (iPad в альбомной ориентации попадает в раскладку с сайдбаром): ни подсветки, ни смены курсора.
  if (browser.browserType().name() !== "firefox") {
    const T = `${BR} touch 1180x820`;
    const { ctx, p } = await open(browser, { w: 1180, h: 820, dpr: 2, base: NEW, touch: true });
    const media = await p.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
    const before = await look(p, '[data-testid="side-year"]');
    await p.locator('[data-testid="side-year"]').hover();
    await settle(p, 250);
    const after = await look(p, '[data-testid="side-year"]');
    const cell = await look(p, '.tab-pane:not(.off) .board button.cell[data-i="40"]');
    check(`${T}: раскладка с сайдбаром, точного наведения нет — правил наведения/курсора нет`, !media && after.bgColor === before.bgColor && cell.cursor === "pointer", { media, bg: after.bgColor, cellCursor: cell.cursor });
    await ctx.close();
  }
}

// ---------- клавиатура и фокус ----------
/** Нажимать Tab, пока фокус не вернётся к первому; для каждого — видимое кольцо, не срезанное предками и окном. */
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
      // Клетка поля: фокус несёт кольцо выбора (.ring), своей обводки у неё нет (play.css).
      const cellRing = el.matches(".cell") && !!el.closest(".board")?.querySelector(".ring");
      let ring = null;
      if (outline) {
        const d = (parseFloat(cs.outlineOffset) || 0) + ow;
        ring = { left: rect.left - d, top: rect.top - d, right: rect.right + d, bottom: rect.bottom + d };
      } else if (inset || cellRing) ring = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const clips = [];
      if (ring) {
        const box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
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
        if (ring.left < box.left - 0.5 || ring.top < box.top - 0.5 || ring.right > box.right + 0.5 || ring.bottom > box.bottom + 0.5) clips.push("viewport");
      }
      return { id: String(id).slice(0, 60), visible: !!ring, kind: outline ? "outline" : inset ? "inset" : cellRing ? "cell-ring" : "none", clips };
    });
    if (r.none) continue;
    if (r.repeat) break;
    out.push(r);
  }
  return out;
}

async function runKeys(browser, BR, NEW) {
  for (const [W, H, z] of [[1440, 900, 100], [1920, 1080, 150]]) {
    const [w, h] = css(W, H, z);
    const T = `${BR} keys ${W}x${H}@${z}`;
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, base: NEW });
    const audit = async (screen) => {
      // WebKit как Safari: Tab ходит только по полям ввода (аудит PD-228 п. 12, поведение платформы) — по всем элементам ⌥Tab.
      const list = await tabWalk(p, 70, BR === "wk" ? "Alt+Tab" : "Tab");
      const bad = list.filter((x) => !x.visible || x.clips.length);
      check(`${T} ${screen}: у каждого фокуса видимое кольцо, не срезано (${list.length} шт.)`, list.length >= 3 && bad.length === 0, { n: list.length, bad });
    };
    await audit("today");
    await p.locator('[data-testid="side-play"]').click();
    await settle(p);
    await audit("hub");
    // Страница режима: открыли сайдбаром — фокус на «Start», чип ↩, Enter — партия.
    await p.locator('[data-testid="side-mode-classic"]').click();
    await settle(p);
    const st = await p.evaluate(() => {
      const b = document.querySelector('.tab-pane:not(.off) [data-testid="mode-page-start"]');
      const k = b?.querySelector(".mp-key");
      const br = b?.getBoundingClientRect();
      const kr = k?.getBoundingClientRect();
      return { focused: document.activeElement === b, chip: k?.textContent, chipIn: !!(br && kr && kr.left >= br.left && kr.right <= br.right && kr.top >= br.top && kr.bottom <= br.bottom), keys: b?.getAttribute("aria-keyshortcuts") };
    });
    check(`${T} mode page: фокус на «Start», чип ↩ внутри кнопки, aria-keyshortcuts=Enter`, st.focused && st.chip === "↩" && st.chipIn && st.keys === "Enter", st);
    await p.screenshot({ path: path.join(OUT, `${BR}-keys-${W}x${H}-z${z}-mode-page.png`) });
    await audit("mode page");
    // Enter с фона документа (фокус ушёл кликом по пустому месту) — тоже «Start».
    await p.locator('[data-testid="side-mode-classic"]').click();
    await settle(p);
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press("Enter");
    await p.waitForSelector(".tab-pane:not(.off) .play-fit .board button.cell", { timeout: 40000 }).catch(() => null);
    await settle(p);
    const started = await p.evaluate(() => ({ cells: document.querySelectorAll(".tab-pane:not(.off) .play-fit .board button.cell").length, cur: [...document.querySelectorAll('.sidebar [aria-current="page"]')].map((e) => e.dataset.testid) }));
    check(`${T} mode page: Enter — партия Classic на доске`, started.cells === 81 && started.cur.join() === "side-mode-classic", started);
    await p.locator('[data-testid="side-year"]').click();
    await settle(p);
    await audit("year");
    await p.locator('.tab-pane:not(.off) [data-testid="open-settings"]').click();
    await settle(p, 600);
    await audit("settings");
    // Справка, открытая кликом: заголовок получает фокус программно — без кольца (аудит PD-228 п. 17).
    await p.locator('.push-layer [data-testid="open-help"]').click();
    await settle(p, 700);
    const head = await p.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, fv: el?.matches(":focus-visible"), outline: el && getComputedStyle(el).outlineStyle };
    });
    check(`${T} help: программный фокус заголовка после клика — без кольца`, head.tag === "H1" && !head.fv && head.outline === "none", head);
    await audit("help");
    check(`${T}: без ошибок JS`, errs.length === 0, { errs });
    await ctx.close();
  }
}

// ---------- кадры и DOM против main ----------
/** DOM-дерево без текста: теги, классы, роли, aria-* — «не изменился» структурно. */
const domSig = (p) =>
  p.evaluate(() => {
    const walk = (el) => {
      const a = [...el.attributes].filter((x) => x.name === "class" || x.name === "role" || x.name.startsWith("aria-") || x.name === "data-testid").map((x) => `${x.name}=${x.value}`).sort().join(" ");
      return `<${el.tagName.toLowerCase()} ${a}>${[...el.children].map(walk).join("")}`;
    };
    return walk(document.getElementById("root")) + `|html.class=${document.documentElement.className}`;
  });

async function pixDiff(browser) {
  const cmp = await browser.newPage();
  const diff = (a, b) =>
    cmp.evaluate(
      async ([a, b]) => {
        const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + s; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { n: -1, exact: -1 };
        const px = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
        const da = px(ia), db = px(ib);
        // exact — любые отличия; n — отличия больше 1 уровня канала. Отличие ровно на 1 уровень — шум растеризации Chromium при
        // DPR 1.25/1.5 (main против самого себя даёт то же самое), а не раскладка: его считаем, но не валим.
        let n = 0;
        let exact = 0;
        for (let k = 0; k < da.length; k += 4) {
          const m = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]));
          if (m > 0) exact++;
          if (m > 1) n++;
        }
        return { n, exact };
      },
      [a.toString("base64"), b.toString("base64")],
    );
  return { diff, close: () => cmp.close() };
}

/** Кадр «в покое»: снимать, пока два подряд не совпадут байт в байт (до 5 попыток) — дорисовка иконок/переходов не даёт ложных
 *  расхождений (сравнение main с самим собой без этого изредка давало 2–500 px). */
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

async function runCompact(browser, BR, NEW, OLD) {
  const { diff, close } = await pixDiff(browser);
  const capture = async (base, w, h, z) => {
    const pics = {};
    const doms = {};
    const { ctx, p } = await open(browser, { w, h, dpr: z / 100, base });
    const take = async (screen) => {
      await p.mouse.move(1, 1);
      await p.waitForTimeout(500);
      pics[screen] = await stableShot(p);
      doms[screen] = await domSig(p);
    };
    await take("today");
    await p.locator("#tab-play").click();
    await take("hub");
    await p.locator("#tab-year").click();
    await take("year");
    await p.locator('.tab-pane:not(.off) [data-testid="open-settings"]').click();
    await take("settings");
    await ctx.close();
    return { pics, doms };
  };
  for (const [W, H, z] of [[1280, 800, 125], [1280, 800, 150], [1440, 900, 150]]) {
    const [w, h] = css(W, H, z);
    // Иконки (шестерёнка, лампочка) при дробном DPR изредка растеризуются на 2–3 уровня иначе — и в main против самого себя.
    // Настоящее отличие раскладки воспроизводится всегда: экран с отличием снимается заново (до 2 повторов, обе сборки).
    const base = await capture(OLD, w, h, z);
    const neu = await capture(NEW, w, h, z);
    for (const screen of Object.keys(base.pics)) {
      let r = await diff(base.pics[screen], neu.pics[screen]);
      let tries = 1;
      while (r.n !== 0 && tries < 3) {
        tries++;
        const b2 = await capture(OLD, w, h, z);
        const n2 = await capture(NEW, w, h, z);
        base.pics[screen] = b2.pics[screen];
        neu.pics[screen] = n2.pics[screen];
        r = await diff(base.pics[screen], neu.pics[screen]);
      }
      if (r.n !== 0) for (const [k, v] of [["base", base], ["new", neu]]) fs.writeFileSync(path.join(OUT, `${BR}-compact-${W}x${H}-z${z}-${screen}-${k}.png`), v.pics[screen]);
      check(`${BR} compact ${W}x${H}@${z} (${w}x${h}) ${screen}: кадр = main`, r.n === 0, { diffPx: r.n, noise1: r.exact, tries });
      check(`${BR} compact ${W}x${H}@${z} ${screen}: DOM = main`, base.doms[screen] === neu.doms[screen], { len: neu.doms[screen].length });
    }
  }
  await close();
}

async function runPhone(browser, BR, NEW, OLD) {
  const { diff, close } = await pixDiff(browser);
  for (const [w, h, scheme] of [[393, 852, "light"], [393, 852, "dark"], [320, 568, "light"], [852, 393, "light"]]) {
    const pics = {};
    const doms = {};
    for (const [k, base] of [["base", OLD], ["new", NEW]]) {
      const { ctx, p } = await open(browser, { w, h, dpr: 3, scheme, base, touch: true });
      const take = async (screen) => {
        await p.waitForTimeout(500);
        const buf = await stableShot(p);
        (pics[screen] ??= {})[k] = buf;
        (doms[screen] ??= {})[k] = await domSig(p);
        if (w === 393 && scheme === "light") fs.writeFileSync(path.join(OUT, `${BR}-phone-${w}x${h}-${scheme}-${screen}-${k}.png`), buf);
      };
      await take("today");
      await p.locator("#tab-play").click();
      await take("hub");
      await p.locator('.tab-pane:not(.off) [data-testid="mode-classic"]').click();
      await p.locator('[data-testid="sheet-start"]').click();
      await p.waitForSelector(".tab-pane:not(.off) .board button.cell", { timeout: 40000 });
      await take("play");
      await p.locator("#tab-year").click();
      await take("year");
      await p.locator('.tab-pane:not(.off) [data-testid="open-settings"]').click();
      await take("settings");
      await ctx.close();
    }
    for (const screen of Object.keys(pics)) {
      const { n, exact } = await diff(pics[screen].base, pics[screen].new);
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: кадр = main`, exact === 0, { diffPx: exact });
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: DOM = main`, doms[screen].base === doms[screen].new, { len: doms[screen].new.length });
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
  if (which.includes("phone") || which.includes("compact")) {
    if (!BASE_DIST) throw new Error("phone/compact: нужен BASE_DIST (сборка main)");
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
    if (which.includes("widths")) await runWidths(browser, BR, NEW);
    if (which.includes("solved")) await runSolved(browser, BR, NEW);
    if (which.includes("hover")) await runHover(browser, BR, NEW);
    if (which.includes("keys")) await runKeys(browser, BR, NEW);
    if (which.includes("compact")) await runCompact(browser, BR, NEW, OLD);
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
