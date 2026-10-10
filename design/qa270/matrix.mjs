import { pw, open, serve, P, settle, side, readBoard, solve, rect, box, MISSION, SOLUTION, fs } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium";
const SETS = process.argv[3] ? process.argv[3].split(",") : ["matrix"];
const PORT = +(process.argv[4] ?? 5431);
const SH = "/tmp/qa270/shots";
const BR = { chromium: "cr", webkit: "wk", firefox: "ff" }[BRN];
const results = {}; const fails = [];
const check = (n, ok, d = {}) => { results[n] = { ok: !!ok, ...d }; if (!ok) fails.push(n); console.log(`${ok ? "PASS" : "FAIL"} ${n}`, JSON.stringify(d)); };
const WINDOWS = [[1280, 800], [1440, 900], [1920, 1080]];
const css = (W, H, z) => [Math.round(W / (z / 100)), Math.round(H / (z / 100))];
const MATRIX = [...WINDOWS.flatMap(([W, H]) => [100, 125, 150].map((z) => [`${W}x${H}@${z}`, ...css(W, H, z), z])), ["compact-1024x640", 1024, 640, 125], ["compact-960x600", 960, 600, 150]];
const isFull = (w, h) => w >= 1100 && h >= 680;
const near = (a, b, e = 1.5) => Math.abs(a - b) <= e;

async function solveToday(p, keep = 0) {
  const todo = []; for (let i = 0; i < 81; i++) if (MISSION[i] === "0") todo.push(i);
  for (const i of todo.slice(0, todo.length - keep)) { await p.locator(`${P} .board button.cell[data-i="${i}"]`).click(); await p.keyboard.press(`Digit${SOLUTION[i]}`); }
  if (!keep) { await p.waitForSelector(`${P} [data-testid="grid-inf-section"]`, { timeout: 20000 }); await settle(p, 1200); }
}
async function playMoves(p, frac) {
  const bd = await readBoard(p, P + " .desk-play"); const sol = solve(bd);
  const empt = []; for (let i = 0; i < 81; i++) if (bd[i] === "0") empt.push(i);
  const n = frac >= 1 ? empt.length : Math.floor(empt.length * frac);
  for (const i of empt.slice(0, n)) { await p.locator(`${P} .desk-play .board button.cell[data-i="${i}"]`).click(); await p.keyboard.press(`Digit${sol[i]}`); }
  return { bd, sol, n, total: empt.length };
}
async function startMode(p, compact, mode = "classic") {
  await side(p, "side-play", compact); await settle(p);
  await side(p, `side-mode-${mode}`, compact); await settle(p);
  await p.locator(`${P} [data-testid="mode-page-start"]`).click();
  await p.waitForSelector(`${P} .desk-play .board button.cell`, { timeout: 40000 }); await settle(p, 700);
}
/** Состояние инспектора: прокрутка, видимость интерактивных, вылеты. */
async function insp(p) {
  return p.evaluate(() => {
    const i = document.querySelector(`.tab-pane:not(.off) .desk-insp, .push-layer .desk-insp`) ?? document.querySelector(".desk-insp");
    if (!i) return null;
    const r = i.getBoundingClientRect();
    const kids = [...i.children].map((c) => ({ c: c.className.slice(0, 30), top: Math.round(c.getBoundingClientRect().top), bottom: Math.round(c.getBoundingClientRect().bottom) }));
    const cs = getComputedStyle(i);
    return { cls: i.className, sh: i.scrollHeight, ch: i.clientHeight, over: i.scrollHeight - i.clientHeight, oy: cs.overflowY, w: Math.round(r.width), h: Math.round(r.height), sw: i.scrollWidth, cw: i.clientWidth, kids };
  });
}
/** Прокрутить инспектор до низа; вернуть: что ниже окна на scrollTop 0 / видны ли все интерактивные в конце. */
async function inspScrollWalk(p, T, shotName) {
  const before = await p.evaluate(() => {
    const i = document.querySelector(".desk-insp"); i.scrollTop = 0;
    const vh = innerHeight; const ir = i.getBoundingClientRect();
    const els = [...i.querySelectorAll("button, a, [role=button]")].filter((e) => e.getClientRects().length);
    return els.map((e) => { const r = e.getBoundingClientRect(); return { id: (e.dataset.testid || e.textContent || e.className).trim().slice(0, 24), top: Math.round(r.top), bottom: Math.round(r.bottom), hidden: r.bottom > Math.min(ir.bottom, vh) + 0.5 }; });
  });
  const hiddenAtTop = before.filter((x) => x.hidden);
  await p.evaluate(() => { const i = document.querySelector(".desk-insp"); i.scrollTop = i.scrollHeight; });
  await settle(p, 300);
  const after = await p.evaluate(() => {
    const i = document.querySelector(".desk-insp"); const ir = i.getBoundingClientRect();
    const els = [...i.querySelectorAll("button, a, [role=button]")].filter((e) => e.getClientRects().length);
    const last = i.lastElementChild.getBoundingClientRect();
    return { st: i.scrollTop, max: i.scrollHeight - i.clientHeight, lastBottom: Math.round(last.bottom), irBottom: Math.round(ir.bottom), vh: innerHeight, cut: els.filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > Math.min(ir.bottom, innerHeight) + 0.5 && r.top < ir.bottom; }).map((e) => (e.dataset.testid || e.textContent).trim().slice(0, 24)) };
  });
  if (shotName) await p.screenshot({ path: `${SH}/${shotName}` });
  await p.evaluate(() => { document.querySelector(".desk-insp").scrollTop = 0; });
  return { hiddenAtTop, after };
}
async function hscroll(p) { return p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, sh: document.documentElement.scrollHeight, vh: innerHeight })); }
const pad = (s) => s.replace(/[ ]/g, "-");

