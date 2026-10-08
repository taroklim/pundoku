/**
 * PD-216 — цена настоящего blur тумана Фонаря: чередующиеся раунды «с blur» / «без blur (только opacity)» на одной партии
 * (плотно: ~2/3 пустых клеток — свои цифры, 6 клеток с заметками), смена выбранной клетки (клик → 2 кадра) и осмотр вкл/выкл (⋯).
 *
 *   cd apps/web && npx vite preview --port 5210 --strictPort
 *   PD_PW_HOME=<папка с node_modules/playwright> node design/pd216-perf.mjs   (ENGINE=cr — chromium, ROUNDS=6)
 *
 * Результат прогона 2026-10-08 (webkit headless, mac13): design/pd216-shots/pd216-perf-interleaved-wk.json.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { webkit, chromium } = createRequire((process.env.PD_PW_HOME || "/tmp/pundoku-qa/pw") + "/")("playwright");
const { solve } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);
const BASE = process.env.BASE ?? "http://localhost:5210";
const BOARD = ".play:not(.today) .board";
const ROUNDS = Number(process.env.ROUNDS ?? 6);
const type = process.env.ENGINE === "cr" ? chromium : webkit;
const browser = await type.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/play`);
  await page.locator('[data-testid="mode-lantern"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="mode-lantern"]').click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="difficulty-easy"]').click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(700);
  const g = await page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d.given")?.textContent?.trim() || "0";
    return out.join("");
  }, BOARD);
  const sol = solve(g).join("");
  const empty = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
  // Dense: fill ~2/3 of empty cells with own digits, notes in 6 more — worst case for blur count.
  const mine = empty.filter((_, k) => k % 3 !== 2);
  const noted = empty.filter((_, k) => k % 3 === 2).slice(0, 6);
  for (const i of mine) {
    await page.locator(`${BOARD} .cell[data-i="${i}"]`).click();
    await page.locator(".play:not(.today) .pad .key").nth(Number(sol[i]) - 1).click();
  }
  for (const i of noted) {
    await page.locator(`${BOARD} .cell[data-i="${i}"]`).click();
    await page.locator(".play:not(.today) .actions .act").nth(0).click();
    for (const d of [Number(sol[i]), (Number(sol[i]) % 9) + 1, ((Number(sol[i]) + 3) % 9) + 1]) await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
    await page.locator(".play:not(.today) .actions .act").nth(0).click();
  }
  await page.locator(`${BOARD} .cell[data-i="40"]`).click();
  await page.waitForTimeout(500);
  const blurredCount = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .cell.is-shadow .d.player, ${sel} .cell.is-shadow .marks`)].length, BOARD);
  const seq = [40, 0, 80, 8, 72, 30, 50, 12, 68, 4, 44, 76, 36, 20, 60, 2, 78, 41, 39, 13, 67, 31, 49, 22];
  const sel = () =>
    page.evaluate(
      async ({ sel, cells }) => {
        const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
        const out = [];
        for (const i of cells) {
          const el = document.querySelector(`${sel} .cell[data-i="${i}"]`);
          await raf();
          const t0 = performance.now();
          el.click();
          await raf();
          await raf();
          out.push(performance.now() - t0);
        }
        return out;
      },
      { sel: BOARD, cells: seq },
    );
  // Inspect on (⋯ menu path is UI; use direct keyboard? use menu click timing) / off ("Готово").
  const inspectToggle = async () => {
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-inspect"]').waitFor();
    await page.waitForTimeout(350);
    const on = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      await raf();
      const t0 = performance.now();
      document.querySelector('[data-testid="menu-inspect"]').click();
      await raf();
      await raf();
      return performance.now() - t0;
    });
    await page.waitForTimeout(350);
    const off = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      await raf();
      const t0 = performance.now();
      document.querySelector('[data-testid="inspect-done"]').click();
      await raf();
      await raf();
      return performance.now() - t0;
    });
    await page.waitForTimeout(350);
    return { on, off };
  };
  const NOBLUR = `${BOARD} .cell.is-shadow .d.player, ${BOARD} .cell.is-shadow .marks{filter:opacity(0.32) !important}`;
  const acc = { blur: [], noBlur: [], onBlur: [], offBlur: [], onNo: [], offNo: [] };
  for (let r = 0; r < ROUNDS; r++) {
    const order = r % 2 ? ["noBlur", "blur"] : ["blur", "noBlur"];
    for (const mode of order) {
      const tag = mode === "noBlur" ? await page.addStyleTag({ content: NOBLUR }) : null;
      await page.waitForTimeout(250);
      acc[mode].push(...(await sel()));
      const t = await inspectToggle();
      acc[mode === "blur" ? "onBlur" : "onNo"].push(t.on);
      acc[mode === "blur" ? "offBlur" : "offNo"].push(t.off);
      if (tag) await tag.evaluate((e) => e.remove());
      await page.waitForTimeout(250);
    }
  }
  const st = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, med: +s[s.length >> 1].toFixed(1), p90: +s[Math.floor(s.length * 0.9)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
  };
  console.log(JSON.stringify({ engine: process.env.ENGINE ?? "wk", blurredElements: blurredCount, selection: { blur: st(acc.blur), noBlur: st(acc.noBlur) }, inspectOn: { blur: st(acc.onBlur), noBlur: st(acc.onNo) }, inspectOff: { blur: st(acc.offBlur), noBlur: st(acc.offNo) } }, null, 1));
} finally {
  await browser.close();
}
