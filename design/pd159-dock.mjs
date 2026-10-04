// PD-159: док подсказки в ландшафте и при AX3 (экран дня) — не перекрывает поле, доступен прокруткой. BASE=<url> TAG=<dir> node design/pd159-dock.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const pw = createRequire((process.env.PW_DIR ?? "/tmp/pundoku-ios/pw") + "/")("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:5492", TAG = process.env.TAG ?? "after";
const OUT = new URL(`./pd159-shots/${TAG}/`, import.meta.url).pathname;
const PROFILE = JSON.parse(readFileSync(process.env.PROFILE ?? "/tmp/qa-todayfix/state-vet.json", "utf8"));
const { RESTORE } = await import(new URL("../research/usability-2026-10/today-fix-qa/lib-qa.mjs", import.meta.url).href);
for (const engine of ["chromium", "webkit"]) {
  const b = await pw[engine].launch();
  for (const [w, h, route, ax3] of [[852, 393, "today", false], [852, 393, "play", false], [390, 844, "day/2026-09-27", true], [320, 568, "today", true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" });
    await ctx.clock.setFixedTime(new Date("2026-10-04T09:00:00Z"));
    if (ax3) await ctx.addInitScript(() => { const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add); });
    const p0 = await ctx.newPage(); await p0.goto(BASE + "/health"); await p0.evaluate(RESTORE, PROFILE.idb); await p0.close();
    const p = await ctx.newPage(); await p.goto(BASE + "/#/" + route);
    if (route === "play") { await p.waitForSelector("[data-testid=setup-start]"); await p.locator("[data-testid=setup-start]").tap(); }
    await p.waitForSelector(".board button.cell"); await p.waitForTimeout(800);
    await p.locator("[data-testid=hint-button]").tap(); await p.waitForTimeout(400);
    // Первая подсказка на устройстве — шит правила («Show the hint»): согласиться.
    const go = p.getByRole("button", { name: /show the hint/i });
    if (await go.count()) { await go.first().tap(); await p.waitForTimeout(1500); }
    const m = await p.evaluate(() => { const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; }; return { vh: innerHeight, st: document.querySelector(".scroll").scrollTop, board: R(".board"), dock: R("[data-testid=hint-dock]"), sc: document.querySelector(".scroll").scrollHeight }; });
    const name = `dock-${engine}-${w}x${h}-${route.replace("/", "_")}${ax3 ? "-ax3" : ""}`;
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await p.evaluate(() => { const sc = document.querySelector(".scroll"); sc.scrollTop = sc.scrollHeight; }); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/${name}-bottom.png` });
    console.log(name, JSON.stringify(m), "overlap", m.board && m.dock ? Math.max(0, m.board.b - m.dock.t) : "n/a");
    await ctx.close();
  }
  await b.close();
}
