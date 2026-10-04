// PD-159: скриншоты и замеры до/после (ландшафт; AX3 архив; портрет — регресс попиксельно).
// BASE=<url> TAG=before|after OUT=<dir> node design/pd159-shots.mjs [portrait|land|ax3 ...]
// Playwright — из PW_DIR (по умолчанию /tmp/pundoku-ios/pw), профиль ветерана — PROFILE (дамп QA PD-151, необязателен).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
const pw = createRequire((process.env.PW_DIR ?? "/tmp/pundoku-ios/pw") + "/")("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:5491";
const TAG = process.env.TAG ?? "before";
const OUT = process.env.OUT ?? new URL("./pd159-shots/", import.meta.url).pathname;
mkdirSync(`${OUT}/${TAG}`, { recursive: true });
const NOW = new Date("2026-10-04T09:00:00Z");
const ARCH = "2026-09-27";
const which = process.argv.slice(2).length ? process.argv.slice(2) : ["portrait", "land", "ax3"];
const LOCALES = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };
const results = [];
// Профиль ветерана (firstUseDate 2026-09-25 -> архив 27.09 открыт); сеется вручную с ожиданием tx.oncomplete (см. lib-qa.mjs).
const PROFILE = JSON.parse(readFileSync(process.env.PROFILE ?? "/tmp/qa-todayfix/state-vet.json", "utf8"));
const { RESTORE } = await import(new URL("../research/usability-2026-10/today-fix-qa/lib-qa.mjs", import.meta.url).href);

async function open(browser, engine, { w, h, lang = "en", ax3 = false, route }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: LOCALES[lang], timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce" });
  await ctx.clock.setFixedTime(NOW);
  // Детерминированная случайность: сид партии Play (crypto.getRandomValues) одинаков в обеих сборках -> попиксельное сравнение.
  await ctx.addInitScript(() => { let x = 0x9e3779b9; crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) { x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; a[i] = x & (a.BYTES_PER_ELEMENT === 1 ? 0xff : a.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffffffff); } return a; }; });
  if (ax3) await ctx.addInitScript(() => { const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add); });
  const p0 = await ctx.newPage(); await p0.goto(BASE + "/health"); await p0.evaluate(RESTORE, PROFILE.idb); await p0.close();
  const p = await ctx.newPage();
  await p.goto(BASE + "/#/" + route);
  if (route === "play") { await p.waitForSelector("[data-testid=setup-start]", { timeout: 30000 }); await p.locator("[data-testid=setup-start]").tap(); }
  await p.waitForSelector(".board button.cell", { timeout: 30000 });
  await p.waitForTimeout(900);
  return { ctx, p };
}
const measure = (p) => p.evaluate(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; };
  const sc = document.querySelector(".scroll");
  const board = R(".board"); const ink = R(".ink-entry") ?? R(".mode-chip");
  const sub = document.querySelector(".play .subline");
  const diff = document.querySelector(".play .sub-diff");
  const src = document.querySelector(".play .today-status .source");
  const vis = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  return {
    board, ink, pad: R(".pad"), actions: R(".actions"), tab: R(".tabbar"),
    overlapInk: board && ink ? Math.max(0, board.b - ink.t) : null,
    scroll: sc ? { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight, oy: getComputedStyle(sc).overflowY } : null,
    sub: sub ? { lines: Math.round(sub.getBoundingClientRect().height / parseFloat(getComputedStyle(sub).lineHeight || "1") ) , text: sub.textContent, h: Math.round(sub.getBoundingClientRect().height) } : null,
    diffTrunc: diff ? diff.scrollWidth > diff.clientWidth + 1 : null,
    srcVisible: vis(src), src: src?.textContent ?? null,
    bottomOk: (() => { const a = R(".actions"); const t = R(".tabbar"); return a && t ? a.b <= t.t + 0.5 : null; })(),
  };
});

for (const engine of ["chromium", "webkit"]) {
  const browser = await pw[engine].launch();
  if (which.includes("portrait")) {
    for (const [w, h] of [[320, 568], [375, 667], [390, 844], [393, 852], [430, 932]])
      for (const route of ["today", "play", `day/${ARCH}`])
        for (const ax3 of [false, true]) {
          const { ctx, p } = await open(browser, engine, { w, h, route, ax3 });
          const name = `portrait-${engine}-${w}x${h}-${route.replace("/", "_")}${ax3 ? "-ax3" : ""}`;
          await p.screenshot({ path: `${OUT}/${TAG}/${name}.png` });
          results.push({ name, ...(await measure(p)) });
          await ctx.close();
        }
  }
  if (which.includes("land")) {
    for (const [w, h] of [[844, 390], [852, 393], [932, 430], [667, 375], [568, 320]])
      for (const route of ["today", "play"]) {
        const { ctx, p } = await open(browser, engine, { w, h, route });
        const name = `land-${engine}-${w}x${h}-${route}`;
        await p.screenshot({ path: `${OUT}/${TAG}/${name}.png` });
        const m = await measure(p);
        // Прокрутка до низа: ряд действий доступен.
        await p.evaluate(() => { const sc = document.querySelector(".scroll"); sc.scrollTop = sc.scrollHeight; });
        await p.waitForTimeout(200);
        await p.screenshot({ path: `${OUT}/${TAG}/${name}-bottom.png` });
        results.push({ name, ...m, afterScroll: await measure(p) });
        await ctx.close();
      }
  }
  if (which.includes("ax3")) {
    for (const [w, h] of [[320, 568], [390, 844]])
      for (const lang of ["en", "uk", "ru"])
        for (const route of [`day/${ARCH}`, "today"]) {
          const { ctx, p } = await open(browser, engine, { w, h, lang, ax3: true, route });
          const name = `ax3-${engine}-${w}x${h}-${lang}-${route.replace("/", "_")}`;
          await p.screenshot({ path: `${OUT}/${TAG}/${name}.png` });
          results.push({ name, ...(await measure(p)) });
          await ctx.close();
        }
  }
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}/results.json`, JSON.stringify(results, null, 1));
for (const r of results) console.log(r.name, JSON.stringify({ board: r.board, ink: r.ink, ov: r.overlapInk, sc: r.scroll, sub: r.sub, diffTrunc: r.diffTrunc, src: r.srcVisible, bottomOk: r.bottomOk }));
