// PD-153 QA: PNG отпечаток (new vs main), 3 сценария, подписи en/uk/ru, fallback без Path2D.
// Нужны временные apps/web/src/play/__qa_fp_probe.ts и __qa_fp_main.ts (git show main:.../fingerprint.ts) — не коммитятся.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(process.cwd() + "/")("playwright");
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://127.0.0.1:3995";
const log = (o) => console.log(JSON.stringify(o));
const SCEN = {
  clean: { date: "2026-09-20", durationMs: 494000, moves: 51, blots: 0, corrections: 0, clean: true },
  ink: { date: "2026-10-03", durationMs: 1834000, moves: 58, blots: 2, corrections: 3, clean: false, hints: 3 },
  day3: { date: "2026-08-11", durationMs: 3721000, moves: 47, blots: 0, corrections: 1, clean: false },
};
for (const [bn, T] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await T.launch(); const ctx = await b.newContext({ viewport: { width: 393, height: 852 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto(`${BASE}/#/settings`); await page.waitForTimeout(1500);
  for (const lang of ["en", "uk", "ru"]) for (const [sc, inp] of Object.entries(SCEN)) {
    const right = await page.evaluate(async ([l, i]) => (await import("/src/play/__qa_fp_probe.ts")).captionFor(l, i), [lang, inp]);
    for (const [which, no] of [["new", false], ["old", false], ["new", true]]) {
      const tag = `${bn}-${lang}-${sc}-${which}${no ? "-nopath2d" : ""}`;
      if (lang !== "en" && !(which === "new" && !no) && sc !== "ink") continue;
      const b64 = await page.evaluate(async ([w, s, r, n]) => (await import("/src/play/__qa_fp_probe.ts")).probe(w, s, r, n), [which, sc, right, no]);
      const buf = Buffer.from(b64, "base64");
      const meas = await page.evaluate(async (b64) => {
        const i = new Image(); await new Promise((r) => { i.onload = r; i.src = "data:image/png;base64," + b64; });
        const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
        const H = 100, Y0 = 1220;
        const d = x.getImageData(0, Y0, i.width, H).data;
        const cols = []; let top = 1e9, bot = -1;
        for (let xx = 0; xx < i.width; xx++) { let ink = false; for (let y = 0; y < H; y++) { const o = (y * i.width + xx) * 4; if (d[o] < 190 || d[o+1] < 190 || d[o+2] < 190) { ink = true; if (y < top) top = y; if (y > bot) bot = y; } } cols.push(ink); }
        const clusters = []; let s = -1, last = -1;
        cols.forEach((v, xx) => { if (v) { if (s < 0) s = xx; else if (xx - last > 14) { clusters.push([s, last]); s = xx; } last = xx; } });
        if (s >= 0) clusters.push([s, last]);
        return { w: i.width, h: i.height, clusters, y: [top + Y0, bot + Y0] };
      }, b64);
      writeFileSync(join(HERE, `shots/png-${tag}.png`), buf);
      log({ tag, bytes: buf.length, right, ...meas });
    }
  }
  await b.close();
}
