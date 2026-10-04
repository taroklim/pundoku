// PD-152 — живая проверка клеточного вордмарка (About, PNG-отпечаток), webkit + chromium.
//
//   cd /tmp/pundoku-ios/pw && BASE=http://localhost:3994 node <repo>/design/pd152-impl-check.mjs
//
// Нужен `vite` на BASE (из worktree). Для PNG — временный зонд apps/web/src/__pd152_probe.ts (не коммитится).
// Пишет design/pd152-impl-shots/*.png, сырой растр для замера -> /tmp/pd152-raw, печатает JSON-строки замеров.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3994";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd152-impl-shots");
const RAW = "/tmp/pd152-raw";
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); mkdirSync(RAW, { recursive: true });
const problems = [];
const log = (o) => console.log(JSON.stringify(o));

async function open(browser, { w = 393, h = 852, dpr = 3, scheme = "light", ax3 = false, lang = "en", extra = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: scheme,
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[lang], ...extra,
  });
  if (ax3) await ctx.addInitScript(() => {
    const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); };
    if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|\/api\//.test(m.text())) errs.push(m.text()); });
  return { ctx, page, errs };
}

async function about(page, lang) {
  await page.goto(`${BASE}/#/settings`);
  const card = page.locator('[data-testid="settings-about"]');
  await card.waitFor({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  return card;
}

const measure = (page) => page.evaluate(() => {
  const svg = document.querySelector("svg.settings-about-word");
  const r = svg.getBoundingClientRect();
  const rect0 = svg.querySelector("rect"), path0 = svg.querySelector("path");
  const cs = (e, p) => getComputedStyle(e)[p];
  const de = document.documentElement;
  return {
    box: [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
    inView: r.left >= 0 && r.right <= innerWidth,
    pageOverflowX: de.scrollWidth > de.clientWidth,
    rects: svg.querySelectorAll("rect").length, paths: svg.querySelectorAll("path").length,
    role: svg.getAttribute("role"), label: svg.getAttribute("aria-label"),
    fillRect: cs(rect0, "fill"), strokePath: cs(path0, "stroke"),
    opacity: cs(svg, "opacity"),
  };
});

const engines = { webkit, chromium };
for (const [name, eng] of Object.entries(engines)) {
  const b = await eng.launch();
  // 1. About: 393 / 320, светлая / тёмная, AX3, uk/ru
  const cases = [
    { w: 393, scheme: "light" }, { w: 393, scheme: "dark" }, { w: 320, scheme: "light" }, { w: 320, scheme: "dark" },
    { w: 393, scheme: "light", ax3: true }, { w: 320, scheme: "dark", ax3: true }, { w: 393, scheme: "light", lang: "uk" }, { w: 393, scheme: "dark", lang: "ru" },
  ];
  for (const c of cases) {
    const { ctx, page, errs } = await open(b, c);
    const card = await about(page, c.lang);
    const m = await measure(page);
    const tag = `${name}-about-${c.w}-${c.scheme}${c.ax3 ? "-ax3" : ""}${c.lang ? "-" + c.lang : ""}`;
    await card.screenshot({ path: join(OUT, `${tag}.png`) });
    const snap = await card.ariaSnapshot();
    log({ tag, ...m, aria: snap.replace(/\n/g, " | "), errs });
    if (m.rects !== 23 || m.paths !== 4 || m.role !== "img" || m.label !== "Pundoku" || !m.inView || m.pageOverflowX) problems.push(tag + " " + JSON.stringify(m));
    if (errs.length) problems.push(tag + " errors " + errs.join(";"));
    await ctx.close();
  }
  // 2. Today (шапка) — не менялась: фиксируем кадр и отсутствие вордмарка
  for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await open(b, { scheme });
    await page.goto(`${BASE}/#/today`);
    await page.waitForTimeout(1500);
    const has = await page.evaluate(() => document.querySelectorAll("svg.wordmark").length);
    await page.screenshot({ path: join(OUT, `${name}-today-${scheme}.png`) });
    log({ tag: `${name}-today-${scheme}`, wordmarksOnToday: has });
    await ctx.close();
  }
  // 3. Реальный растр вордмарка в About на 28 px: DPR 3/2/1, чёрным по белому (измерение читаемости зазора)
  for (const dpr of [3, 2, 1]) {
    const { ctx, page } = await open(b, { dpr, w: 600 });
    await about(page);
    for (const h of [28, 32]) {
      await page.evaluate((h) => {
        document.querySelectorAll("#__m").forEach((e) => e.remove());
        const svg = document.querySelector("svg.settings-about-word").cloneNode(true);
        svg.removeAttribute("class"); svg.setAttribute("height", h); svg.setAttribute("width", Math.round(h * 614 / 116));
        svg.style.cssText = "display:block;--pun:#000;--doku:#000";
        const d = document.createElement("div"); d.id = "__m";
        d.style.cssText = "position:fixed;left:10px;top:10px;z-index:99999;background:#fff;line-height:0";
        d.appendChild(svg); document.body.appendChild(d);
      }, h);
      const buf = await page.screenshot({ clip: { x: 10, y: 10, width: Math.round(h * 614 / 116), height: h } });
      writeFileSync(join(RAW, `${name}-${h}-dpr${dpr}.png`), buf);
      if (dpr === 3) writeFileSync(join(OUT, `${name}-wordmark-${h}px-3x.png`), buf);
    }
    await ctx.close();
  }
  await b.close();
}

// 4. forced-colors (chromium): палитра реально меняется
{
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await open(b, { scheme, extra: { forcedColors: "active" } });
    const card = await about(page);
    const m = await measure(page);
    const sys = await page.evaluate(() => {
      const p = document.createElement("div"); p.style.color = "CanvasText"; p.style.background = "Canvas";
      document.body.appendChild(p); const o = { text: getComputedStyle(p).color, canvas: getComputedStyle(p).backgroundColor }; p.remove(); return o;
    });
    const fc = await page.evaluate(() => matchMedia("(forced-colors: active)").matches);
    await card.screenshot({ path: join(OUT, `chromium-about-forced-${scheme}.png`) });
    log({ tag: `forced-${scheme}`, forcedActive: fc, ...m, sys });
    if (!fc || m.fillRect !== sys.text || m.strokePath !== sys.text) problems.push(`forced-${scheme}: ${JSON.stringify({ m, sys })}`);
    await ctx.close();
  }
  await b.close();
}

// 5. PNG-отпечаток (реальный canvas, реальный renderFingerprintPng)
for (const [name, eng] of Object.entries(engines)) {
  const b = await eng.launch();
  const { ctx, page, errs } = await open(b, { dpr: 1, w: 1200, h: 900 });
  await page.goto(`${BASE}/#/today`);
  await page.waitForTimeout(800);
  for (const [tag, right, no] of [
    ["short", "3 Oct 2026 · 8:14 · 51 moves · clean", false],
    ["long", "3 Oct 2026 · 18:14 · 51 moves · 2 blots · 3 hints", false],
    ["nopath2d", "3 Oct 2026 · 8:14 · 51 moves · clean", true],
  ]) {
    const b64 = await page.evaluate(async ([r, n]) => (await import("/src/__pd152_probe.ts")).probe(r, n), [right, no]);
    const buf = Buffer.from(b64, "base64");
    writeFileSync(join(OUT, `${name}-png-${tag}.png`), buf);
    writeFileSync(join(RAW, `${name}-png-${tag}.png`), buf);
    log({ tag: `${name}-png-${tag}`, bytes: buf.length });
  }
  if (errs.length) problems.push(`${name} png errors ${errs.join(";")}`);
  await ctx.close(); await b.close();
}
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "ALL OK");
