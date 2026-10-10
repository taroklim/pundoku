/**
 * PD-296 — кадры макета design/pd296-pet-places.html (Питомец «Капля»: 3 варианта реакции на тап + 8 мест).
 * Макет подключает НАСТОЯЩИЕ apps/web/src/styles/tokens.css и pet.css (по file://), разметка кляксы — как PetBlot.tsx.
 *
 * Запуск (из products/pundoku):
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd296-shots.mjs
 *   BROWSERS=chromium (по умолчанию) или chromium,webkit; DSF=2 (по умолчанию; DSF=1 → PNG ровно 393×852); ONLY=tap-A (подстрока имени)
 *
 * Порт не занимается (file://), чужие vite preview не трогаются. Браузер закрывается в finally.
 * Пишет design/pd296-shots/<prefix?><name>.png (prefix «wk-» только для webkit) и checks-<engine>.json.
 * Автопроверки (PD296.check в макете): ошибки JS, нет горизонтального переполнения, зона тапа ≥ 44×44 и не пересекает
 * другие элементы управления, клякса не наезжает на текст, на экране дышит не больше одной кляксы.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

function loadPlaywright() {
  const bases = [process.cwd(), process.env.PD_PW_HOME, "/tmp/pundoku-qa/pw", "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend"].filter(Boolean);
  const tried = [];
  for (const b of bases) {
    try { return createRequire(join(b, "noop.js"))("playwright"); } catch (e) { tried.push(b + " (" + e.code + ")"); }
  }
  console.error("Playwright не найден. Искал от: " + tried.join(", ") + "\nЗадай PD_PW_HOME на папку с node_modules/playwright.");
  process.exit(1);
}
const PW = loadPlaywright();
const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd296-shots");
const PAGE = pathToFileURL(join(DIR, "pd296-pet-places.html")).href;
mkdirSync(OUT, { recursive: true });

const BROWSERS = (process.env.BROWSERS ?? "chromium").split(",").map((s) => s.trim()).filter(Boolean);
const DSF = Number(process.env.DSF ?? 2);
const ONLY = process.env.ONLY ?? "";
const problems = [];

async function listShots(browser) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } });
  try {
    const page = await ctx.newPage();
    await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD296);
    return await page.evaluate(() => window.PD296.SHOTS);
  } finally { await ctx.close(); }
}

async function shoot(bname) {
  const browser = await PW[bname].launch();
  const prefix = bname === "webkit" ? "wk-" : "";
  const report = [];
  try {
    const shots = (await listShots(browser)).filter((s) => !ONLY || s.name.includes(ONLY));
    console.log(`${bname}: кадров ${shots.length}`);
    for (const s of shots) {
      const ctx = await browser.newContext({
        viewport: { width: s.w, height: s.h }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, locale: "en-US",
        colorScheme: s.theme === "dark" ? "dark" : "light", reducedMotion: s.rm ? "reduce" : "no-preference",
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD296);
        // Стили tokens.css/pet.css подключены <link> по file:// — убедимся, что они действительно применились.
        const linked = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--e-io").trim());
        if (!linked) errors.push("tokens.css не подключился (нет --e-io)");
        const r = await page.evaluate((n) => window.PD296.shot(n), s.name);
        await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
        await page.screenshot({ path: join(OUT, `${prefix}${s.name}.png`) });
        const all = [...errors, ...r.problems];
        report.push({ shot: `${prefix}${s.name}`, w: s.w, h: s.h, theme: s.theme, problems: all });
        if (all.length) { problems.push(`${prefix}${s.name}`); console.log(`  ! ${prefix}${s.name}: ${all.slice(0, 4).join(" | ")}`); }
        else console.log(`  ok ${prefix}${s.name}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
  writeFileSync(join(OUT, `checks-${bname}.json`), JSON.stringify(report, null, 2) + "\n");
}

async function overview() {
  const browser = await PW.chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme });
      try {
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: "load" });
        await page.waitForFunction(() => !!window.PD296);
        await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; }));
        await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
        const c = await page.evaluate(() => window.PD296.check());
        if (c.length) { problems.push(`overview-${theme}`); console.log(`  ! overview-${theme}: ${c.slice(0, 4).join(" | ")}`); }
        else console.log(`  ok overview-${theme}`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}

for (const b of BROWSERS) await shoot(b);
if (!ONLY) await overview();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
