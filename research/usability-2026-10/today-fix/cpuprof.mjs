// Профиль CPU (Chromium/CDP) старта Today у ветерана: топ функций по self-time до метки «доска». Только для поиска горячих мест (движок не WebKit).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, instrument, newProfileCtx, pw } from "../ia-measure/lib-after.mjs";
const BASE = process.env.BASE;
const state = JSON.parse(readFileSync(join(STATE_DIR, "state-vet.json"), "utf8"));
const browser = await pw.chromium.launch();
const agg = new Map(); let total = 0;
const RUNS = Number(process.env.N ?? 5);
for (let i = 0; i < RUNS; i++) {
  const ctx = await newProfileCtx(browser, "chromium", state, BASE);
  await instrument(ctx);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start");
  await page.goto(BASE + "/");
  await page.waitForFunction(() => window.__ia?.marks?.board);
  const { profile } = await cdp.send("Profiler.stop");
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, k) => {
    const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber}`;
    const d = dt[k] / 1000; total += d; agg.set(key, (agg.get(key) ?? 0) + d);
  });
  await ctx.close();
}
console.log("total ms/run", Math.round(total / RUNS));
[...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(String(Math.round((v / RUNS) * 10) / 10).padStart(7), k));
await browser.close();
