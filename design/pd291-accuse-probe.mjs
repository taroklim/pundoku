/**
 * PD-291 — живая проверка фикса `openAccuse(cell, null)` (PlayScreen.tsx). Основа — проба PD-290 (`pd290-accuse-probe.mjs`,
 * ветка pd-desk-c-all): клавиша A и «⋯ → Обвинить» искали клетку через `document.querySelector('.board [data-i="N"]')` и
 * находили первую доску в DOM — поле Today / Grid ∞ из скрытой панели. Фикс ищет клетку на экране Play.
 *
 *   PD_PW_HOME=<playwright> [DIST=apps/web/dist] [LABEL=pd291] PORT=5412 node design/pd291-accuse-probe.mjs [chromium|webkit]
 *
 * Сценарий — как у живого игрока: старт на Today (панель Today смонтирована; «open» — день начат, «solved» — решён), переход
 * в Play → Лжец → партия, выбрать подсказку → (1) A, (2) «⋯ → Обвинить», (3) правый клик по клетке (эталон: el передан явно).
 * PASS строки = копия клетки (`.liar-lift`) на выбранной клетке активной панели (±1 px) И меню целиком в окне И после Esc
 * фокус на той же клетке панели Play (не <body>, не клетка Today). Телефон 393×852 (touch) и десктоп 1440×900;
 * COMPACT=1 — плюс компакт C 1024×640 @125 % (сайдбар через «Show sidebar»).
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const LABEL = process.env.LABEL ?? "pd291";
const PORT = +(process.env.PORT ?? 5412);
const OUT = path.join(HERE, "pd291-shots");
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const brs = process.argv.slice(2).filter((a) => ["chromium", "webkit"].includes(a));
const browsers = brs.length ? brs : ["chromium"];
fs.mkdirSync(OUT, { recursive: true });

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

const rows = [];
const P = ".tab-pane:not(.off)";
const settle = (p, ms = 500) => p.waitForTimeout(ms);

async function probe(p) {
  return p.evaluate(() => {
    const R = (e) => (e ? (({ left, top, width, height }) => [Math.round(left), Math.round(top), Math.round(width), Math.round(height)])(e.getBoundingClientRect()) : null);
    const active = document.querySelector('.tab-pane:not(.off) .board button.cell[aria-current="true"]') ?? document.querySelector(".tab-pane:not(.off) .board button.cell.sel");
    const lift = document.querySelector(".liar-lift");
    const menu = document.querySelector('[data-testid="accuse-menu"]');
    const first = document.querySelector(".board [data-i]");
    const pane = (e) => e?.closest(".tab-pane")?.getAttribute("data-tab") ?? e?.closest(".tab-pane")?.id ?? null;
    return { cell: R(active), cellI: active?.dataset.i ?? null, lift: R(lift), menu: R(menu), firstBoardPane: pane(first), activePane: pane(active) };
  });
}

async function run(browser, BR, base) {
  // today: «open» — день начат (поле Today в скрытой панели), «solved» — день решён (в панели Today карточка и Grid ∞).
  // COMPACT=1 — плюс компакт C 1024×640 при масштабе 125 % (DPR 1.25, сайдбар скрыт — показывается кнопкой), как в pd290-check.
  const cases = [["phone", 393, 852, true, "open"], ["phone", 393, 852, true, "solved"], ["desk", 1440, 900, false, "open"], ["desk", 1440, 900, false, "solved"]];
  if (process.env.COMPACT === "1") cases.push(["compact", 1024, 640, false, "open"], ["compact", 1024, 640, false, "solved"]);
  for (const [kind, w, h, touch, today] of cases) {
    const name = browser.browserType().name();
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 3 : kind === "compact" ? 1.25 : 1, isMobile: touch && name !== "firefox", hasTouch: touch, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce", serviceWorkers: "block" });
    await ctx.clock.setFixedTime(NOW);
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    try {
      await p.goto(`${base}/#/today`);
      await p.waitForSelector(`${P} .board button.cell`, { timeout: 40000 });
      await settle(p, 800);
      if (today === "solved") {
        for (let i = 0; i < 81; i++)
          if (MISSION[i] === "0") {
            await p.locator(`${P} .board button.cell[data-i="${i}"]`).click();
            await p.keyboard.press(`Digit${SOLUTION[i]}`);
          }
        await p.waitForSelector(`${P} [data-testid="grid-inf-section"]`, { timeout: 20000 });
        await settle(p, 1200);
      }
      // В Play → Лжец (на main и в портрете — таб-бар и шит режима; в раскладке C — сайдбар и страница режима).
      if (kind === "compact") {
        await p.locator('[data-testid="sidebar-toggle"]:visible').first().click();
        await settle(p, 300);
      }
      if (!(await p.locator('[data-testid="side-mode-liar"]').count())) {
        await p.locator(".tabbar .tab").nth(1).click();
        await p.waitForSelector('[data-testid="hub-modes"]', { timeout: 20000 });
        await settle(p, 600);
        await p.locator('[data-testid="mode-liar"]').click();
        await p.locator('[data-testid="mode-sheet"]').waitFor();
        await settle(p, 600);
        await p.keyboard.press("Enter");
      } else {
        await p.locator('[data-testid="side-mode-liar"]').click();
        await settle(p, 600);
        const start = p.locator(`${P} [data-testid="mode-page-start"]`);
        if (await start.count()) await start.click();
      }
      await p.waitForSelector(`${P} .board .cell .d.given`, { timeout: 60000 });
      await settle(p, 1200);
      const given = p.locator(`${P} .board button.cell:has(.d.given)`).nth(10);
      for (const how of ["key-A", "more-accuse", "cell-gesture"]) {
        await given.click();
        await settle(p, 300);
        if (how === "key-A") {
          await p.evaluate(() => document.activeElement?.blur());
          await p.keyboard.press("a");
        } else if (how === "more-accuse") {
          await p.locator(`${P} [data-testid="more-button"]`).click();
          await settle(p, 400);
          await p.locator('[data-testid="menu-accuse"]').click();
        } else if (touch) {
          const b = await given.boundingBox();
          await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); // выбор
          await p.evaluate(() => {}); // долгое нажатие touch в Playwright не эмулируется — правый клик как путь «el передан»
          await given.click({ button: "right" });
        } else await given.click({ button: "right" });
        await settle(p, 600);
        const m = await probe(p);
        const liftOk = !!m.lift && !!m.cell && Math.abs(m.lift[0] - m.cell[0]) <= 1 && Math.abs(m.lift[1] - m.cell[1]) <= 1;
        const menuIn = !!m.menu && m.menu[1] >= 0 && m.menu[1] + m.menu[3] <= h && m.menu[0] >= 0 && m.menu[0] + m.menu[2] <= w;
        const ok = liftOk && menuIn;
        const row = { br: BR, build: LABEL, kind, today, how, ok, liftOk, menuIn, ...m, errs: [...errs] };
        rows.push(row);
        console.log(`${ok ? "OK  " : "BUG "} ${BR} ${LABEL} ${kind} today=${today} ${how}`, JSON.stringify(m));
        await p.screenshot({ path: path.join(OUT, `${BR}-accuse-probe-${LABEL}-${kind}-${today}-${how}.png`) });
        if (m.menu) {
          await p.keyboard.press("Escape");
          await settle(p, 400);
          const back = await p.evaluate(() => {
            const a = document.activeElement;
            return { tag: a?.tagName, i: a?.dataset?.i ?? null, pane: a?.closest(".tab-pane")?.getAttribute("data-tab") ?? null, visible: a ? getComputedStyle(a).visibility : null };
          });
          row.focusAfterEsc = back;
          row.focusOk = back.tag === "BUTTON" && back.pane === "play" && back.i === m.cellI && back.visible === "visible";
          row.ok = row.ok && row.focusOk;
          console.log(`     фокус после Esc: ${row.focusOk ? "OK " : "BUG"}`, JSON.stringify(back));
        }
      }
    } finally {
      await ctx.close();
    }
  }
}

const server = await serve(DIST, PORT);
const opened = [];
try {
  for (const b of browsers) {
    const br = await pw[b].launch();
    opened.push(br);
    try {
      await run(br, b === "chromium" ? "cr" : "wk", `http://127.0.0.1:${PORT}`);
    } finally {
      await br.close();
    }
  }
} finally {
  for (const b of opened) await b.close().catch(() => {});
  server.close();
}
const bad = rows.filter((r) => !r.ok || r.errs.length);
console.log(`${rows.length - bad.length}/${rows.length} PASS` + (bad.length ? ` — FAIL: ${bad.map((r) => `${r.br} ${r.kind} ${r.today} ${r.how}`).join("; ")}` : ""));
if (bad.length) process.exitCode = 1;
fs.writeFileSync(path.join(OUT, `accuse-probe-${LABEL}-${browsers.map((b) => (b === "chromium" ? "cr" : "wk")).join("-")}.json`), JSON.stringify(rows, null, 2));
