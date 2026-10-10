import { pw, open, serve, P, settle, side } from "./lib.mjs";
const BRN = process.argv[2];
const s = await serve("/tmp/qa270/dist", 5493);
const b = await pw[BRN].launch();
try {
  for (const [w, h, dpr] of [[1024, 640, 1.25], [960, 600, 1.5], [1280, 800, 1]]) {
    const { ctx, p } = await open(b, { w, h, dpr, base: "http://127.0.0.1:5493" });
    await side(p, "side-year", w < 1100 || h < 680); await settle(p, 800);
    await p.evaluate(() => document.activeElement?.blur());
    const key = BRN === "webkit" ? "Alt+Tab" : "Tab";
    const out = [];
    for (let i = 0; i < 20; i++) { await p.keyboard.press(key); await p.waitForTimeout(80);
      const r = await p.evaluate(() => { const e = document.activeElement; if (!e || !e.classList.contains("year-month")) return null; const r = e.getBoundingClientRect(); const sc = e.closest(".scroll"); const sr = sc.getBoundingClientRect(); return { m: e.getAttribute("aria-label").slice(0, 3), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), scTop: sr.top, scBottom: +sr.bottom.toFixed(1), vh: innerHeight, st: Math.round(sc.scrollTop), max: Math.round(sc.scrollHeight - sc.clientHeight) }; });
      if (r) out.push(r); }
    console.log(BRN, `${w}x${h}`, JSON.stringify(out.filter((x) => ["Oct", "Nov", "Dec", "Jan"].includes(x.m))));
    if (w === 1024) await p.screenshot({ path: `/tmp/qa270/shots/${BRN}-year-tabbed-dec-1024x640.png` });
    await ctx.close();
  }
} finally { await b.close(); s.close(); }
