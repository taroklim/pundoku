// Перемер PD-140: две точечные проверки на main 96bbd4a.
// (1) После «закрыл-открыл» выбрана уже заполненная клетка: что делает один тап по цифре (стирает / перезаписывает)?
//     Today и Continue на хабе Play. (2) Какой URL отдаёт 404 при холодной загрузке чистого профиля (console.error в c_newbie).
// Запуск: node probe-extra-after.mjs   (стенд на :3992/:5992, профиль ветерана из measure-after.mjs)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, STATE_DIR, instrument, launch, newProfileCtx, placeFirstDigit, Run, snapshotProfile, solveFromDom, waitMark } from "./lib-after.mjs";

const profile = JSON.parse(readFileSync(join(STATE_DIR, "state-vet.json"), "utf8"));
const b = await launch("webkit");
const out = {};

async function placeN(page, n) {
  const { puzzle, solution } = await solveFromDom(page);
  const empties = [...puzzle].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0).slice(0, n);
  for (const i of empties) {
    await page.locator(`.board .cell[data-i="${i}"]`).tap();
    await page.locator(".pad .key").nth(Number(solution[i]) - 1).tap();
  }
  await page.waitForTimeout(1200);
  return { solution, first: empties[0] };
}
const digits = (page) => page.locator(".board .cell .d.player").count();
const selInfo = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.board .cell[aria-current="true"]');
    return c ? { i: Number(c.getAttribute("data-i")), text: c.querySelector(".d")?.textContent ?? null } : null;
  });

// (1a) Today
{
  let ctx = await newProfileCtx(b, "webkit", profile);
  await instrument(ctx);
  let page = await ctx.newPage();
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  const { solution } = await placeN(page, 3);
  const snap = await snapshotProfile(ctx);
  await ctx.close();
  ctx = await newProfileCtx(b, "webkit", snap);
  await instrument(ctx);
  page = await ctx.newPage();
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  await page.waitForTimeout(400);
  const sel = await selInfo(page);
  const before = await digits(page);
  await page.locator(".pad .key").nth(Number(solution[sel.i]) - 1).tap(); // та же верная цифра, что уже стоит
  await page.waitForTimeout(300);
  const afterSame = await digits(page);
  const selAfter = await selInfo(page);
  out.today = { selectedOnResume: sel, digitsBefore: before, digitsAfterTapSameDigit: afterSame, cellAfter: selAfter };
  await ctx.close();
}
// (1b) Play: Continue
{
  let ctx = await newProfileCtx(b, "webkit", profile);
  await instrument(ctx);
  let page = await ctx.newPage();
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  await page.locator(".tab").nth(1).tap();
  await page.locator('[data-testid="setup-start"]').tap();
  await page.waitForSelector(".play:not(.today) .board:not(.idle) .cell .d.given", { timeout: 60000 });
  const { solution } = await placeN(page, 3);
  const snap = await snapshotProfile(ctx);
  await ctx.close();
  ctx = await newProfileCtx(b, "webkit", snap);
  await instrument(ctx);
  page = await ctx.newPage();
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  await page.locator(".tab").nth(1).tap();
  await page.locator('[data-testid="continue-own"]').tap();
  await page.waitForSelector(".play:not(.today) .board .cell");
  await page.waitForTimeout(400);
  const sel = await selInfo(page);
  const before = await digits(page);
  await page.locator(".pad .key").nth(Number(solution[sel.i]) - 1).tap();
  await page.waitForTimeout(300);
  const afterSame = await digits(page);
  out.play = { selectedOnContinue: sel, digitsBefore: before, digitsAfterTapSameDigit: afterSame, cellAfter: await selInfo(page) };
  await ctx.close();
}
// (2) 404 при холодной загрузке чистого профиля
{
  const ctx = await newProfileCtx(b, "webkit", undefined);
  await instrument(ctx);
  const page = await ctx.newPage();
  const bad = [];
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url().replace(BASE, "")}`));
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  await page.waitForTimeout(1500);
  out.coldNewbie404 = bad;
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
