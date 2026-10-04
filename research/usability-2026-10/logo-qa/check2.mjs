// PD-153 QA: a11y, forced-colors (+мутации правил), print, prefers-contrast, reduced-transparency, вёрстка.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(process.cwd() + "/")("playwright");
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://127.0.0.1:3995";
const problems = []; const log = (o) => console.log(JSON.stringify(o));
const P = (c, m) => { if (!c) { problems.push(m); console.log("FAIL", m); } };
const LOC = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };

async function open(b, { w = 393, h = 852, dpr = 3, scheme = "light", lang = "en", ax3 = false, extra = {} } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: scheme, locale: LOC[lang], ...extra });
  if (ax3) await ctx.addInitScript(() => { const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); }; document.documentElement ? add() : document.addEventListener("DOMContentLoaded", add); });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/#/settings`);
  const card = page.locator('[data-testid="settings-about"]');
  await card.waitFor({ timeout: 20000 }); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  return { ctx, page, card, errs };
}
const state = (page) => page.evaluate(() => {
  const s = document.querySelector("svg.settings-about-word"); const r = s.getBoundingClientRect();
  const card = s.closest(".settings-card").getBoundingClientRect(); const de = document.documentElement;
  const r0 = s.querySelector("rect"), p0 = s.querySelector("path");
  return { box: [r.width, r.height], inCard: r.left >= card.left - 0.5 && r.right <= card.right + 0.5, inView: r.left >= 0 && r.right <= innerWidth,
    overflowX: de.scrollWidth > de.clientWidth, fillRect: getComputedStyle(r0).fill, strokePath: getComputedStyle(p0).stroke, opacity: getComputedStyle(s).opacity,
    fillRectAll: [...new Set([...s.querySelectorAll("rect")].map(r => getComputedStyle(r).fill))], rolev: s.getAttribute("role"), label: s.getAttribute("aria-label") };
});

for (const [name, T] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await T.launch();
  // ---- (4) a11y на en/uk/ru
  for (const lang of ["en", "uk", "ru"]) {
    const { ctx, page, card, errs } = await open(b, { lang });
    const s = await state(page);
    P(s.rolev === "img" && s.label === "Pundoku", `${name}/${lang} role/label: ${s.rolev}/${s.label}`);
    const snap = await card.ariaSnapshot();
    log({ name, lang, snap });
    P((snap.match(/Pundoku/g) || []).length === 1, `${name}/${lang} имя Pundoku в дереве ровно 1 раз: ${JSON.stringify(snap)}`);
    P(/img "Pundoku"/.test(snap), `${name}/${lang} есть img "Pundoku"`);
    P(!/rect|path/i.test(snap), `${name}/${lang} клетки не в дереве`);
    const cnt = await page.evaluate(() => { const s = document.querySelector("svg.settings-about-word"); return { hid: [...s.querySelectorAll("rect,path")].every(e => e.closest('[aria-hidden="true"]') && e.closest('[aria-hidden="true"]') !== s), tab: s.getAttribute("focusable"), tabindex: s.getAttribute("tabindex") }; });
    P(cnt.hid && cnt.tab === "false" && cnt.tabindex === null, `${name}/${lang} aria-hidden/focusable ${JSON.stringify(cnt)}`);
    const rolesByName = await page.getByRole("img", { name: "Pundoku" }).count();
    P(rolesByName === 1 || name === "webkit", `${name}/${lang} getByRole img Pundoku count=${rolesByName}`);
    // фокус: пройти Tab от последнего элемента перед About; вордмарк/карточка не получают фокус
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const stops = [];
    await page.keyboard.press("Tab");
    for (let i = 0; i < 80; i++) {
      const id = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.closest(".settings-about") ? "ABOUT:" + a.tagName : a.tagName + (a.getAttribute("aria-label") || a.textContent || "").slice(0, 14)) : "body"; });
      stops.push(id); await page.keyboard.press("Tab");
    }
    P(!stops.some(x => x.startsWith("ABOUT")), `${name}/${lang} фокус не заходит в About`);
    if (errs.length) problems.push(`${name}/${lang} pageerrors ${errs}`);
    await ctx.close();
  }
  // ---- (6) вёрстка
  for (const w of [320, 375, 393]) for (const scheme of ["light", "dark"]) for (const ax3 of [false, true]) for (const lang of ["en", "uk", "ru"]) {
    if (lang !== "en" && (w === 375)) continue;
    const { ctx, page } = await open(b, { w, h: 700, scheme, ax3, lang });
    const s = await state(page);
    const tag = `${name}/${w}/${scheme}/${ax3 ? "ax3" : "n"}/${lang}`;
    P(s.inCard && s.inView && !s.overflowX, `${tag} вёрстка inCard=${s.inCard} inView=${s.inView} overflowX=${s.overflowX} box=${s.box}`);
    log({ tag, box: s.box.map(Math.round), fill: s.fillRect, stroke: s.strokePath });
    if (w === 320 && ax3 && lang === "en") await page.locator('[data-testid="settings-about"]').screenshot({ path: join(HERE, `shots/${name}-about-320-ax3-${scheme}.png`) });
    await ctx.close();
  }
  await b.close();
}

