/**
 * PD-267 — десктоп C «Сайдбар», партия: тулбар над полем + инспектор справа, оверлеи в контексте окна. Живая проверка на
 * РЕАЛЬНОЙ сборке + «телефон/компакт не изменились» попиксельно против main.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd267-dist                 (ветка pd-desk-c-267)
 *   (worktree на main) npx vite build --outDir /tmp/pd267-base             (эталон телефона; нужен только для `phone`)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd267-dist BASE_DIST=/tmp/pd267-base PORT=5371 \
 *     node design/pd267-check.mjs [desk] [flow] [phone] [chromium] [webkit] [firefox]   (без аргументов — всё, cr + wk + ff)
 *   Firefox — если он есть в установке Playwright (иначе SKIP, не FAIL). Сервер — свой статический (не vite preview).
 *
 * Масштаб браузера — как в аудите PD-228 и pd266-check: вьюпорт = окно ÷ масштаб, DPR = масштаб.
 *
 * desk — 1280×800 / 1440×900 / 1920×1080 × 100/125/150 % (светлая) + 100 % тёмная; партия Today. Проверки:
 *   - от 1100 × 680 CSS px — тулбар партии (52 px, кнопка сайдбара В нём, перед заголовком, без наложения), поле по центру
 *     области контента размером min(720, окно − 124, ширина области − 96), инспектор справа во всю высоту шириной
 *     clamp(260, 20vw, 320): время/остаток, панель 3 × 3, действия с чипами клавиш, шпаргалка только от высоты 800;
 *     инспектор не прокручивается; поле не под сайдбаром и не под инспектором; нет горизонтальной прокрутки;
 *   - контраст каждого видимого текста тулбара и инспектора по computed-цветам ≥ 4.5:1;
 *   - ниже (ноутбук при 125/150 %) — PD-268 (сведение PD-290): компакт C — та же раскладка (тулбар партии, поле, инспектор),
 *     без сайдбара и таб-бара, кнопка «Show sidebar» в тулбаре (до PD-268 тут была прежняя колонка — ожидание устарело).
 * flow — 1440×900@100, 1280×800@100 (тёмная), 1920×1080@150: клавиатура без клика (стрелка, цифра, N, ⌘/Ctrl+Z, Esc),
 *   клик по панели 3 × 3; лампочка → шит правила подсказки в области контента (сайдбар не накрыт) → Enter → док в инспекторе,
 *   поле не сдвинулось; правый клик по Notes → шит Fill в области контента; режим из сайдбара → Start → партия Play: ⋯ — меню
 *   под кнопкой (не над инспектором), «Новая сетка» → шит режима в области контента; хаб → правый клик по режиму → Delete →
 *   тост в области контента, не над сайдбаром; скрыть сайдбар кнопкой в тулбаре → поле по центру всей ширины; кнопка в шапке
 *   Year, Settings и архивного дня; Tab по тулбару и инспектору — фокус видим и в окне.
 * phone — 393×852 (свет/тьма), 320×568, 852×393 (touch, DPR 3): Today, хаб Play, партия Classic, Year, Settings — кадр ветки
 *   = кадр main попиксельно (часы под маской) и одинаковое DOM-дерево. Компакт ноутбука (1024×640 / 853×533 / 960×600) после
 *   PD-268 НЕ равен main (это раскладка C без сайдбара) — из попиксельного набора убран, его проверяют desk (выше), pd268 и pd290.
 *   (было: кадр ветки = кадр main попиксельно (часы под
 *   маской) и одинаковое DOM-дерево (теги, классы, роли, aria, data-testid).
 * Кадры — design/pd267-shots/; итог — PASS/FAIL построчно и сводка в design/pd267-shots/results-<части>-<браузеры>.json.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd267-shots");
const PORT = +(process.env.PORT ?? 5371);
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
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
  // PD-290: под нагрузкой проявление панели 1–9 (fadeRise, `.play-in`, fill backwards) ещё идёт через 500 мс — её подписи с
  // opacity < 1 выпадали из подсчёта контраста (n = 11 вместо 29 на случайном размере в WebKit). Ждём конца анимаций.
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), null, { timeout: 10000 }).catch(() => {});
  return { ctx, p, errs };
}

// ---------- замеры на странице ----------
/** Геометрия партии десктопа: сайдбар, тулбар, кнопка, поле, инспектор, клавиши; контраст текстов тулбара и инспектора. */
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
    const board = scope?.querySelector(".board");
    const insp = scope?.querySelector(".desk-insp");
    const keys = insp ? [...insp.querySelectorAll(".pad .key")].map((k) => r(k)) : [];
    const acts = insp ? [...insp.querySelectorAll(".actions .act")].map((a) => ({ label: a.getAttribute("aria-label"), kbd: a.querySelector("kbd")?.textContent ?? null, ks: a.getAttribute("aria-keyshortcuts") })) : [];
    const texts = [];
    const textEls = [...(insp?.querySelectorAll("dt, dd, .status, .source, .act > span, kbd, .insp-keys h3, .insp-keys li > span:last-child, .key .kd, .key .kr") ?? []), ...(tb?.querySelectorAll(".title, .subline > span:not(.sep):not(.mode-chip), .subline .chip-t") ?? [])];
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
    return {
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
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
      toggles: document.querySelectorAll(".side-toggle").length,
      title: r(title),
      board: r(board),
      cells: board ? board.querySelectorAll("button.cell").length : 0,
      insp: vis(insp) ? r(insp) : null,
      inspScrolls: insp ? insp.scrollHeight > insp.clientHeight + 1 : false,
      keys,
      acts,
      meta: insp ? [...insp.querySelectorAll(".insp-meta dd")].map((d) => d.textContent) : [],
      legend: vis(insp?.querySelector(".insp-keys")),
      legendRect: r(insp?.querySelector(".insp-keys")),
      dock: vis(insp?.querySelector(".hint-dock")),
      texts,
      hash: location.hash,
    };
  });
}

