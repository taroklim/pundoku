import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
export { pw, fs, path };
export const NOW = new Date("2026-10-09T09:00:00Z");
export const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
export const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
export function serve(root, port) {
  const server = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (m) { r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return r.end(JSON.stringify({ date: m[1], mission: MISSION, difficulty: "medium", source: "sudoku.com", winRate: 71 })); }
    if (u.startsWith("/api/")) { r.writeHead(503); return r.end(); }
    let f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
    r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}
export async function open(browser, { w, h, dpr = 1, scheme = "light", route = "today", base, touch = false, locale = "en-US", extra = {}, seed = true }) {
  const name = browser.browserType().name();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: touch && name !== "firefox", hasTouch: touch, locale, timezoneId: "UTC", colorScheme: scheme, reducedMotion: "reduce", serviceWorkers: "block", ...extra });
  await ctx.clock.setFixedTime(NOW);
  if (seed) await ctx.addInitScript(() => { let x = 0x9e3779b9; crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) { x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; a[i] = x & (a.BYTES_PER_ELEMENT === 1 ? 0xff : a.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffffffff); } return a; }; });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${base}/#/${route}`);
  if (route === "today") await p.waitForSelector(".tab-pane:not(.off) .board button.cell", { timeout: 40000 });
  else await p.waitForTimeout(600);
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}
export const P = ".tab-pane:not(.off)";
export const settle = (p, ms = 450) => p.waitForTimeout(ms);
// Solver on a string of 81 digits (0 = empty)
export function solve(s) {
  const g = s.split("").map(Number);
  const ok = (i, v) => { const r = (i / 9) | 0, c = i % 9; for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false; } const br = r - (r % 3), bc = c - (c % 3); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === v) return false; return true; };
  const rec = () => { let best = -1, bc = 10, bo; for (let i = 0; i < 81; i++) if (!g[i]) { const o = []; for (let v = 1; v <= 9; v++) if (ok(i, v)) o.push(v); if (o.length < bc) { bc = o.length; best = i; bo = o; if (bc <= 1) break; } } if (best < 0) return true; for (const v of bo) { g[best] = v; if (rec()) return true; g[best] = 0; } return false; };
  return rec() ? g.join("") : null;
}
export async function side(p, testid, compact) {
  if (compact) { await p.locator('[data-testid="sidebar-toggle"]:visible').first().click(); await p.waitForTimeout(250); }
  await p.locator(`[data-testid="${testid}"]`).click();
}
export async function readBoard(p, scope) {
  return p.evaluate((sc) => { const out = Array(81).fill("0"); for (const c of document.querySelectorAll(`${sc} .board button.cell[data-i]`)) { const i = +c.dataset.i; const d = c.querySelector(".d.given, .d.player"); if (d) out[i] = d.textContent.trim(); } return out.join(""); }, scope);
}
export async function rect(p, sel) {
  return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
}
export const box = (r) => r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
