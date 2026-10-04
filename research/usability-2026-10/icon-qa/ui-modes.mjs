// PD-156 QA: Mark в forced-colors (chromium) и print (chromium+webkit): Year пусто и About, 3 оптики по размеру (small в приложении; solid <24 и full >60 — через вставку в DOM)
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire("/tmp/pundoku-ios/pw/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5997";
const OUT = new URL("./shots/", import.meta.url).pathname;
for (const [en, T, opts] of [["chromium-forced-light", chromium, { forcedColors: "active", colorScheme: "light" }], ["chromium-forced-dark", chromium, { forcedColors: "active", colorScheme: "dark" }], ["chromium-print", chromium, { colorScheme: "dark" }], ["webkit-print", webkit, { colorScheme: "dark" }]]) {
  const b = await T.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, ...opts });
  const p = await ctx.newPage();
  if (en.includes("print")) await p.emulateMedia({ media: "print" });
  await p.goto(BASE + "/#/year"); await p.waitForTimeout(1500);
  const y = await p.evaluate(() => { const s = document.querySelector(".year-empty-mark"); const e = s.querySelector("rect,path"); return { fill: getComputedStyle(e).fill, canvasText: (() => { const d = document.createElement("div"); d.style.color = "CanvasText"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })() }; });
  await p.screenshot({ path: OUT + `year-${en}.png` });
  await p.goto(BASE + "/#/settings"); await p.locator('[data-testid="settings-about"]').waitFor(); await p.locator('[data-testid="settings-about"]').scrollIntoViewIfNeeded();
  // вставить три оптики по размеру для проверки правил CSS на path (solid) и rect (small/full)
  const fills = await p.evaluate(() => { const host = document.querySelector('[data-testid="settings-about"]'); const out = {}; for (const [n, d] of [["solid", `<path d="M3 1H14V10H6V15H3Z M6 4V7H11V4Z"/>`], ["small", `<rect x="3" y="1" width="3" height="3"/>`], ["full", `<rect x="272" y="189" width="146" height="146" rx="30"/>`]]) { const t = document.createElement("div"); t.innerHTML = `<svg class="brand-mark" viewBox="0 0 16 16" width="20" height="20" fill="currentColor">${d}</svg>`; host.append(t); out[n] = getComputedStyle(t.querySelector("rect,path")).fill; } return out; });
  await p.locator('[data-testid="settings-about"]').screenshot({ path: OUT + `about-${en}.png` });
  console.log(en, JSON.stringify({ year: y, fills }));
  await b.close();
}
