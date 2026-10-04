// PD-147 (a): таймлайн старта Today у ветерана: ресурсы (js/api) + DCL + метка доски, медианы по N прогонов, холодный/тёплый.
// BASE=... STATE_DIR=... N=8 node timeline.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, instrument, launch, newProfileCtx, waitMark } from "../ia-measure/lib-after.mjs";
const BASE = process.env.BASE, N = Number(process.env.N ?? 8);
const state = JSON.parse(readFileSync(join(STATE_DIR, "state-vet.json"), "utf8"));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const browser = await launch("webkit");
const rows = [];
for (const warm of [false, true]) {
  const acc = {};
  for (let i = 0; i < N; i++) {
    const ctx = await newProfileCtx(browser, "webkit", state, BASE);
    await instrument(ctx);
    if (warm) { const p = await ctx.newPage(); await p.goto(BASE + "/"); await p.waitForFunction(() => window.__ia?.marks?.board); await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 8000))])); await p.waitForTimeout(500); await p.close(); }
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    const b = await waitMark(page, "board");
    const tl = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const o = { dcl: n.domContentLoadedEventEnd, loadEnd: n.loadEventEnd };
      for (const r of performance.getEntriesByType("resource")) {
        const k = r.name.replace(location.origin, "").replace(/\?.*/, "").replace(/-[\w-]{8}\./, ".");
        o[k + " start"] = r.startTime; o[k + " end"] = r.responseEnd;
      }
      for (const m of performance.getEntriesByType('mark')) if (m.name.startsWith('m:')) o[m.name] = m.startTime;
      return o;
    });
    tl.board = b.t;
    for (const [k, v] of Object.entries(tl)) (acc[k] ??= []).push(v);
    await ctx.close();
  }
  console.log(warm ? "WARM" : "COLD", BASE);
  for (const [k, v] of Object.entries(acc).sort((a, b) => med(a[1]) - med(b[1]))) console.log(`  ${k.padEnd(34)} ${Math.round(med(v))}`);
}
await browser.close();
