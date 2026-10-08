/**
 * PD-242 п. 3 (QA PD-226 Low): розовая кайма красной подложки `.del` в скруглённых углах карточки «Режимы» (светлая тема).
 * Партии в первом (Классика) и последнем (Глифы) режимах → у их строк есть `.del`; снимаем карточку в покое и углы крупно,
 * считаем «розовые» пиксели в углах (r − max(g, b) > 8: фон #F2F2F7/#000 и карточка #FFF/#1C1C1E нейтральны или синее). Один браузер (chromium), 390 pt, light + dark.
 *   PD_PW_HOME=<папка с node_modules/playwright> BASE=http://localhost:5742 TAG=before|after node design/pd242-shots.mjs
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pw = createRequire((process.env.PD_PW_HOME || "/tmp/pundoku-qa/pw") + "/")("playwright");
const BASE = process.env.BASE || "http://localhost:5742";
const TAG = process.env.TAG || "after";
const OUT = join(HERE, "pd242-shots");
mkdirSync(OUT, { recursive: true });
const BOARD = ".play:not(.today) .board";

async function startGame(page, mode) {
  await page.locator(`[data-testid="mode-${mode}"]`).click();
  await page.locator('[data-testid="sheet-start"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const easy = page.locator('[data-testid="difficulty-easy"]');
  if (await easy.count()) await easy.click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.waitForTimeout(700);
  for (const id of ["ink-rule-start", "rule-start"]) {
    const go = page.locator(`[data-testid="${id}"]`);
    if (await go.count()) await go.click();
  }
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);
  const empty = await page.evaluate((b) => {
    for (const c of document.querySelectorAll(`${b} .cell`)) if (!c.querySelector(".d.given")) return c.getAttribute("data-i");
    return null;
  }, BOARD);
  await page.locator(`${BOARD} .cell[data-i="${empty}"]`).click();
  await page.locator(".play:not(.today) .pad .key").nth(4).click();
  await page.waitForTimeout(400);
  await page.locator("#tab-play").click();
  await page.locator('[data-testid="hub-scroll"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
}

/** Розовые пиксели в PNG (декод в странице через canvas) + увеличенная ×8 копия без сглаживания для глаза. */
async function redCount(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] - Math.max(d[i + 1], d[i + 2]) > 8) n++;
    const z = document.createElement("canvas");
    z.width = img.width * 8;
    z.height = img.height * 8;
    const zg = z.getContext("2d");
    zg.imageSmoothingEnabled = false;
    zg.drawImage(img, 0, 0, z.width, z.height);
    return { n, zoom: z.toDataURL("image/png").split(",")[1] };
  }, png.toString("base64"));
}

const results = [];
const browser = await pw.chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      colorScheme: scheme,
      locale: "en-US",
      serviceWorkers: "block",
    });
    try {
      await ctx.addInitScript(() => localStorage.setItem("pundoku.locale", "en"));
      await ctx.route("**/api/**", (r) => r.fulfill({ status: 503, body: "" }));
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#/play`);
      await page.locator('[data-testid="mode-classic"]').waitFor({ timeout: 60000 });
      await page.waitForTimeout(500);
      const modes = await page.evaluate(() => [...document.querySelectorAll(".srow")].map((r) => r.getAttribute("data-testid").slice(5)));
      const first = modes[0];
      const last = modes.at(-1);
      await startGame(page, first);
      await startGame(page, last);
      const slots = await page.evaluate(() => [...document.querySelectorAll('.srow[data-slot="1"]')].map((r) => r.getAttribute("data-testid")));
      const card = page.locator('[data-testid="hub-modes"] .hub-card');
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const b = await card.boundingBox();
      await page.screenshot({ path: join(OUT, `${TAG}-card-390-${scheme}.png`), clip: { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 } });
      const S = 22;
      const corners = {
        tr: { x: b.x + b.width - S, y: b.y, width: S, height: S },
        br: { x: b.x + b.width - S, y: b.y + b.height - S, width: S, height: S },
      };
      const red = {};
      for (const [k, clip] of Object.entries(corners)) {
        const png = await page.screenshot({ clip, scale: "device" });
        writeFileSync(join(OUT, `${TAG}-corner-${k}-390-${scheme}.png`), png);
        const r = await redCount(page, png);
        red[k] = r.n;
        writeFileSync(join(OUT, `${TAG}-corner-${k}-390-${scheme}-x8.png`), Buffer.from(r.zoom, "base64"));
      }
      // Открытая строка по-прежнему красная (класс .open) — кадр для сравнения.
      const row = await page.locator(`[data-testid="mode-${first}"]`).boundingBox();
      const cdp = await ctx.newCDPSession(page);
      const at = (dx) => ({ x: row.x + row.width - 40 + dx, y: row.y + row.height / 2 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(0)] });
      for (let i = 1; i <= 10; i++) {
        await new Promise((r) => setTimeout(r, 16));
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at(-7 * i)] });
      }
      await new Promise((r) => setTimeout(r, 160));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(600);
      const open = await page.evaluate((m) => {
        const w = document.querySelector(`[data-testid="srow-${m}"]`);
        const del = w.querySelector(".del");
        return { cls: w.className, delBg: getComputedStyle(del).backgroundColor, fgX: new DOMMatrix(getComputedStyle(w.querySelector(".fg")).transform).m41 };
      }, first);
      await page.screenshot({ path: join(OUT, `${TAG}-open-390-${scheme}.png`), clip: { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: Math.min(b.height, 140) } });
      const rest = await page.evaluate((m) => getComputedStyle(document.querySelector(`[data-testid="srow-${m}"] .del`)).backgroundColor, last);
      results.push({ scheme, slots, red, open, restDelBg: rest });
      console.log(scheme, JSON.stringify({ slots, red, open, restDelBg: rest }));
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${TAG}-results.json`), JSON.stringify(results, null, 2));
