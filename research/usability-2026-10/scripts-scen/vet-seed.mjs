import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b);
const page = await ctx.newPage(); const s = new Session(page, "VSEED");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
async function playDay(dateStr, mode) {
  await page.clock.install({ time: new Date(`${dateStr}T12:00:00`) });
  await page.goto(BASE + "/#/today");
  await page.waitForSelector(".board:not(.idle) .cell .d.given", { timeout: 25000 });
  await page.waitForTimeout(500);
  s.log(dateStr, "subline:", await page.locator(".subline").first().innerText());
  const { puzzle, solution } = await solve(page);
  const empt = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
  const todo = mode === "full" ? empt : empt.slice(0, 30);
  let k = 0;
  for (const i of todo) {
    if (mode === "full" && k === 5) { await s.cell(i); await s.key((Number(solution[i]) % 9) + 1); } // deliberate wrong
    await s.cell(i); await s.key(Number(solution[i])); k++;
    if (mode === "full" && k === 5) { /* placed correct over wrong */ }
  }
  await page.waitForTimeout(1500);
  s.log(dateStr, mode, "done; text:", (await s.text()).slice(0, 140));
}
await playDay("2026-09-29", "full");
await playDay("2026-09-30", "part");
await page.waitForTimeout(1500);
writeFileSync("state-vet.json", JSON.stringify(await ctx.storageState({ indexedDB: true })));
await b.close();
