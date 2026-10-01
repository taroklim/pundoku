/**
 * PD-102 — кадры: малая оптика D5 (до/после), apple-touch-icon на обоях, favicon во вкладке, About и Year-пусто в приложении.
 *
 * Порты: только 3986 (web, `vite preview` реальной сборки) и 5986 (api); /api* перенаправляется на 5986 через page.route
 * (preview проксирует на :3000 — занят чужим). Никаких pkill/killall.
 *
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     <repo>/design/pd102-shots.mjs [optics|app|check]...
 *
 * Пишет design/pd102-shots/*.png (cr- chromium, wk- webkit) и печатает JSON-отчёт проверок (консоль, горизонтальный скролл,
 * размеры знака) в stdout.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd102-shots");
mkdirSync(OUT, { recursive: true });
const OPTICS = pathToFileURL(join(DIR, "pd102-optics.html")).href;
const APP = "http://localhost:3986";
const API = "http://localhost:5986";
const ENGINES = [["cr", chromium], ["wk", webkit]];
const want = new Set(process.argv.slice(2));
const run = (n) => want.size === 0 || want.has(n);
const report = { optics: [], app: [] };

/* ------------------------------------------------------------ малая оптика (статичная страница) */
async function optics() {
  for (const [tag, bt] of ENGINES) {
    const browser = await bt.launch();
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, colorScheme: scheme });
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      p.on("requestfailed", (r) => errs.push("requestfailed " + r.url()));
      await p.goto(OPTICS);
      await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      for (const ap of ["light", "dark", "tinted"]) {
        const el = p.locator(`#optics`).first();
        // кадр: две строки (полная/малая) этой подачи
        const rows = p.locator(`.row[data-ap="${ap}"]`);
        const box0 = await rows.nth(0).boundingBox();
        const box1 = await rows.nth(1).boundingBox();
        await p.screenshot({
          path: join(OUT, `${tag}-optics-${ap}-page-${scheme}.png`),
          clip: { x: 0, y: box0.y - 6, width: 393, height: box1.y + box1.height - box0.y + 12 },
          fullPage: true,
        });
        void el;
      }
      await p.locator("#touch").screenshot({ path: join(OUT, `${tag}-touch-${scheme}.png`) });
      await p.locator("#favicon").screenshot({ path: join(OUT, `${tag}-favicon-${scheme}.png`) });
      const hs = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      report.optics.push({ engine: tag, scheme, errs, hScroll: hs });
      await ctx.close();
    }
    await browser.close();
  }
}

/* ------------------------------------------------------------ приложение: About и Year-пусто */
async function app() {
  for (const [tag, bt] of ENGINES) {
    const browser = await bt.launch();
    for (const scheme of ["light", "dark"]) {
      for (const w of [320, 390, 430]) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: 800 },
          deviceScaleFactor: 3,
          colorScheme: scheme,
          hasTouch: true,
          serviceWorkers: "block",
        });
        await ctx.addInitScript(() => localStorage.setItem("pundoku.locale", "uk"));
        // preview проксирует /api на :3000 (чужой порт) — отправляем на наш api
        await ctx.route("**/api/**", (r) => r.continue({ url: r.request().url().replace(APP, API) }));
        await ctx.route("**/health", (r) => r.continue({ url: API + "/health" }));
        const p = await ctx.newPage();
        const errs = [];
        p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
        p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errs.push(`console.${m.type()}: ${m.text()}`));
        p.on("requestfailed", (r) => errs.push("requestfailed: " + r.url()));
        p.on("response", (r) => r.status() >= 400 && errs.push(`http ${r.status()}: ${r.url()}`));

        const tagName = `${tag}-${w}-${scheme}-uk`;
        // Year, пусто
        await p.goto(`${APP}/#/year`);
        await p.waitForSelector('[data-testid="year-empty"]');
        await p.waitForTimeout(350);
        const yearMark = await p.evaluate(() => {
          const m = document.querySelector(".year-empty-mark");
          const r = m.getBoundingClientRect();
          return { w: r.width, h: r.height, color: getComputedStyle(m).color, optics: m.dataset.optics };
        });
        await p.locator('[data-testid="year-empty"]').scrollIntoViewIfNeeded();
        await p.screenshot({ path: join(OUT, `${tagName}-year-empty.png`) });
        const hsYear = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

        // Settings -> About
        await p.goto(`${APP}/#/settings`);
        await p.waitForSelector('[data-testid="settings-about"]');
        await p.waitForTimeout(350);
        const about = await p.evaluate(() => {
          const rect = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
          const doku = document.querySelector(".settings-about-word g:nth-of-type(1) g:nth-of-type(2) path");
          return {
            mark: rect(".settings-about-mark"), word: rect(".settings-about-word"),
            ver: document.querySelector('[data-testid="about-version"]').textContent,
            markColor: getComputedStyle(document.querySelector(".settings-about-mark")).color,
            dokuStroke: getComputedStyle(doku).stroke,
            head: document.querySelector("#settings-h-about").textContent,
          };
        });
        await p.locator('[data-testid="settings-about"]').scrollIntoViewIfNeeded();
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await p.screenshot({ path: join(OUT, `${tagName}-about.png`) });
        const hsSet = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        report.app.push({ tag: tagName, errs, hScroll: { year: hsYear, settings: hsSet }, yearMark, about });
        await ctx.close();
      }
    }
    await browser.close();
  }
}

if (run("optics")) await optics();
if (run("app")) await app();
console.log(JSON.stringify(report, null, 1));