const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;
const inside = (r, m) => r && r.left >= -0.5 && r.top >= -0.5 && r.right <= m.vw + 0.5 && r.bottom <= m.vh + 0.5;
const box = (r) => r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
const deskX = (m) => (m.sideShown ? m.side.right + 8 : 0);
const inspW = (vw) => Math.min(320, Math.max(260, vw * 0.2));

function deskPartyChecks(tag, m) {
  check(`${tag}: раскладка — тулбар партии + инспектор (не колонка телефона)`, m.deskPlay && m.tbDesk && !!m.insp && !m.gapShown && !m.tabbarShown, { deskPlay: m.deskPlay, tbDesk: m.tbDesk, insp: !!m.insp, gap: m.gapShown });
  check(`${tag}: нет горизонтальной прокрутки`, m.scrollW <= m.vw, { scrollW: m.scrollW, vw: m.vw });
  check(`${tag}: тулбар 52 px над полем, слева от инспектора`, m.tb && near(m.tb.height, 52, 1) && m.board.top >= m.tb.bottom && m.tb.right <= m.insp.left + 0.5 && near(m.tb.left, deskX(m), 1), { tb: box(m.tb) });
  check(`${tag}: кнопка сайдбара — в тулбаре, перед заголовком, без наложения; одна на экране`, m.toggle && m.toggleInTb && m.toggle.right <= m.title.left && m.toggle.left >= deskX(m) && m.toggle.top >= m.tb.top - 0.5 && m.toggle.bottom <= m.tb.bottom + 0.5, { toggle: box(m.toggle), titleLeft: m.title && Math.round(m.title.left) });
  const stageW = m.insp.left - deskX(m);
  const want = Math.min(720, m.vh - 124, stageW - 96);
  check(`${tag}: поле 81 клетка, квадратное, min(720, окно − 124, область − 96) = ${Math.round(want)}`, m.cells === 81 && near(m.board.width, m.board.height) && near(m.board.width, want, 1.5) && inside(m.board, m), { board: box(m.board), want: Math.round(want) });
  check(`${tag}: поле по центру области контента, не под сайдбаром и не под инспектором`, near((m.board.left + m.board.right) / 2, deskX(m) + stageW / 2, 1.5) && m.board.left >= deskX(m) && m.board.right <= m.insp.left, { center: Math.round((m.board.left + m.board.right) / 2), want: Math.round(deskX(m) + stageW / 2) });
  check(`${tag}: инспектор справа во всю высоту, ширина clamp(260, 20vw, 320), без прокрутки`, near(m.insp.right, m.vw, 1) && near(m.insp.top, 0, 1) && near(m.insp.bottom, m.vh, 1) && near(m.insp.width, inspW(m.vw), 1) && !m.inspScrolls, { insp: box(m.insp), want: Math.round(inspW(m.vw)), scrolls: m.inspScrolls });
  const xs = [...new Set(m.keys.map((k) => Math.round(k.left)))];
  const ys = [...new Set(m.keys.map((k) => Math.round(k.top)))];
  check(`${tag}: панель 3 × 3 (9 клавиш, ≥ 44 px), в инспекторе`, m.keys.length === 9 && xs.length === 3 && ys.length === 3 && m.keys.every((k) => k.height >= 44 && k.left >= m.insp.left && k.right <= m.insp.right), { keys: m.keys.length, cols: xs.length, rows: ys.length, h: m.keys[0] && Math.round(m.keys[0].height) });
  const ks = m.acts.map((a) => a.kbd);
  check(`${tag}: действия с чипами клавиш N / ⌘Z|Ctrl+Z / ⌫ и aria-keyshortcuts`, m.acts.length === 3 && ks[0] === "N" && /^(⌘Z|Ctrl\+Z)$/.test(ks[1] ?? "") && ks[2] === "⌫" && m.acts.every((a) => a.ks), { acts: m.acts });
  check(`${tag}: время и остаток в инспекторе`, m.meta.length === 2 && /^\d+:\d\d$/.test(m.meta[0]) && /^\d+ cells?$/.test(m.meta[1]), { meta: m.meta });
  check(`${tag}: шпаргалка клавиш — только от высоты 800 (${m.vh})`, m.legend === m.vh >= 800 && (!m.legend || m.legendRect.bottom <= m.vh - 19), { legend: m.legend });
  const low = m.texts.filter((x) => x.ratio < (x.large ? 3 : 4.5));
  check(`${tag}: контраст текстов тулбара и инспектора ≥ 4.5:1`, m.texts.length >= 20 && low.length === 0, { n: m.texts.length, min: Math.min(...m.texts.map((x) => x.ratio)), low });
}