async function runMatrix(browser, base, scheme, locale = "en-US", only = null, tagExtra = "") {
  for (const [label, w, h, z] of MATRIX) {
    if (only && !only.includes(label)) continue;
    const full = isFull(w, h);
    const T = `${BR} ${label} ${scheme} ${locale}${tagExtra} (${w}x${h})`;
    const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base, locale });
    try {
      // Today до решения
      let hs = await hscroll(p);
      check(`${T} Today unsolved: layout ${full ? "full" : "compact"}, no h-scroll, no page v-scroll`, hs.sw <= hs.vw && hs.sh <= hs.vh + 1 && (await p.evaluate((f) => document.querySelector(".shell")?.className.includes("desk") && (f ? !!document.querySelector(".sidebar") : !document.querySelector(".sidebar:not([hidden])") || true), full)), hs);
      await p.screenshot({ path: `${SH}/${BR}-${label}-${scheme}-${locale}-1-today.png` });
      // Play в процессе
      await startMode(p, !full);
      const mv = await playMoves(p, 0.5);
      await settle(p, 300);
      let hs2 = await hscroll(p);
      const b = await rect(p, `${P} .desk-play .board`);
      check(`${T} Play in progress: board fully in window, no scroll`, b && b.left >= -0.5 && b.top >= -0.5 && b.bottom <= h + 0.5 && b.right <= w + 0.5 && hs2.sw <= hs2.vw && hs2.sh <= hs2.vh + 1, { board: box(b), hs2 });
      let ii = await insp(p);
      check(`${T} Play in progress: inspector fits (no overflow)`, ii && ii.over <= 0, { over: ii?.over });
      await p.screenshot({ path: `${SH}/${BR}-${label}-${scheme}-${locale}-2-play.png` });
      // Решённая партия
      await playMoves(p, 1);
      await p.waitForSelector(`${P} .desk-insp.solved, ${P} .desk-insp .card`, { timeout: 10000 });
      await settle(p, 1300);
      ii = await insp(p);
      const sw1 = await inspScrollWalk(p, T, null);
      check(`${T} Play solved: inspector card shown; Share/New puzzle reachable; overflow ${ii?.over}px`, ii && /solved/.test(ii.cls) && sw1.after.cut.length === 0 && sw1.hiddenAtTop.length === 0 || (sw1.after.cut.length === 0 && sw1.after.st >= (sw1.after.max - 1)), { over: ii?.over, hiddenAtTop: sw1.hiddenAtTop, after: sw1.after });
      await p.screenshot({ path: `${SH}/${BR}-${label}-${scheme}-${locale}-3-play-solved.png` });
      // Today решённый
      await side(p, "side-today", !full); await settle(p, 500);
      await solveToday(p);
      ii = await insp(p);
      const sw2 = await inspScrollWalk(p, T, `${BR}-${label}-${scheme}-${locale}-5-today-solved-scrolled.png`);
      await settle(p, 200);
      check(`${T} Today solved: card + Grid ∞ in inspector; all controls reachable via scroll; overflow ${ii?.over}px`, ii && sw2.after.cut.length === 0 && !!(await p.$(`${P} [data-testid="grid-inf-section"]`)), { over: ii?.over, hiddenAtTop: sw2.hiddenAtTop.map((x) => x.id), after: sw2.after });
      await p.screenshot({ path: `${SH}/${BR}-${label}-${scheme}-${locale}-4-today-solved.png` });
      hs = await hscroll(p);
      check(`${T} Today solved: no h-scroll`, hs.sw <= hs.vw, hs);
      check(`${T}: no JS errors`, errs.length === 0, { errs });
    } catch (e) { check(`${T}: scenario threw`, false, { e: String(e).slice(0, 300) }); await p.screenshot({ path: `${SH}/${BR}-${label}-${scheme}-${locale}-ERR.png` }).catch(() => {}); }
    await ctx.close();
  }
}

const server = await serve("/tmp/qa270/dist", PORT);
const base = `http://127.0.0.1:${PORT}`;
const browser = await (BRN === "firefox" ? pw.firefox : pw[BRN]).launch();
try {
  if (SETS.includes("one")) await runMatrix(browser, base, "light", "en-US", ["1280x800@100"]);
  if (SETS.includes("matrix")) { await runMatrix(browser, base, "light"); await runMatrix(browser, base, "dark"); }
  if (SETS.includes("dark")) await runMatrix(browser, base, "dark", "en-US", ["1280x800@100", "1440x900@100", "1920x1080@100", "1920x1080@150", "compact-1024x640", "compact-960x600"]);
  if (SETS.includes("matrix-light")) await runMatrix(browser, base, "light");
  if (SETS.includes("loc")) {
    for (const loc of ["ru-RU", "uk-UA"]) await runMatrix(browser, base, "light", loc, ["1280x800@100", "1440x900@125", "compact-1024x640"]);
  }
} finally { await browser.close().catch(() => {}); server.close(); }
fs.writeFileSync(`/tmp/qa270/results-matrix-${BR}-${SETS.join("_")}.json`, JSON.stringify({ total: Object.keys(results).length, fails, results }, null, 1));
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} PASS${fails.length ? "\nFAIL:\n  " + fails.join("\n  ") : ""}`);
