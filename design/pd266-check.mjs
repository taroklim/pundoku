/**
 * PD-266 — десктоп C «Сайдбар», оболочка: живая проверка на РЕАЛЬНОЙ сборке + «телефон не изменился» попиксельно против main.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd266-dist                 (ветка pd-desk-c)
 *   (worktree на main) npx vite build --outDir /tmp/pd266-base             (эталон телефона; нужен только для `phone`)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd266-dist BASE_DIST=/tmp/pd266-base PORT=5366 \
 *     node design/pd266-check.mjs [desk] [flow] [phone] [chromium] [webkit] [firefox]     (без аргументов — всё, cr + wk + ff)
 *   Firefox — если он есть в установке Playwright (иначе печатается SKIP, не FAIL).
 *
 * Масштаб браузера эмулируется как в аудите PD-228: вьюпорт = окно ÷ масштаб, DPR = масштаб.
 *
 * desk — матрица окон 1280×800 / 1440×900 / 1920×1080 × 100/125/150 % (светлая) + 100 % тёмная; экран Today. Проверки:
 *   - раскладка по CSS px: от 1100 × 680 сайдбар (таб-бар скрыт), ниже — прежняя оболочка (таб-бар, без сайдбара и кнопки);
 *   - сайдбар целиком в окне и не прокручивается; контент правее сайдбара; поле 81 клетка, квадратное, в окне, не под сайдбаром;
 *   - кнопка сайдбара не наезжает на заголовок; нет горизонтальной прокрутки;
 *   - контраст каждого текста сайдбара по computed-цветам со смешиванием стекла ≥ 4.5:1;
 *   - фолбэк стекла: prefers-contrast: more → непрозрачная `--glass-solid`, без backdrop-filter.
 * flow — 1440×900 (и 1920×1080 @150 = 1280×720): Today → Year → режим без партии (страница режима) → «Start» → доска режима,
 *   «In progress» в сайдбаре → Today → тот же режим (доска, не страница) → Play (хаб) → Settings (ничего не выбрано) → Today;
 *   стрелки по сайдбару; скрыть → перезагрузка → скрыт, контент от левого края → показать; сузить окно до 1024×640 → таб-бар.
 * phone — 393×852 (свет/тьма), 320×568, 852×393 (ландшафт), touch + DPR 3: Today, хаб Play, партия Classic, Year, Settings
 *   — кадр ветки = кадр main попиксельно (часы партии под маской) и одинаковое DOM-дерево (теги, классы, роли, aria).
 * Кадры — design/pd266-shots/. Браузеры и серверы закрываются в finally; итог — PASS/FAIL построчно и сводка
 * в design/pd266-shots/results-<части>-<браузеры>.json.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
const OUT = path.join(HERE, "pd266-shots");
const PORT = +(process.env.PORT ?? 5366);
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
  results[name] = { ok, ...detail };
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail));
};

async function open(browser, { w, h, dpr = 1, scheme = "light", route = "today", base, touch = false, contrast = null }) {
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
  if (contrast) await p.emulateMedia({ contrast });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/#/${route}`);
  if (route === "today") await p.waitForSelector(".tab-pane:not(.off) .board button.cell", { timeout: 40000 });
  else await p.waitForTimeout(600);
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}

// ---------- замеры на странице ----------
/** Геометрия оболочки, поля, сайдбара, кнопки, заголовка; контраст текстов сайдбара со смешиванием фонов. */
async function measure(p) {
  return p.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.hidden && el.getBoundingClientRect().width > 0;
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
    const shell = document.querySelector(".shell");
    const side = document.querySelector(".sidebar");
    const pane = document.querySelector(".tab-pane:not(.off)");
    const board = pane?.querySelector(".board");
    const title = (document.querySelector(".push-layer") ?? pane)?.querySelector(".toolbar .title, .settings-navbar .settings-back");
    const texts = [];
    if (vis(side))
      for (const el of side.querySelectorAll(".side-lab, .side-meta")) {
        const fg = parse(getComputedStyle(el).color);
        const bg = bgOf(el);
        texts.push({ t: el.textContent, ratio: +ratio(over(fg, bg), bg).toFixed(2) });
      }
    const sideCs = side ? getComputedStyle(side) : null;
    return {
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      shellClass: shell?.className,
      tabbarShown: vis(document.querySelector(".tabbar")),
      sideShown: vis(side),
      side: vis(side) ? r(side) : null,
      sideScrolls: side ? side.scrollHeight > side.clientHeight + 1 : false,
      sideBg: sideCs?.backgroundColor,
      sideFilter: sideCs ? sideCs.backdropFilter || sideCs.webkitBackdropFilter || "none" : null,
      toggle: vis(document.querySelector(".side-toggle")) ? r(document.querySelector(".side-toggle")) : null,
      toggleLabel: document.querySelector(".side-toggle")?.getAttribute("aria-label") ?? null,
      title: r(title),
      stack: r(document.querySelector(".stack")),
      board: r(board),
      cells: board ? board.querySelectorAll("button.cell").length : 0,
      current: [...document.querySelectorAll('.sidebar [aria-current="page"]')].map((e) => e.dataset.testid),
      texts,
      hash: location.hash,
    };
  });
}