// PD-290: компакт после PD-268 — раскладка C без сайдбара: те же проверки партии (deskX = 0), плюс класс оболочки и «Show sidebar».
function compactChecks(tag, m) {
  check(`${tag}: компакт C — .shell.desk.compact, без сайдбара и таб-бара, кнопка «Show sidebar» в тулбаре`, /^shell desk compact\b/.test(m.shellClass) && !m.sideShown && !m.tabbarShown && m.toggleInTb && m.toggleLabel === "Show sidebar", { shell: m.shellClass, side: m.sideShown, tabbar: m.tabbarShown, label: m.toggleLabel });
  deskPartyChecks(tag, m);
}

const WINDOWS = [[1280, 800], [1440, 900], [1920, 1080]];
const ZOOMS = [100, 125, 150];
const css = (W, H, z) => [Math.round(W / (z / 100)), Math.round(H / (z / 100))];
const isDesk = (w, h) => w >= 1100 && h >= 680;

async function runDesk(browser, BR, NEW) {
  for (const [W, H] of WINDOWS)
    for (const z of ZOOMS)
      for (const scheme of z === 100 ? ["light", "dark"] : ["light"]) {
        const [w, h] = css(W, H, z);
        const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
        const tag = `${BR} ${W}x${H}@${z} ${scheme} (${w}x${h})`;
        const m = await measure(p);
        if (isDesk(w, h)) deskPartyChecks(tag, m);
        else compactChecks(tag, m);
        check(`${tag}: без ошибок JS`, errs.length === 0, { errs });
        await p.screenshot({ path: path.join(OUT, `${BR}-${W}x${H}-z${z}-${scheme}-today.png`) });
        await ctx.close();
      }
}

