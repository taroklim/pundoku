/**
 * PD-161 — A/B длительностей кадров при смене вкладки: сборка main (кроссфейд M10) против ветки (слайд «Лента»),
 * поочерёдно в одних и тех же условиях (машина агентов нагружена — абсолютные цифры headless webkit шумные, важна разница).
 *   OLD=http://localhost:5498 NEW=http://localhost:5497 PD_PW_HOME=/tmp/pd161-pw node design/pd161-frames-ab.mjs
 * Окно замера: 450 мс после тапа (переход 300 мс + запас). Печатает по движку: кадров > 50 мс и максимум, по каждой сборке.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
const PW_HOME = process.env.PD_PW_HOME || "/tmp/pd16-pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
const { chromium, webkit } = createRequire(PW_HOME + "/")("playwright");
const OLD = process.env.OLD ?? "http://localhost:5498";
const NEW = process.env.NEW ?? "http://localhost:5497";
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const SEQ = ["play", "year", "today", "year", "play", "today"];

async function session(eng, base) {
  const b = await eng.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${base}/#/today`);
  await page.waitForSelector(".board:not(.idle)", { timeout: 30000 });
  // Прогрев: каждая вкладка один раз (первый маунт не входит в замер ни у одной сборки).
  for (const id of ["play", "year", "today"]) {
    await page.evaluate((id) => document.getElementById(`tab-${id}`).click(), id);
    await page.waitForTimeout(500);
  }
  return { b, page };
}
const measure = (page, to) =>
  page.evaluate(async (to) => {
    const f = [];
    let on = true;
    const loop = (t) => {
      if (!on) return;
      f.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    document.getElementById(`tab-${to}`).click();
    await new Promise((r) => setTimeout(r, 450));
    on = false;
    const d = [];
    for (let i = 1; i < f.length; i++) if (f[i] > t0) d.push(f[i] - f[i - 1]);
    return d;
  }, to);

for (const [name, eng] of Object.entries({ chromium, webkit })) {
  const acc = { old: [], new: [] };
  for (let r = 0; r < ROUNDS; r++)
    for (const [k, base] of r % 2 ? [["new", NEW], ["old", OLD]] : [["old", OLD], ["new", NEW]]) {
      const { b, page } = await session(eng, base);
      for (const to of SEQ) {
        acc[k].push(...(await measure(page, to)));
        await page.waitForTimeout(200);
      }
      await b.close();
    }
  for (const k of ["old", "new"]) {
    const d = acc[k];
    const over = d.filter((x) => x > 50).length;
    const sorted = [...d].sort((a, b) => a - b);
    console.log(`${name} ${k === "old" ? "main (кроссфейд)" : "PD-161 (слайд)  "}: кадров ${d.length}, > 50 мс: ${over} (${((over / d.length) * 100).toFixed(1)} %), p95 ${sorted[Math.floor(d.length * 0.95)].toFixed(0)} мс, max ${sorted[d.length - 1].toFixed(0)} мс`);
  }
}