const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;
const inside = (r, m) => r && r.left >= -0.5 && r.top >= -0.5 && r.right <= m.vw + 0.5 && r.bottom <= m.vh + 0.5;

function deskChecks(tag, m, { expectDesk }) {
  check(`${tag}: раскладка ${expectDesk ? "с сайдбаром" : "прежняя (таб-бар)"}`, expectDesk ? m.sideShown && !m.tabbarShown && m.shellClass === "shell desk" : !m.sideShown && m.tabbarShown && m.shellClass === "shell" && !m.toggle, { shell: m.shellClass, side: m.sideShown, tabbar: m.tabbarShown, css: `${m.vw}x${m.vh}` });
  check(`${tag}: нет горизонтальной прокрутки`, m.scrollW <= m.vw, { scrollW: m.scrollW, vw: m.vw });
  check(`${tag}: поле 81 клетка, квадратное, в окне`, m.cells === 81 && near(m.board.width, m.board.height) && inside(m.board, m), { cells: m.cells, board: m.board && [Math.round(m.board.left), Math.round(m.board.top), Math.round(m.board.width), Math.round(m.board.height)] });
  if (!expectDesk) return;
  check(`${tag}: сайдбар в окне, без прокрутки`, inside(m.side, m) && !m.sideScrolls, { side: m.side && [Math.round(m.side.left), Math.round(m.side.top), Math.round(m.side.width), Math.round(m.side.height)], scrolls: m.sideScrolls });
  check(`${tag}: контент и поле правее сайдбара`, m.stack.left >= m.side.right - 0.5 && m.board.left >= m.side.right, { stackLeft: Math.round(m.stack.left), boardLeft: Math.round(m.board.left), sideRight: Math.round(m.side.right) });
  check(`${tag}: кнопка сайдбара не наезжает на заголовок`, m.toggle && m.title && m.toggle.right <= m.title.left && m.toggle.left >= m.side.right, { toggle: m.toggle && [Math.round(m.toggle.left), Math.round(m.toggle.right)], titleLeft: m.title && Math.round(m.title.left) });
  const low = m.texts.filter((x) => x.ratio < 4.5);
  check(`${tag}: контраст текстов сайдбара ≥ 4.5:1`, m.texts.length >= 9 && low.length === 0, { n: m.texts.length, min: Math.min(...m.texts.map((x) => x.ratio)), low });
  check(`${tag}: стекло (backdrop-filter) на сайдбаре`, /blur/.test(m.sideFilter), { filter: m.sideFilter, bg: m.sideBg });
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
        deskChecks(tag, m, { expectDesk: isDesk(w, h) });
        if (isDesk(w, h)) check(`${tag}: Today выбран в сайдбаре`, m.current.join() === "side-today", { current: m.current });
        check(`${tag}: без ошибок JS`, errs.length === 0, { errs });
        await p.screenshot({ path: path.join(OUT, `${BR}-${W}x${H}-z${z}-${scheme}-today.png`) });
        await ctx.close();
      }
  // Фолбэк стекла: Increase Contrast → непрозрачная заливка без размытия (как у таб-бара).
  for (const scheme of ["light", "dark"]) {
    const { ctx, p } = await open(browser, { w: 1440, h: 900, scheme, base: NEW, contrast: "more" });
    const m = await measure(p);
    const solid = scheme === "light" ? "rgb(246, 246, 249)" : "rgb(20, 20, 22)";
    check(`${BR} 1440x900 ${scheme} contrast:more: сайдбар непрозрачный (--glass-solid), без размытия`, m.sideBg === solid && !/blur/.test(m.sideFilter), { bg: m.sideBg, filter: m.sideFilter });
    const low = m.texts.filter((x) => x.ratio < 4.5);
    check(`${BR} 1440x900 ${scheme} contrast:more: контраст ≥ 4.5:1`, low.length === 0, { min: Math.min(...m.texts.map((x) => x.ratio)) });
    await p.screenshot({ path: path.join(OUT, `${BR}-1440x900-${scheme}-contrast-more.png`) });
    await ctx.close();
  }
}

