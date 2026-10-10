/**
 * PD-292 (регресс): док подсказки на Today докручивается над таб-баром с прежним зазором. Раньше зазор давал
 * `scroll-margin-bottom` дока, теперь — `scroll-padding-bottom` панели `.scroll` (одно поле, не два).
 *   PD_PW_HOME=… DIST=/tmp/pdlow4-dist node design/pdlow4/dock-check.mjs [chromium|webkit] (BASE_DIST=… — сравнение со сборкой до)
 */
import { pw, open, serve } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium";
const runs = [["new", process.env.DIST ?? "/tmp/pdlow4-dist", 5371]];
if (process.env.BASE_DIST) runs.push(["base", process.env.BASE_DIST, 5372]);
let bad = 0;
for (const [name, dist, port] of runs) {
  const s = await serve(dist, port);
  const b = await pw[BRN].launch();
  try {
    for (const [w, h, ax3] of [[320, 568, false], [320, 568, true], [393, 852, true], [568, 320, false], [852, 393, true]]) {
      const { ctx, p } = await open(b, { w, h, dpr: 2, base: `http://127.0.0.1:${port}`, touch: true, extra: ax3 ? {} : {} });
      try {
        if (ax3) await p.addStyleTag({ content: "html{font-size:28px !important}" });
        await p.waitForTimeout(400);
        await p.locator('.tab-pane:not(.off) [data-testid="hint-button"]').click();
        await p.waitForTimeout(500);
        const go = p.locator('[data-testid="hint-rule-go"]');
        if (await go.count()) await go.click(); // первый раз — шит правила подсказок
        await p.locator('.tab-pane:not(.off) [data-testid="hint-dock"]').waitFor();
        await p.waitForTimeout(700);
        const r = await p.evaluate(() => {
          const d = document.querySelector('.tab-pane:not(.off) [data-testid="hint-dock"]').getBoundingClientRect();
          const t = document.querySelector(".tabbar").getBoundingClientRect();
          const sc = document.querySelector(".tab-pane:not(.off)");
          return { gap: +(t.top - d.bottom).toFixed(1), st: Math.round(sc.scrollTop), max: Math.round(sc.scrollHeight - sc.clientHeight), dockH: Math.round(d.height) };
        });
        const ok = r.gap >= 0;
        if (!ok && name === "new") bad++;
        console.log(`${ok ? "PASS" : "FAIL"} ${name} ${BRN} ${w}x${h}${ax3 ? " AX" : ""}: док над таб-баром`, JSON.stringify(r));
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
