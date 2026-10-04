// PD-147 (a): замер «nav -> доска Today» у ветерана, холодный/тёплый, N прогонов. Переиспользует lib-after.mjs из ia-measure.
// Запуск: BASE=http://127.0.0.1:3991 WT=<worktree> STATE_DIR=/tmp/pundoku-todayfix N=10 VIEW=393x852 [LABEL=main] [SEED=1] node bench-today.mjs
// SEED=1 — (пере)сеять профиль ветерана на BASE. Выход: JSON в stdout (+OUT).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { STATE_DIR, instrument, launch, newProfileCtx, seedVeteran, waitMark } from "./lib-qa.mjs";

const VET = process.env.PROFILE ?? join(STATE_DIR, "state-vet.json");
const N = Number(process.env.N ?? 10);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const stat = (a) => ({ median: Math.round(q(a, 0.5)), p90: Math.round(q(a, 0.9)), min: Math.round(Math.min(...a)), max: Math.round(Math.max(...a)), n: a.length });
const r2 = (a) => { const o = stat(a); return `${(o.median / 1000).toFixed(2)} / p90 ${(o.p90 / 1000).toFixed(2)} (min ${(o.min / 1000).toFixed(2)})`; };

async function prime(ctx, BASE) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/");
  await p.waitForFunction(() => window.__ia?.marks?.board, null, { timeout: 60000 });
  await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 8000))]));
  await p.waitForTimeout(500);
  await p.goto("about:blank");
  await p.close();
}
async function once(browser, state, warm, BASE) {
  const ctx = await newProfileCtx(browser, "webkit", state, BASE);
  await instrument(ctx);
  try {
    if (warm) await prime(ctx, BASE);
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 120)));
    page.on("pageerror", (e) => errs.push("pageerror " + e.message));
    const load = os.loadavg()[0];
    await page.goto(BASE + "/");
    const b = await waitMark(page, "board");
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const res = performance.getEntriesByType("resource");
      return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, res: res.length, js: res.filter((r) => r.name.endsWith(".js")).length, transfer: Math.round(res.reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024) };
    });
    return { t: b.t, paint: b.paint ?? b.t, load, errs, nav };
  } finally { await ctx.close(); }
}
const browser = await launch("webkit");
if (VET !== "none" && (process.env.SEED || !existsSync(VET))) { await seedVeteran("webkit", VET); }
const state = VET === "none" ? undefined : JSON.parse(readFileSync(VET, "utf8"));
// BASES="label=url,label=url": прогоны чередуются (base, main, base, main …) — нагрузка машины делится поровну
const bases = (process.env.BASES ?? `${process.env.LABEL ?? "x"}=${process.env.BASE}`).split(",").map((x) => x.split("="));
const out = { view: process.env.VIEW ?? "393x852", loadStart: os.loadavg()[0], runs: {} };
for (const [l] of bases) out.runs[l] = { cold: [], warm: [] };
for (let i = 0; i < N; i++) for (const [l, url] of bases) { out.runs[l].cold.push(await once(browser, state, false, url)); out.runs[l].warm.push(await once(browser, state, true, url)); }
await browser.close();
out.loadEnd = os.loadavg()[0];
out.summary = {};
for (const [l] of bases) { const r = out.runs[l]; out.summary[l] = { cold_board_s: r2(r.cold.map((x) => x.t)), warm_board_s: r2(r.warm.map((x) => x.t)), cold_painted_s: r2(r.cold.map((x) => x.paint)), warm_painted_s: r2(r.warm.map((x) => x.paint)), load: `${Math.min(...r.cold.concat(r.warm).map((x) => x.load)).toFixed(0)}..${Math.max(...r.cold.concat(r.warm).map((x) => x.load)).toFixed(0)}`, cold_res: r.cold[0].nav, warm_res: r.warm[0].nav, errs: [...new Set(r.cold.concat(r.warm).flatMap((x) => x.errs))] }; }
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary, null, 1));