async function runFlow(browser, BR, NEW) {
  for (const [W, H, z] of [[1440, 900, 100], [1920, 1080, 150]]) {
    const [w, h] = css(W, H, z);
    const T = `${BR} flow ${W}x${H}@${z}`;
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, base: NEW });
    const side = (id) => p.locator(`[data-testid="${id}"]`);
    const settle = () => p.waitForTimeout(450);
    const shot = (name) => p.screenshot({ path: path.join(OUT, `${BR}-flow-${W}x${H}-z${z}-${name}.png`) });

    await side("side-year").click();
    await settle();
    let m = await measure(p);
    check(`${T}: Year из сайдбара`, m.hash === "#/year" && m.current.join() === "side-year" && (await p.locator(".tab-pane:not(.off)[data-tab=year]").count()) === 1, { hash: m.hash, current: m.current });
    await shot("1-year");

    await side("side-mode-glyphs").click();
    await settle();
    m = await measure(p);
    const page = p.locator('.tab-pane:not(.off) [data-testid="mode-page"]');
    check(`${T}: режим без партии → страница режима`, m.hash === "#/play" && (await page.count()) === 1 && (await page.getAttribute("data-mode")) === "glyphs" && m.current.join() === "side-mode-glyphs", { hash: m.hash, current: m.current });
    const pr = await page.boundingBox();
    check(`${T}: страница режима — колонка ≤ 480, правее сайдбара, в окне`, pr.width <= 480.5 && pr.x >= m.side.right && pr.x + pr.width <= m.vw, { page: [Math.round(pr.x), Math.round(pr.width)] });
    await shot("2-mode-page");

    await page.locator('[data-testid="difficulty-easy"]').click();
    await p.locator('.tab-pane:not(.off) [data-testid="mode-page-start"]').click();
    await p.waitForSelector(".tab-pane:not(.off) .board button.cell", { timeout: 40000 });
    await settle();
    m = await measure(p);
    const meta = await side("side-mode-glyphs").locator(".side-meta").textContent().catch(() => null);
    check(`${T}: «Start» → доска режима, режим выбран, «In progress»`, m.cells === 81 && m.current.join() === "side-mode-glyphs" && meta === "In progress" && inside(m.board, m) && m.board.left >= m.side.right, { cells: m.cells, current: m.current, meta });
    await shot("3-board");

    await side("side-today").click();
    await settle();
    await side("side-mode-glyphs").click();
    await settle();
    m = await measure(p);
    check(`${T}: режим с партией → снова доска (не страница)`, m.cells === 81 && (await page.count()) === 0 && m.current.join() === "side-mode-glyphs", { cells: m.cells, current: m.current });

    await side("side-play").click();
    await settle();
    m = await measure(p);
    const hubRows = await p.locator('.tab-pane:not(.off) [data-testid="mode-classic"]').count();
    check(`${T}: Play → хаб (строки режимов), выбран Play`, hubRows === 1 && m.current.join() === "side-play", { hubRows, current: m.current });
    await shot("4-hub");

    await p.locator('.tab-pane:not(.off) [data-testid="open-settings"]').click();
    await settle();
    m = await measure(p);
    check(`${T}: Settings — ни один пункт не выбран, экран правее сайдбара`, m.hash === "#/settings" && m.current.length === 0 && m.title && m.title.left >= m.toggle.right, { hash: m.hash, current: m.current });
    await shot("5-settings");
    await side("side-today").click();
    await settle();
    m = await measure(p);
    check(`${T}: из Settings сайдбаром на Today`, m.hash === "#/today" && m.current.join() === "side-today", { hash: m.hash });

    // Клавиатура: ↓ от Today — на Play, End — на Year.
    await side("side-today").focus();
    await p.keyboard.press("ArrowDown");
    const f1 = await p.evaluate(() => document.activeElement?.dataset.testid);
    await p.keyboard.press("End");
    const f2 = await p.evaluate(() => document.activeElement?.dataset.testid);
    check(`${T}: стрелки по сайдбару`, f1 === "side-play" && f2 === "side-year", { f1, f2 });

    // Скрытие запоминается: перезагрузка — скрыт; контент от левого края; показать — вернулся.
    await p.locator('[data-testid="sidebar-toggle"]').click();
    await settle();
    m = await measure(p);
    check(`${T}: скрыть — сайдбара нет, контент с левого края, кнопка «Show sidebar»`, !m.sideShown && m.stack.left === 0 && m.toggleLabel === "Show sidebar" && m.title.left >= m.toggle.right && inside(m.board, m), { stackLeft: m.stack.left, label: m.toggleLabel });
    await shot("6-hidden");
    await p.reload();
    await p.waitForSelector(".tab-pane:not(.off) .board button.cell", { timeout: 40000 });
    await settle();
    m = await measure(p);
    check(`${T}: после перезагрузки сайдбар по-прежнему скрыт`, !m.sideShown && m.shellClass === "shell desk side-off", { shell: m.shellClass });
    await p.locator('[data-testid="sidebar-toggle"]').click();
    await settle();
    m = await measure(p);
    check(`${T}: показать — сайдбар на месте`, m.sideShown && m.toggleLabel === "Hide sidebar", { label: m.toggleLabel });

    // Окно сузили до компакта (как 1280×800 при 125 %) — прежняя оболочка; расширили — сайдбар.
    await p.setViewportSize({ width: 1024, height: 640 });
    await settle();
    m = await measure(p);
    check(`${T}: сузили до 1024×640 — таб-бар, без сайдбара`, !m.sideShown && m.tabbarShown && m.shellClass === "shell", { shell: m.shellClass });
    await p.locator("#tab-play").click();
    await settle();
    check(`${T}: на компакте таб-бар работает`, (await p.evaluate(() => location.hash)) === "#/play", {});
    await p.setViewportSize({ width: w, height: h });
    await settle();
    m = await measure(p);
    check(`${T}: расширили — сайдбар, выбран Play/режим`, m.sideShown && !m.tabbarShown && m.current.length === 1, { current: m.current });
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
  for (const [w, h, scheme] of [[393, 852, "light"], [393, 852, "dark"], [320, 568, "light"], [852, 393, "light"]]) {
    const pics = {};
    const doms = {};
    for (const [k, base] of [["base", OLD], ["new", NEW]]) {
      const { ctx, p } = await open(browser, { w, h, dpr: 3, scheme, base, touch: true });
      const take = async (screen) => {
        await p.waitForTimeout(500);
        const buf = await p.screenshot({ mask: [p.locator(".subline .clock")], maskColor: "#f0f" });
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
      const n = await diff(pics[screen].base, pics[screen].new);
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: кадр = main`, n === 0, { diffPx: n });
      check(`${BR} phone ${w}x${h} ${scheme} ${screen}: DOM = main`, doms[screen].base === doms[screen].new, { len: doms[screen].new.length });
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
