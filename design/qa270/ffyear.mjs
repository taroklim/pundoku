import { pw, open, serve, P, settle, side, rect, box } from "./lib.mjs";
const BRN = process.argv[2];
const sN = await serve("/tmp/qa270/dist", 5491), sB = await serve("/tmp/pd290-base", 5492);
const b = await pw[BRN].launch();
try {
  for (const [name, base, w, h, dpr, compact] of [["new compact 1024x640", 5491, 1024, 640, 1.25, true], ["new compact 960x600", 5491, 960, 600, 1.5, true], ["new 1280x800", 5491, 1280, 800, 1, false], ["new 1920x1080", 5491, 1920, 1080, 1, false], ["new 1440x900@125 (1152x720)", 5491, 1152, 720, 1.25, false], ["main phone 393x852", 5492, 393, 852, 3, false], ["main 1024x640 (phone layout)", 5492, 1024, 640, 1.25, false]]) {
    const { ctx, p } = await open(b, { w, h, dpr, base: `http://127.0.0.1:${base}`, touch: w < 500 });
    if (base === 5492) await p.locator("#tab-year").click(); else await side(p, "side-year", compact);
    await settle(p, 800);
    const r = await p.evaluate(() => {
      const pane = document.querySelector(".tab-pane:not(.off) .scroll") ?? document.querySelector(".tab-pane:not(.off)");
      const sc = [...document.querySelectorAll(".tab-pane:not(.off) *")].filter((e) => e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY))[0] ?? pane;
      sc.scrollTop = sc.scrollHeight;
      const m = document.querySelectorAll(".tab-pane:not(.off) .year-month"); const last = m[m.length - 1].getBoundingClientRect(); const sr = sc.getBoundingClientRect();
      const cs = getComputedStyle(sc);
      return { sc: sc.className, pb: cs.paddingBottom, scBottom: Math.round(sr.bottom), lastBottom: Math.round(last.bottom), gap: Math.round(sr.bottom - last.bottom), st: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, vh: innerHeight };
    });
    console.log(BRN, name, JSON.stringify(r));
    await ctx.close();
  }
} finally { await b.close(); sN.close(); sB.close(); }
