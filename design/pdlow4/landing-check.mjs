/**
 * PD-292 (регресс): посадка последней клетки дня в Grid ∞ (useSolveSequence, scrollIntoView block:center) — со
 * scroll-padding-bottom панели цель центрируется в видимой области над таб-баром. Сравнение «до/после»: scrollTop, где цель.
 *   PD_PW_HOME=… DIST=/tmp/pdlow4-dist BASE_DIST=<сборка до> node design/pdlow4/landing-check.mjs [chromium|webkit]
 */
import { pw, open, serve, MISSION, SOLUTION } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium";
const runs = [["new", process.env.DIST ?? "/tmp/pdlow4-dist", 5381]];
if (process.env.BASE_DIST) runs.push(["base", process.env.BASE_DIST, 5382]);
const P = ".tab-pane:not(.off)";
let bad = 0;
for (const [name, dist, port] of runs) {
  const s = await serve(dist, port);
  const b = await pw[BRN].launch();
  try {
    for (const [w, h] of [[393, 852], [320, 568]]) {
      const { ctx, p, errs } = await open(b, { w, h, dpr: 2, base: `http://127.0.0.1:${port}`, touch: false, extra: { reducedMotion: "no-preference" } });
      try {
        const empties = [...MISSION].flatMap((g, i) => (g === "0" ? [i] : []));
        for (const i of empties) {
          await p.locator(`${P} .board button.cell[data-i="${i}"]`).click();
          await p.keyboard.press(SOLUTION[i]);
        }
        await p.waitForTimeout(4500);
        const r = await p.evaluate((P) => {
          const sc = document.querySelector(P);
          const t = document.querySelector(`${P} [data-testid="grid-inf-target"]`)?.getBoundingClientRect();
          const tb = document.querySelector(".tabbar").getBoundingClientRect();
          const card = document.querySelector(`${P} [data-testid="result-card"]`);
          return { st: Math.round(sc.scrollTop), max: Math.round(sc.scrollHeight - sc.clientHeight), tTop: t && Math.round(t.top), tBottom: t && Math.round(t.bottom), tbTop: Math.round(tb.top), card: !!card };
        }, P);
        const ok = r.card && r.tBottom != null && r.tBottom <= r.tbTop && r.tTop >= 0;
        if (!ok && name === "new") bad++;
        console.log(`${ok ? "PASS" : "FAIL"} ${name} ${BRN} ${w}x${h}: цель Grid ∞ видна над таб-баром после посадки`, JSON.stringify(r), errs.length ? errs[0] : "");
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await b.close();
    s.close();
  }
}
process.exit(bad ? 1 : 0);
