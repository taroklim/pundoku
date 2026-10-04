// PD-156 QA: Mark в пустом Year и About на реальной сборке (vite preview), светлая/тёмная/forced-colors/print, 320/393, AX3-эмуляция (шрифт html 200%), en/uk/ru, chromium+webkit
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire("/tmp/pundoku-ios/pw/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5997";
const OUT = new URL("./shots/", import.meta.url).pathname;
const res = [];
for (const [en, T] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await T.launch();
  for (const lang of ["en", "uk", "ru"]) for (const w of [320, 393]) for (const scheme of ["light", "dark"]) for (const ax of [false, true]) {
    if (ax && lang === "en" && scheme === "dark") continue;
    const ctx = await b.newContext({ viewport: { width: w, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, locale: { en: "en-US", uk: "uk-UA", ru: "ru-RU" }[lang] });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/#/year"); await p.waitForTimeout(1500);
    if (ax) await p.addStyleTag({ content: "html{font-size:200% !important}" });
    const tag = `${en}-${lang}-${w}-${scheme}${ax ? "-ax" : ""}`;
    const ye = p.locator('[data-testid="year-empty"]');
    const yeN = await ye.count();
    let yinfo = null;
    if (yeN) {
      yinfo = await p.evaluate(() => { const s = document.querySelector(".year-empty-mark"); const r = s.getBoundingClientRect(); return { box: [r.width, r.height], optics: s.dataset.optics, rects: s.querySelectorAll("rect").length, ariaHidden: s.getAttribute("aria-hidden"), role: s.getAttribute("role"), fill: getComputedStyle(s.querySelector("rect,path")).fill, left: r.left, right: r.right, ovX: document.documentElement.scrollWidth > innerWidth }; });
      if (lang === "en" || ax) await p.screenshot({ path: OUT + `year-${tag}.png` });
    }
    await p.goto(BASE + "/#/settings"); await p.locator('[data-testid="settings-about"]').waitFor({ timeout: 15000 });
    await p.locator('[data-testid="settings-about"]').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    const ainfo = await p.evaluate(() => { const c = document.querySelector('[data-testid="settings-about"]'); const m = c.querySelector("svg.brand-mark"); const wm = c.querySelector("svg.settings-about-word"); const rm = m.getBoundingClientRect(), rw = wm.getBoundingClientRect(), rc = c.getBoundingClientRect(); return { mark: [rm.width, rm.height, m.dataset.optics, m.getAttribute("aria-hidden"), m.getAttribute("role"), m.getAttribute("aria-label")], word: [rw.width, rw.height, wm.getAttribute("role"), wm.getAttribute("aria-label")], inCard: rm.left >= rc.left && rw.right <= rc.right + 0.5, overlap: rm.right > rw.left && rm.bottom > rw.top && rm.top < rw.bottom, ovX: document.documentElement.scrollWidth > innerWidth, card: [rc.width, rc.height], text: c.innerText.replace(/\n/g, " | ") }; });
    if (lang === "en" || ax) await p.locator('[data-testid="settings-about"]').screenshot({ path: OUT + `about-${tag}.png` });
    res.push({ tag, yeN, yinfo, ainfo, errs });
    await ctx.close();
  }
  await b.close();
}
import { writeFileSync } from "node:fs";
writeFileSync(OUT + "ui-marks.json", JSON.stringify(res, null, 1));
const bad = res.filter((r) => !r.yeN || r.errs.length || r.ainfo.ovX || !r.ainfo.inCard || r.ainfo.overlap || (r.yinfo && (r.yinfo.ovX || r.yinfo.rects !== 9)));
console.log("cases", res.length, "suspicious", bad.length); for (const r of bad) console.log(JSON.stringify(r).slice(0, 500));
console.log(JSON.stringify(res[0]));