// ---- (5) forced-colors, chromium (+ webkit без поддержки emulate? проверим)
{
  const b = await chromium.launch();
  const variants = { full: [], noSettingsRect: [".settings-about-word rect"], noBrandRect: [".wordmark rect"], noRect: [".settings-about-word rect", ".wordmark rect"], noPathBrand: [".wordmark path"], noPath: [".settings-about-word path", ".wordmark path"] };
  for (const scheme of ["light", "dark"]) for (const [vn, kill] of Object.entries(variants)) {
    const { ctx, page, card } = await open(b, { scheme });
    await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
    await page.evaluate((kill) => {
      for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } 
        const walk = (list, parent) => { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.cssRules && r.conditionText !== undefined) walk(r.cssRules, r); else if (r.selectorText && kill.includes(r.selectorText.trim())) (parent || sh).deleteRule(i); } };
        walk(rules, null); }
    }, kill);
    await page.waitForTimeout(250);
    const s = await state(page);
    const svg = page.locator("svg.settings-about-word");
    const img = await svg.screenshot();
    const stat = await page.evaluate(async (b64) => { const i = new Image(); await new Promise(r => { i.onload = r; i.src = "data:image/png;base64," + b64; });
      const k = document.createElement("canvas"); k.width = i.width; k.height = i.height; const x = k.getContext("2d"); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, i.width, i.height).data;
      // фон = пиксель (0,0); считаем доли «чернил» в левой (Pun) и правой (doku) частях
      const bg = [d[0], d[1], d[2]]; let L = 0, R = 0; const half = Math.round(i.width * 0.34);
      for (let y = 0; y < i.height; y++) for (let xx = 0; xx < i.width; xx++) { const o = (y * i.width + xx) * 4; if (Math.abs(d[o]-bg[0]) + Math.abs(d[o+1]-bg[1]) + Math.abs(d[o+2]-bg[2]) > 120) { if (xx < half) L++; else R++; } }
      return { bg, pun: L, doku: R }; }, img.toString("base64"));
    log({ scheme, variant: vn, fillRect: s.fillRectAll, strokePath: s.strokePath, ...stat });
    if (scheme === "light" || vn === "full") writeFileSync(join(HERE, `shots/forced-${scheme}-${vn}.png`), img);
    if (vn === "full") { P(stat.pun > 500 && stat.doku > 1000, `forced ${scheme} full: Pun/doku видны ${stat.pun}/${stat.doku}`); }
    await ctx.close();
  }
  // print
  { const { ctx, page } = await open(b, { scheme: "dark" }); await page.emulateMedia({ media: "print" }); const s = await state(page); log({ print: s.fillRectAll, stroke: s.strokePath });
    P(s.fillRectAll.join() === "rgb(0, 0, 0)" && s.strokePath === "rgb(0, 0, 0)", `print colours ${s.fillRectAll} ${s.strokePath}`); await ctx.close(); }
  // prefers-contrast / reduced-transparency / reduced-motion
  for (const m of [{ contrast: "more" }, { reducedMotion: "reduce" }]) {
    const { ctx, page } = await open(b); await page.emulateMedia(m); const s = await state(page); log({ m, fill: s.fillRectAll, stroke: s.strokePath, opacity: s.opacity }); 
    P(s.opacity === "1" && s.fillRectAll.length === 1 && s.fillRectAll[0] !== "none", `emulate ${JSON.stringify(m)} fill ${s.fillRectAll}`); await ctx.close(); }
  await b.close();
}
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "ALL OK");
