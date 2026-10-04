// PD-156 QA: какой favicon реально запрашивает браузер (по сетевым запросам), BASE=http://localhost:5997 (vite preview сборки)
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire("/tmp/pundoku-ios/pw/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5997";
for (const [name, launch] of [
  ["chromium-newheadless", () => chromium.launch({ channel: "chromium" })],
  ["chromium-shell", () => chromium.launch()],
  ["webkit", () => webkit.launch()],
]) {
  for (const dpr of [1, 2]) {
    let b;
    try { b = await launch(); } catch (e) { console.log(name, "launch fail", e.message.split("\n")[0]); break; }
    const ctx = await b.newContext({ deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    const got = [];
    p.on("request", (r) => { if (/\/icons\//.test(r.url())) got.push(r.url().replace(BASE, "")); });
    await p.goto(BASE + "/");
    await p.waitForTimeout(3000);
    console.log(name, "dpr", dpr, JSON.stringify(got));
    await b.close();
  }
}
