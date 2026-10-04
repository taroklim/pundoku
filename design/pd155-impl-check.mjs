// PD-155 — живая проверка иконки/знака P4 (Year пусто, About, PNG-отпечаток, favicon/manifest/splash), webkit + chromium.
//
//   cd /tmp/pundoku-ios/pw && BASE=http://localhost:5996 node <repo>/design/pd155-impl-check.mjs            # dev: страницы + PNG (нужен зонд src/__pd155_probe.ts)
//   cd /tmp/pundoku-ios/pw && BASE=http://localhost:5996 MODE=build node <repo>/design/pd155-impl-check.mjs  # vite preview сборки: manifest, ссылки, precache
//
// Пишет design/pd155-impl-shots/*.png и печатает JSON-строки замеров + итог.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:5996";
const MODE = process.env.MODE ?? "dev";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd155-impl-shots");
mkdirSync(OUT, { recursive: true });
const problems = [];
const log = (o) => console.log(JSON.stringify(o));
const engines = { webkit, chromium };

async function open(browser, { w = 393, h = 852, dpr = 3, scheme = "light", lang = "en", extra = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: scheme,
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[lang], ...extra,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|\/api\//.test(m.text())) errs.push(m.text()); });
  return { ctx, page, errs };
}

const markInfo = (page, sel) => page.evaluate((sel) => {
  const s = document.querySelector(sel);
  if (!s) return null;
  const r = s.getBoundingClientRect();
  const cs = getComputedStyle(s.querySelector("rect, path"));
  return { rects: s.querySelectorAll("rect").length, paths: s.querySelectorAll("path").length, optics: s.dataset.optics, box: [r.width, r.height],
    hidden: s.getAttribute("aria-hidden"), fill: cs.fill, inView: r.left >= 0 && r.right <= innerWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}, sel);

if (MODE === "dev") {
  for (const [name, eng] of Object.entries(engines)) {
    const b = await eng.launch();
    // Year пусто + About: 393/320, светлая/тёмная
    for (const c of [{ w: 393, scheme: "light" }, { w: 393, scheme: "dark" }, { w: 320, scheme: "light" }, { w: 320, scheme: "dark" }]) {
      const { ctx, page, errs } = await open(b, c);
      await page.goto(`${BASE}/#/year`);
      await page.waitForTimeout(1800);
      const ye = page.locator('[data-testid="year-empty"]');
      const tag = `${name}-year-empty-${c.w}-${c.scheme}`;
      if (await ye.count()) {
        const m = await markInfo(page, ".year-empty-mark");
        await page.screenshot({ path: join(OUT, `${tag}.png`) });
        log({ tag, ...m, errs });
        if (!m || m.rects !== 9 || m.optics !== "small" || m.hidden !== "true" || !m.inView || m.overflowX) problems.push(`${tag} ${JSON.stringify(m)}`);
      } else { problems.push(`${tag}: year-empty not shown`); await page.screenshot({ path: join(OUT, `${tag}-MISSING.png`) }); }
      await page.goto(`${BASE}/#/settings`);
      const card = page.locator('[data-testid="settings-about"]');
      await card.waitFor({ timeout: 15000 });
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const sel = '[data-testid="settings-about"] svg.brand-mark';
      const am = await markInfo(page, sel);
      const wm = await page.evaluate(() => document.querySelectorAll('[data-testid="settings-about"] svg.settings-about-word').length);
      const at = `${name}-about-${c.w}-${c.scheme}`;
      await card.screenshot({ path: join(OUT, `${at}.png`) });
      log({ tag: at, mark: am, wordmarks: wm, errs });
      if (!am || am.rects !== 9 || wm !== 1 || !am.inView || am.overflowX) problems.push(`${at} ${JSON.stringify({ am, wm })}`);
      if (errs.length) problems.push(`${at} errors ${errs.join(";")}`);
      await ctx.close();
    }
    // favicon <link> в голове реального документа + реальная загрузка файлов
    {
      const { ctx, page } = await open(b, {});
      await page.goto(`${BASE}/`);
      const links = await page.evaluate(() => [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => ({ rel: l.rel, href: l.getAttribute("href"), sizes: l.getAttribute("sizes"), type: l.getAttribute("type") })));
      log({ tag: `${name}-links`, links });
      for (const l of links) {
        const r = await page.request.get(new URL(l.href, BASE).href);
        const ct = r.headers()["content-type"];
        log({ tag: `${name}-link-get`, href: l.href, status: r.status(), ct });
        if (r.status() !== 200) problems.push(`${l.href} -> ${r.status()}`);
      }
      if (links.length !== 4 || !links.every((l) => l.href.includes("v=p4"))) problems.push(`links ${JSON.stringify(links)}`);
      await ctx.close();
    }
    await b.close();
  }
  // forced-colors (chromium)
  {
    const b = await chromium.launch();
    for (const scheme of ["light", "dark"]) {
      const { ctx, page } = await open(b, { scheme, extra: { forcedColors: "active" } });
      await page.goto(`${BASE}/#/settings`);
      const card = page.locator('[data-testid="settings-about"]');
      await card.waitFor({ timeout: 15000 });
      await card.scrollIntoViewIfNeeded();
      const m = await markInfo(page, '[data-testid="settings-about"] svg.brand-mark');
      const sys = await page.evaluate(() => { const p = document.createElement("div"); p.style.color = "CanvasText"; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
      const fc = await page.evaluate(() => matchMedia("(forced-colors: active)").matches);
      await card.screenshot({ path: join(OUT, `chromium-about-forced-${scheme}.png`) });
      log({ tag: `forced-${scheme}`, forcedActive: fc, fill: m?.fill, canvasText: sys });
      if (!fc || m.fill !== sys) problems.push(`forced-${scheme}: ${m?.fill} vs ${sys}`);
      await ctx.close();
    }
    await b.close();
  }
  // PNG-отпечаток со штампом
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
      const b64 = await page.evaluate(async ([r, n]) => (await import("/src/__pd155_probe.ts")).probe(r, n), [right, no]);
      const buf = Buffer.from(b64, "base64");
      writeFileSync(join(OUT, `${name}-png-${tag}.png`), buf);
      log({ tag: `${name}-png-${tag}`, bytes: buf.length, png: buf.subarray(1, 4).toString() });
      if (buf.subarray(1, 4).toString() !== "PNG") problems.push(`${name}-png-${tag} not a PNG`);
    }
    if (errs.length) problems.push(`${name} png errors ${errs.join(";")}`);
    await ctx.close(); await b.close();
  }
} else {
  // Сборка (vite preview): manifest, иконки из него, splash-ссылки из index.html, precache sw.js
  for (const [name, eng] of Object.entries(engines)) {
    const b = await eng.launch();
    const { ctx, page } = await open(b, {});
    await page.goto(`${BASE}/`);
    const mHref = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href"));
    const mr = await page.request.get(new URL(mHref, BASE).href);
    const man = await mr.json();
    log({ tag: `${name}-manifest`, href: mHref, status: mr.status(), icons: man.icons });
    if (mr.status() !== 200) problems.push(`manifest ${mr.status()}`);
    for (const i of man.icons) {
      const r = await page.request.get(new URL(i.src, BASE).href);
      log({ tag: `${name}-manifest-icon`, src: i.src, sizes: i.sizes, purpose: i.purpose, status: r.status(), bytes: (await r.body()).length });
      if (r.status() !== 200) problems.push(`manifest icon ${i.src} ${r.status()}`);
    }
    const splash = await page.evaluate(() => [...document.querySelectorAll('link[rel="apple-touch-startup-image"]')].map((l) => l.getAttribute("href")));
    let bad = 0;
    for (const h of splash) { const r = await page.request.get(new URL(h, BASE).href); if (r.status() !== 200) { bad++; problems.push(`splash ${h} ${r.status()}`); } }
    log({ tag: `${name}-splash`, links: splash.length, unique: new Set(splash).size, non200: bad });
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute("href")));
    for (const h of links) { const r = await page.request.get(new URL(h, BASE).href); log({ tag: `${name}-icon-link`, h, status: r.status() }); if (r.status() !== 200) problems.push(`link ${h} ${r.status()}`); }
    const sw = await (await page.request.get(`${BASE}/sw.js`)).text();
    const pre = ["favicon-16.png", "favicon-32.png", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon-180.png"].map((f) => [f, sw.includes(f)]);
    log({ tag: `${name}-precache`, pre });
    if (pre.some(([, ok]) => !ok)) problems.push(`precache ${JSON.stringify(pre)}`);
    await ctx.close(); await b.close();
  }
}
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "ALL OK");
