/**
 * QA PD-291 — независимая проба. DIST=<build> LABEL=<br|base> PORT=<n> [QUICK=1] PD_PW_HOME=<pw> node qa-probe.mjs [chromium] [webkit]
 * Матрица: viewport x Today(fresh/started/solved) x scheme x (key-A, key-A-focused, more-accuse, rclick, longpress-mouse, longpress-touch(cr), kbd-nav-A)
 * x клетки (первая/последняя подсказка). Проверки: lift на выбранной клетке панели Play; меню в окне и рядом с клеткой; Esc -> фокус на той же клетке.
 * Плюс: акт обвинения (сравнение состояний), классика/ink (A молчит, нет пункта), ModeMenu/MoreMenu регресс.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST);
const LABEL = process.env.LABEL ?? "br";
const PORT = +(process.env.PORT ?? 5452);
const QUICK = !!process.env.QUICK;
const ONLY = process.env.ONLY ?? "";
const OUT = path.join(HERE, "shots");
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const brs = process.argv.slice(2).filter((a) => ["chromium", "webkit"].includes(a));
const browsers = brs.length ? brs : ["chromium"];
fs.mkdirSync(OUT, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = await new Promise((ok) => {
  const s = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (m) { r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return r.end(JSON.stringify({ date: m[1], mission: MISSION, difficulty: "medium", source: "sudoku.com", winRate: 71 })); }
    if (u.startsWith("/api/")) { r.writeHead(503); return r.end(); }
    let f = path.join(DIST, u);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  s.listen(PORT, "127.0.0.1", () => ok(s));
});

const rows = [];
const P = ".tab-pane:not(.off)";
const settle = (p, ms = 400) => p.waitForTimeout(ms);
const R = (e) => e;

async function state(p) {
  return p.evaluate(() => {
    const r = (e) => (e ? (({ left, top, width, height }) => [Math.round(left), Math.round(top), Math.round(width), Math.round(height)])(e.getBoundingClientRect()) : null);
    const act = document.querySelector('.tab-pane:not(.off) .board button.cell[aria-current="true"]');
    const pane = (e) => e?.closest(".tab-pane")?.getAttribute("data-tab") ?? null;
    return { cell: r(act), cellI: act?.dataset.i ?? null, lift: r(document.querySelector(".liar-lift")), menu: r(document.querySelector('[data-testid="accuse-menu"]')), ih: innerHeight, iw: innerWidth, firstBoardPane: pane(document.querySelector(".board [data-i]")) };
  });
}
async function focusInfo(p) {
  return p.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, testid: a?.dataset?.testid ?? null, i: a?.dataset?.i ?? null, pane: a?.closest(".tab-pane")?.getAttribute("data-tab") ?? null }; });
}
function judge(m) {
  const liftOk = !!m.lift && !!m.cell && Math.abs(m.lift[0] - m.cell[0]) <= 1 && Math.abs(m.lift[1] - m.cell[1]) <= 1;
  const menuIn = !!m.menu && m.menu[1] >= 0 && m.menu[1] + m.menu[3] <= m.ih && m.menu[0] >= 0 && m.menu[0] + m.menu[2] <= m.iw;
  const near = !!m.menu && !!m.cell && (m.menu[1] >= m.cell[1] + m.cell[3] - 1 || m.menu[1] + m.menu[3] <= m.cell[1] + 1) && Math.abs((m.menu[1] >= m.cell[1] + m.cell[3] - 1 ? m.menu[1] - (m.cell[1] + m.cell[3]) : m.cell[1] - (m.menu[1] + m.menu[3]))) <= 16;
  return { liftOk, menuIn, near };
}

async function toLiar(p, kind) {
  if (!(await p.locator(".tabbar .tab").count())) throw new Error("no tabbar");
  await p.locator(".tabbar .tab").nth(1).click();
  await p.waitForSelector('[data-testid="hub-modes"]', { timeout: 20000 });
  await settle(p, 600);
}
async function startMode(p, mode) {
  await p.locator(`[data-testid="mode-${mode}"]`).click();
  await p.locator('[data-testid="mode-sheet"]').waitFor();
  await settle(p, 500);
  await p.keyboard.press("Enter");
  await settle(p, 700);
  // правило необратимого режима (Ink)
  const rule = p.locator('[role="dialog"]:visible');
  if (await rule.count()) { await p.keyboard.press("Enter"); await settle(p, 600); }
  await p.waitForSelector(`${P} .board .cell .d.given`, { timeout: 60000 });
  await settle(p, 1200);
}

async function openHow(p, how, cell, touch, name) {
  const givens = p.locator(`${P} .board button.cell:has(.d.given)`);
  const idx = await p.evaluate(() => [...document.querySelectorAll(".tab-pane:not(.off) .board button.cell")].filter((e) => e.querySelector(".d.given")).map((e) => +e.dataset.i));
  console.log("GIVENS col9/row9:", idx.filter((i) => i % 9 === 8 || i >= 72).join(","));
  const want = cell === "first" ? idx[0] : idx.filter((i) => i % 9 === 8 || i >= 72).pop() ?? idx[idx.length-1];
  const target = p.locator(`${P} .board button.cell[data-i="${want}"]`);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await settle(p, 250);
  const box = await target.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (how === "key-A") { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press("a"); }
  else if (how === "key-A-focused") { await target.focus(); await p.keyboard.press("A"); }
  else if (how === "more-accuse") { await p.locator(`${P} [data-testid="more-button"]`).click(); await settle(p, 350); await p.locator('[data-testid="menu-accuse"]').click(); }
  else if (how === "rclick") await target.click({ button: "right" });
  else if (how === "longpress-mouse") { await p.mouse.move(cx, cy); await p.mouse.down(); await settle(p, 750); await p.mouse.up(); }
  else if (how === "longpress-touch") {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
    await settle(p, 800);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else if (how === "kbd-nav-A") {
    // клавиатурная навигация: с первой подсказки стрелками до другой подсказки, затем A
    await p.evaluate(() => document.activeElement?.blur());
    for (let k = 0; k < 12; k++) {
      await p.keyboard.press(k % 3 === 2 ? "ArrowDown" : "ArrowRight");
      const g = await p.evaluate(() => { const a = document.querySelector('.tab-pane:not(.off) .board button.cell[aria-current="true"]'); return !!a?.querySelector(".d.given"); });
      if (g) break;
    }
    await settle(p, 300);
    console.log("PRE", cell, JSON.stringify(await p.evaluate(()=>{const c=document.querySelector(".tab-pane:not(.off) .board button.cell[aria-current=true]");return {i:c?.dataset.i,label:c?.getAttribute("aria-label"),cls:c?.className,act:document.activeElement?.dataset?.i??document.activeElement?.tagName, menu:!!document.querySelector("[data-testid=accuse-menu]"), dlg:document.querySelectorAll("[role=dialog],[role=menu]").length}})));
    await p.keyboard.press("a");
  }
  await settle(p, 650);
}

async function oneCase(p, br, ctxName, how, cell, touch, h, errs, shot) {
  await openHow(p, how, cell, touch);
  const m = await state(p);
  const j = judge(m);
  const row = { br, build: LABEL, ctx: ctxName, how, which: cell, ...m, ...j, errs: [...errs] };
  if (shot) await p.screenshot({ path: path.join(OUT, `${br}-${LABEL}-${ctxName}-${how}-${cell}.png`) });
  if (m.menu) {
    await p.keyboard.press("Escape");
    await settle(p, 400);
    row.focusAfterEsc = await focusInfo(p);
    row.focusOk = row.focusAfterEsc.tag === "BUTTON" && row.focusAfterEsc.pane === "play" && row.focusAfterEsc.i === m.cellI;
  } else row.focusOk = false;
  row.ok = row.liftOk && row.menuIn && row.near && row.focusOk;
  rows.push(row);
  console.log(`${row.ok ? "OK  " : "BUG "} ${br} ${LABEL} ${ctxName} ${how} ${cell} lift=${row.liftOk} in=${row.menuIn} near=${row.near} focus=${row.focusOk}`);
  if (!row.menu) { await p.keyboard.press("Escape"); }
  return row;
}

async function prep(browser, name, w, h, touch, scheme, today) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 3 : 1, isMobile: touch && name !== "firefox", hasTouch: touch, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce", colorScheme: scheme, serviceWorkers: "block" });
  await ctx.clock.setFixedTime(NOW);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/#/today`);
  await p.waitForSelector(`${P} .board button.cell`, { timeout: 40000 });
  await settle(p, 800);
  const empties = [...MISSION].flatMap((g, i) => (g === "0" ? [i] : []));
  const fill = today === "solved" ? empties : today === "started" ? empties.slice(0, 6) : [];
  for (const i of fill) { await p.locator(`${P} .board button.cell[data-i="${i}"]`).click(); await p.keyboard.press(`Digit${SOLUTION[i]}`); }
  if (today === "solved") { await p.waitForSelector(`${P} [data-testid="grid-inf-section"]`, { timeout: 20000 }); await settle(p, 1200); }
  return { ctx, p, errs };
}

async function accuseAct(p, br, ctxName, errs) {
  // акт обвинения: перебор подсказок клавишей A + подтверждение, до поимки лжеца; фиксируем лог результатов
  const log = [];
  const n = await p.locator(`${P} .board button.cell:has(.d.given)`).count();
  for (let k = 0; k < n; k++) {
    const g = p.locator(`${P} .board button.cell:has(.d.given)`).nth(k);
    if (!(await g.count())) break;
    await g.click().catch(() => {});
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press("a");
    await settle(p, 250);
    if (!(await p.locator('[data-testid="accuse-menu"]').count())) { log.push({ k, noMenu: true }); continue; }
    const before = await state(p);
    await p.locator('[data-testid="accuse-confirm"]').click();
    await settle(p, 500);
    const info = await p.evaluate(() => {
      const c = document.querySelector('.tab-pane:not(.off) .board button.cell[aria-current="true"]');
      return { cls: c?.className ?? null, label: c?.getAttribute("aria-label") ?? null, hint: document.querySelector('.tab-pane:not(.off) [role="status"]')?.textContent?.slice(0, 80) ?? null, result: /caught/.test(c?.className ?? ""), menuGone: !document.querySelector('[data-testid="accuse-menu"]') };
    });
    log.push({ k, liftOk: judge(before).liftOk, ...info });
    if (info.result) break;
  }
  const caught = log.some((l) => l.result);
  const anyMenu = log.filter((l) => !l.noMenu);
  console.log(`ACT ${br} ${LABEL} ${ctxName} accusations=${anyMenu.length} caught=${caught} menuGone=${anyMenu.every((l) => l.menuGone)} liftOk=${anyMenu.every((l) => l.liftOk)}`);
  await p.screenshot({ path: path.join(OUT, `${br}-${LABEL}-${ctxName}-act-end.png`) });
  rows.push({ br, build: LABEL, ctx: ctxName, how: "act", ok: anyMenu.length > 0 && anyMenu.every((l) => l.menuGone && l.liftOk) && errs.length === 0, caught, log, errs: [...errs] });
}

async function menusRegression(p, br, ctxName, errs) {
  // ModeMenu: правый клик по строке режима в хабе; MoreMenu: ⋯ -> Esc
  const out = { ctxName };
  const row = p.locator('[data-testid="mode-liar"]');
  await row.click({ button: "right" });
  await settle(p, 600);
  out.modeMenu = await p.evaluate(() => { const r = (e) => (e ? (({ left, top, width, height }) => [Math.round(left), Math.round(top), Math.round(width), Math.round(height)])(e.getBoundingClientRect()) : null); return { menu: r(document.querySelector('[data-testid="ctx-menu"]')), lift: r(document.querySelector(".ctx-lift")), ih: innerHeight }; });
  await p.keyboard.press("Escape");
  await settle(p, 400);
  out.modeFocus = await focusInfo(p);
  await p.screenshot({ path: path.join(OUT, `${br}-${LABEL}-${ctxName}-modemenu.png`) }).catch(() => {});
  return out;
}
async function moreRegression(p) {
  const out = {};
  await p.locator(`${P} [data-testid="more-button"]`).click();
  await settle(p, 400);
  out.menu = await p.evaluate(() => { const e = document.querySelector('[data-testid="more-menu"]'); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
  out.items = await p.evaluate(() => [...document.querySelectorAll('[data-testid="more-menu"] [role^="menuitem"]')].map((e) => e.dataset.testid));
  await p.keyboard.press("Escape");
  await settle(p, 400);
  out.focus = await focusInfo(p);
  return out;
}

const VPS = [["p393", 393, 852, true], ["p375", 375, 667, true], ["d1440", 1440, 900, false]];
for (const b of browsers) {
  const browser = await pw[b].launch();
  const br = b === "chromium" ? "cr" : "wk";
  try {
    for (const [vp, w, h, touch] of VPS) {
      for (const today of ["fresh", "started", "solved"]) {
        for (const scheme of ["light", "dark"]) {
          if (scheme === "dark" && today !== "solved" && !(today === "fresh" && vp !== "p375")) continue;
          if (QUICK && !(today === "solved" && scheme === "light") && !(today === "fresh" && vp === "p393" && scheme === "light")) continue;
          const ctxName = `${vp}-${today}-${scheme}`;
          if (ONLY && !ctxName.includes(ONLY)) continue;
          const { ctx, p, errs } = await prep(browser, b, w, h, touch, scheme, today);
          try {
            await toLiar(p);
            const reg = await menusRegression(p, br, ctxName, errs);
            console.log("MODEMENU", br, LABEL, ctxName, JSON.stringify(reg));
            rows.push({ br, build: LABEL, ctx: ctxName, how: "modemenu", reg, errs: [...errs] });
            await startMode(p, "liar");
            const more = await moreRegression(p);
            console.log("MORE", br, LABEL, ctxName, JSON.stringify(more));
            rows.push({ br, build: LABEL, ctx: ctxName, how: "more", more, errs: [...errs] });
            const hows = ["kbd-nav-A"];
            if (touch && b === "chromium") hows.push("longpress-touch");
            for (const how of hows) for (const cell of how === "key-A" ? ["first", "mid", "last"] : ["first", "last"]) await oneCase(p, br, ctxName, how, cell, touch, h, errs, cell === "last" || how === "key-A" && cell === "first");
            await accuseAct(p, br, ctxName, errs);
          } catch (e) {
            console.log("ERR", br, ctxName, e.message.split("\n")[0]);
            rows.push({ br, build: LABEL, ctx: ctxName, how: "exception", ok: false, err: e.message.split("\n")[0] });
            await p.screenshot({ path: path.join(OUT, `${br}-${LABEL}-${ctxName}-ERR.png`) }).catch(() => {});
          } finally { await ctx.close(); }
        }
      }
    }
    // классика и ink (одна раскладка каждого вьюпорта, today solved light)
    for (const mode of ["classic", "ink"]) for (const [vp, w, h, touch] of VPS.filter((v) => v[0] !== "p375")) {
      if (ONLY && !ONLY.includes("mode")) continue;
      const ctxName = `${vp}-${mode}`;
      const { ctx, p, errs } = await prep(browser, b, w, h, touch, "light", "solved");
      try {
        await toLiar(p);
        await startMode(p, mode);
        const more = await moreRegression(p);
        await p.locator(`${P} .board button.cell`).nth(40).click();
        await p.evaluate(() => document.activeElement?.blur());
        await p.keyboard.press("a");
        await settle(p, 500);
        const menuOpen = await p.locator('[data-testid="accuse-menu"]').count();
        const f = await focusInfo(p);
        console.log(`MODE ${br} ${LABEL} ${ctxName} accuseMenuAfterA=${menuOpen} items=${JSON.stringify(more.items)} errs=${errs.length}`);
        await p.screenshot({ path: path.join(OUT, `${br}-${LABEL}-${ctxName}.png`) });
        rows.push({ br, build: LABEL, ctx: ctxName, how: "mode", ok: menuOpen === 0 && !more.items.includes("menu-accuse") && errs.length === 0, more, f, errs: [...errs] });
      } catch (e) { console.log("ERR", br, ctxName, e.message.split("\n")[0]); rows.push({ br, build: LABEL, ctx: ctxName, how: "exception", ok: false, err: e.message.split("\n")[0] }); }
      finally { await ctx.close(); }
    }
  } finally { await browser.close().catch(() => {}); }
}
server.close();
const bad = rows.filter((r) => r.ok === false || (r.errs && r.errs.length));
console.log(`${rows.filter((r) => r.ok !== undefined).length - bad.length} PASS / ${rows.filter((r) => r.ok !== undefined).length} judged; bad=${bad.length}`);
fs.writeFileSync(path.join(HERE, `qa-${LABEL}-${browsers.map((x) => x.slice(0, 2)).join("-")}${ONLY ? "-" + ONLY : ""}.json`), JSON.stringify(rows, null, 2));