/** Прямоугольник элемента (или null). */
const rect = (p, sel) => p.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null, sel);

async function runFlow(browser, BR, NEW) {
  for (const [W, H, z, scheme] of [[1440, 900, 100, "light"], [1280, 800, 100, "dark"], [1920, 1080, 150, "light"]]) {
    const [w, h] = css(W, H, z);
    const T = `${BR} flow ${W}x${H}@${z} ${scheme}`;
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW });
    const pane = ".tab-pane:not(.off)";
    const settle = (ms = 450) => p.waitForTimeout(ms);
    const shot = (name) => p.screenshot({ path: path.join(OUT, `${BR}-flow-${W}x${H}-z${z}-${scheme}-${name}.png`) });
    const left = async () => (await p.locator(`${pane} [data-testid="insp-left"]`).textContent()).trim();
    const mod = BR === "wk" ? "Meta" : "Control";

    // 1. Клавиатура без клика по клетке: фокус на <body> → стрелка выбирает клетку, цифра ставится, N — заметки, ⌘/Ctrl+Z, Esc.
    let m = await measure(p);
    const side = m.side;
    const left0 = await left();
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press("ArrowRight");
    const selAfterArrow = await p.evaluate(() => document.activeElement?.dataset?.i ?? null);
    // Выбрать пустую клетку 2 (решение 4) мышью и поставить цифру клавишей.
    await p.locator(`${pane} .board [data-i="2"]`).click();
    await p.keyboard.press("Digit4");
    await settle(250);
    const left1 = await left();
    await p.keyboard.press("KeyN");
    const notesOn = await p.locator(`${pane} .desk-insp .act[aria-keyshortcuts="N"]`).getAttribute("aria-pressed");
    await p.keyboard.press("KeyN");
    await p.keyboard.press(`${mod}+KeyZ`);
    await settle(250);
    const left2 = await left();
    check(`${T}: клавиатура — стрелка выбирает, цифра ставится (${left0} → ${left1}), N — заметки, ${mod}+Z — отмена (${left2})`, selAfterArrow !== null && left1 !== left0 && notesOn === "true" && left2 === left0, { selAfterArrow, left0, left1, notesOn, left2 });

    // 2. Клик по панели 3 × 3 в инспекторе.
    await p.locator(`${pane} .board [data-i="2"]`).click();
    await p.locator(`${pane} .desk-insp .pad .key`).nth(3).click();
    await settle(250);
    const left3 = await left();
    check(`${T}: клик по клавише 4 панели 3 × 3 ставит цифру`, left3 === left1, { left3 });
    await p.keyboard.press(`${mod}+KeyZ`);
    await settle(200);

    // 3. Лампочка → шит правила подсказки в области контента (сайдбар не накрыт) → Enter → док в инспекторе, поле на месте.
    const board0 = await rect(p, `${pane} .board`);
    await p.locator(`${pane} [data-testid="hint-button"]`).click();
    await settle();
    let scrim = await rect(p, ".desk-layer [data-testid='hint-rule-scrim']");
    // Сайдбар под шитом inert (в hit-test его нет) — проверяем, что в его точке нет ничего из слоя окна (затемнения/шита).
    let sideHit = await p.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest(".desk-layer"), [side.left + side.width / 2, side.top + side.height / 2]);
    check(`${T}: шит правила подсказки — в слое окна, затемнение от края сайдбара, сайдбар не накрыт`, scrim && near(scrim.left, side.right + 8, 1) && near(scrim.right, m.vw, 1) && sideHit, { scrim: box(scrim), sideRight: Math.round(side.right), sideHit });
    const sideInert = await p.evaluate(() => document.querySelector(".sidebar")?.closest("[inert]") !== null);
    check(`${T}: пока шит открыт, сайдбар недоступен (inert) — модальность окна`, sideInert, {});
    await shot("1-hint-rule-sheet");
    await p.keyboard.press("Enter");
    await settle();
    m = await measure(p);
    const board1 = await rect(p, `${pane} .board`);
    check(`${T}: Enter → док подсказки в инспекторе вместо панели, поле не сдвинулось`, m.dock && m.keys.length === 0 && near(board0.top, board1.top, 0.5) && near(board0.width, board1.width, 0.5) && inside(m.insp, m), { dock: m.dock, keys: m.keys.length, board0: box(board0), board1: box(board1) });
    await shot("2-hint-dock");
    await p.keyboard.press("Escape");
    await settle();
    m = await measure(p);
    check(`${T}: Esc закрывает док — панель 3 × 3 снова в инспекторе`, !m.dock && m.keys.length === 9, { keys: m.keys.length });

    // 4. Правый клик по Notes → шит «Fill candidates» в области контента.
    await p.locator(`${pane} .desk-insp .act[aria-keyshortcuts="N"]`).click({ button: "right" });
    await settle();
    scrim = await rect(p, ".desk-layer [data-testid='action-sheet-scrim']");
    const sheet = await rect(p, ".desk-layer [data-testid='action-sheet']");
    check(`${T}: шит Fill — в области контента (затемнение от края сайдбара, шит правее сайдбара)`, scrim && near(scrim.left, side.right + 8, 1) && sheet.left >= side.right, { scrim: box(scrim), sheet: box(sheet) });
    await shot("3-fill-sheet");
    await p.keyboard.press("Escape");
    await settle();

    // 5. Режим из сайдбара → страница режима → Start → партия Play: тулбар, инспектор, ⋯ под кнопкой.
    await p.locator('[data-testid="side-mode-classic"]').click();
    await settle();
    await p.locator(`${pane} [data-testid="difficulty-easy"]`).click();
    await p.locator(`${pane} [data-testid="mode-page-start"]`).click();
    await p.waitForSelector(`${pane} .board button.cell`, { timeout: 40000 });
    await settle(700);
    await shot("4-play-party");
    m = await measure(p);
    deskPartyChecks(`${T} партия Play`, m);
    const more = await rect(p, `${pane} [data-testid="more-button"]`);
    await p.locator(`${pane} [data-testid="more-button"]`).click();
    await settle();
    const menu = await rect(p, ".desk-layer [data-testid='more-menu']");
    scrim = await rect(p, ".desk-layer [data-testid='more-scrim']");
    check(`${T}: меню ⋯ — под кнопкой (правый край по кнопке), не над инспектором; затемнение от сайдбара`, menu && near(menu.right, more.right, 2) && menu.top >= more.bottom && menu.right <= m.insp.left + 1 && near(scrim.left, side.right + 8, 1), { menu: box(menu), more: box(more), inspLeft: Math.round(m.insp.left) });
    await shot("5-more-menu");
    await p.locator(".desk-layer [data-testid='menu-new']").click();
    await settle();
    scrim = await rect(p, ".desk-layer [data-testid='mode-sheet-scrim']");
    const ms = await rect(p, ".desk-layer [data-testid='mode-sheet']");
    check(`${T}: «Новая сетка» → шит режима в области контента`, scrim && near(scrim.left, side.right + 8, 1) && ms.left >= side.right, { scrim: box(scrim), sheet: box(ms) });
    await shot("6-mode-sheet");
    await p.keyboard.press("Escape");
    await settle();

    // 6. Хаб → правый клик по Classic → Delete → тост в области контента, не над сайдбаром.
    await p.locator('[data-testid="side-play"]').click();
    await settle();
    await p.locator(`${pane} [data-testid="mode-classic"]`).click({ button: "right" });
    await settle();
    const ctxMenu = await rect(p, ".desk-layer [data-testid='ctx-menu']");
    check(`${T}: контекстное меню режима — правее сайдбара`, ctxMenu && ctxMenu.left >= side.right, { ctx: box(ctxMenu) });
    await p.locator(".desk-layer [data-testid='ctx-delete']").click();
    await settle();
    const toast = await rect(p, ".desk-layer [data-testid='undo-toast']");
    check(`${T}: тост «Отменить» — в области контента (≤ 560, по центру), низ сайдбара не перекрыт`, toast && toast.left >= side.right + 8 && toast.width <= 560.5 && toast.bottom <= m.vh && near((toast.left + toast.right) / 2, (side.right + 8 + m.vw) / 2, 1.5), { toast: box(toast), sideRight: Math.round(side.right) });
    await shot("7-undo-toast");
    await p.locator(".desk-layer [data-testid='undo-toast-action']").click();
    await settle();

    // 7. Скрыть сайдбар кнопкой в тулбаре партии → поле по центру всей ширины; показать.
    await p.locator('[data-testid="side-today"]').click();
    await settle();
    await p.locator(`${pane} [data-testid="sidebar-toggle"]`).click();
    await settle();
    m = await measure(p);
    deskPartyChecks(`${T} сайдбар скрыт`, m);
    check(`${T}: сайдбар скрыт — кнопка «Show sidebar» в тулбаре у левого края`, !m.sideShown && m.toggleLabel === "Show sidebar" && m.toggle.left < 20, { toggle: box(m.toggle) });
    await shot("8-side-hidden");
    await p.locator(`${pane} [data-testid="sidebar-toggle"]`).click();
    await settle();

    // 8. Кнопка сайдбара в шапке Year, Settings и архивного дня (одна видимая, в потоке шапки).
    await p.locator('[data-testid="side-year"]').click();
    await settle();
    m = await measure(p);
    check(`${T}: Year — кнопка в шапке, перед заголовком`, m.toggle && m.toggleInTb && m.toggle.right <= m.title.left, { toggle: box(m.toggle), title: box(m.title) });
    await p.locator(`${pane} [data-testid="open-settings"]`).click();
    await settle();
    m = await measure(p);
    check(`${T}: Settings — кнопка в навбаре, перед «‹»`, m.toggle && m.toggleInTb && m.toggle.right <= m.title.left && m.toggle.left >= side.right, { toggle: box(m.toggle), back: box(m.title) });
    await shot("9-settings");
    // Архивный день: профиль, начатый неделю назад (иначе архив до первого дня пользования закрыт), — отдельный контекст.
    {
      const a = await open(browser, { w, h, dpr: z / 100, scheme, base: NEW, now: new Date("2026-10-01T09:00:00Z") });
      await a.p.waitForTimeout(800);
      await a.ctx.clock.setFixedTime(NOW);
      // Только смена hash (маршрут приложения), без перезагрузки: WebKit пишет оборванные перезагрузкой запросы как ошибки.
      await a.p.goto(`${NEW}/#/day/2026-10-03`);
      await a.p.waitForSelector(".push-layer .board button.cell", { timeout: 40000 });
      await a.p.waitForTimeout(700);
      const am = await measure(a.p);
      deskPartyChecks(`${T} архив`, am);
      const backIn = await a.p.evaluate(() => !!document.querySelector(".push-layer .desk-tb [data-testid='archive-back']"));
      check(`${T}: архив — «‹ Year» в тулбаре партии`, backIn, {});
      await a.p.screenshot({ path: path.join(OUT, `${BR}-flow-${W}x${H}-z${z}-${scheme}-10-archive.png`) });
      check(`${T}: архив — без ошибок JS`, a.errs.length === 0, { errs: a.errs });
      await a.ctx.close();
    }

    // 9. Tab по тулбару и инспектору: фокус видим (кольцо) и в окне.
    await p.goto(`${NEW}/#/today`);
    await p.waitForSelector(`${pane} .board button.cell`, { timeout: 40000 });
    await settle(600);
    await p.locator(`${pane} [data-testid="sidebar-toggle"]`).focus();
    const seen = [];
    for (let i = 0; i < 16; i++) {
      const f = await p.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const r = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        // Клетка поля показывает фокус кольцом выбора (play.css: `.cell:focus-visible { outline: none }`), а не outline.
        const cellRing = a.matches(".cell") && a.classList.contains("sel");
        return { id: a.dataset.testid ?? a.getAttribute("aria-label") ?? a.className, r: [r.left, r.top, r.right, r.bottom], ring: cellRing || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) };
      });
      // Первая остановка — программный focus() (без :focus-visible после мыши); дальше — только Tab.
      if (f && i > 0) seen.push(f);
      await p.keyboard.press("Tab");
    }
    const bad = seen.filter((f) => !f.ring || f.r[0] < -0.5 || f.r[1] < -0.5 || f.r[2] > m.vw + 0.5 || f.r[3] > m.vh + 0.5);
    check(`${T}: Tab — фокус с кольцом и в окне (${seen.length} остановок)`, seen.length >= 8 && bad.length === 0, { stops: seen.map((f) => f.id).slice(0, 16), bad });
    await shot("11-focus");

    // 10. Решить день до конца с клавиатуры: PD-268 (сведение PD-290) — поле остаётся, карточка «решено» в инспекторе
    //     (до PD-268 ожидалась прежняя карточка без инспектора — устарело); тулбар тот же, нет горизонтальной прокрутки.
    const SOL = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
    for (let i = 0; i < 81; i++) {
      if (MISSION[i] !== "0") continue;
      await p.locator(`${pane} .board [data-i="${i}"]`).click();
      await p.keyboard.press(`Digit${SOL[i]}`);
    }
    await p.waitForSelector(`${pane} [data-testid="result-card"], ${pane} .card`, { timeout: 15000 });
    await settle(900);
    m = await measure(p);
    const card = await rect(p, `${pane} .desk-insp .card`);
    check(`${T}: решено — тулбар партии с кнопкой, поле на месте, карточка в инспекторе (PD-268)`, m.tbDesk && m.toggleInTb && m.deskPlay && !!m.insp && m.cells === 81 && card && card.left >= m.insp.left - 0.5 && card.right <= m.insp.right + 0.5 && m.scrollW <= m.vw, { card: box(card), insp: box(m.insp) });
    await shot("12-solved");
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
  // [w, h, scheme, dpr, touch, имя]: телефон (касание, DPR 3) и компакт ноутбука при 125/150 % (мышь, DPR = масштаб).
  const SETS = [
    [393, 852, "light", 3, true, "phone"],
    [393, 852, "dark", 3, true, "phone"],
    [320, 568, "light", 3, true, "phone"],
    [852, 393, "light", 3, true, "phone"],
    // PD-290: компакт ноутбука 1024×640 / 853×533 / 960×600 убран — после PD-268 это раскладка C, не main.
  ];
  // Растр при дробном DPR (1.25/1.5) и под нагрузкой машины недетерминирован: main против самого себя даёт 1–2 px, изредка
  // десятки–сотни px на одной линии. Поэтому набор снимается до 3 раз, и кадр засчитывается по ЛУЧШЕЙ попытке (сколько
  // понадобилось — в отчёте); DOM обязан совпасть в КАЖДОЙ попытке.
  for (const [w, h, scheme, dpr, touch, kind] of SETS) {
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
          const buf = await p.screenshot({ mask: [p.locator(".subline .clock")], maskColor: "#f0f" });
          (pics[screen] ??= {})[k] = buf;
          (doms[screen] ??= {})[k] = await domSig(p);
          if (attempt === 1 && ((w === 393 && scheme === "light") || w === 1024)) fs.writeFileSync(path.join(OUT, `${BR}-${kind}-${w}x${h}-${scheme}-${screen}-${k}.png`), buf);
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
        const n = await diff(pics[screen].base, pics[screen].new);
        if (best[screen] === undefined || (n >= 0 && n < best[screen]) || best[screen] < 0) best[screen] = n;
        if (best[screen] === 0 && tries[screen] === undefined) tries[screen] = attempt;
        domOk[screen] = (domOk[screen] ?? true) && doms[screen].base === doms[screen].new;
      }
      if (Object.values(best).every((n) => n === 0)) break;
    }
    for (const screen of Object.keys(best)) {
      check(`${BR} ${kind} ${w}x${h} ${scheme} ${screen}: кадр = main`, best[screen] === 0, { diffPx: best[screen], attempt: tries[screen] ?? null });
      check(`${BR} ${kind} ${w}x${h} ${scheme} ${screen}: DOM = main`, domOk[screen], {});
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
