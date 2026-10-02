import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-a1.json", "utf8")) });
const page = await ctx.newPage();
const s = new Session(page, "A2");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/");
await page.waitForSelector(".board .cell .d.given", { timeout: 20000 });
await page.waitForTimeout(800);
s.log("restored grid first 20:", (await s.grid()).slice(0, 20), "clock:", await page.locator(".subline .clock").first().innerText().catch(()=> "?"), "sub:", await page.locator(".subline").first().innerText());
s.log("marks c1:", await page.locator(`.cell[data-i="1"] .marks`).innerText().then(x=>x.replace(/\n/g,"")).catch(()=>"none"), " selected:", await page.evaluate(() => document.querySelector(".cell.sel")?.dataset.i));
const { puzzle, solution } = await solve(page);
// erase wrong digit in cell 0
await s.cell(0);
await s.act(2); await page.waitForTimeout(200);
s.log("erase cell 0 ->", (await s.grid())[0]);
await s.act(1); await page.waitForTimeout(200);
s.log("undo ->", (await s.grid())[0], "wrong class:", await page.locator('.cell[data-i="0"].err').count());
await s.act(1); await page.waitForTimeout(200);
s.log("undo again ->", (await s.grid())[0], await page.evaluate(() => document.querySelector(".cell.sel")?.dataset.i));
// peer notes cleanup: cell1 has notes 2,7 (5 removed). Row0 empties: 0,1,6,7,8. Put solution digit for cell 0 equal to a note of cell1?
const sol0 = Number(solution[0]);
s.log("solution[0]=", sol0, "solution[1]=", solution[1], "notes at 1 contain?");
// put notes of sol0 in cell 1 and cell 9 (col 0) then place sol0 in cell 0
await s.act(0); // notes on
await s.cell(1); await s.key(sol0); await s.cell(9); await s.key(sol0); await s.cell(27+0*0).catch(()=>{});
await s.act(0); // notes off
await page.waitForTimeout(200);
const hasNote = async (i) => (await page.locator(`.cell[data-i="${i}"] .marks`).innerText().catch(() => "")).replace(/\s/g, "").includes(String(sol0));
s.log("before place: cell1 has note", sol0, await hasNote(1), "cell9", await hasNote(9));
await s.cell(0); await s.key(sol0); await page.waitForTimeout(300);
s.log("after placing", sol0, "in cell0 ->", (await s.grid())[0], "peer notes remain: cell1", await hasNote(1), "cell9", await hasNote(9));
await s.shot("S05-notes-after-placing-peer");
// reload: persistence + timer
const c1 = await page.locator(".subline .clock").first().innerText();
await page.reload(); await page.waitForSelector(".board .cell .d.given"); await page.waitForTimeout(600);
s.log("after reload grid same:", (await s.grid()).slice(0,20), "clock before", c1, "after", await page.locator(".subline .clock").first().innerText());
// Fill the whole grid with ONE wrong digit left => what does UI say
const empt = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
const cur = await s.grid();
const t1 = Date.now(), tp = s.taps;
let wrongCell = empt[empt.length - 1];
for (const i of empt) {
  if (i === wrongCell) continue;
  if (cur[i] === solution[i]) continue;
  await s.cell(i); await s.key(Number(solution[i]));
}
s.log("filled all but last: taps used", s.taps - tp, "ms", Date.now() - t1, " left:", await page.locator('[data-testid=status-line]').innerText());
await s.cell(wrongCell); await s.key((Number(solution[wrongCell]) % 9) + 1);
await page.waitForTimeout(800);
s.log("grid full with 1 wrong; status:", await page.locator('[data-testid=status-line]').innerText(), "| err cells:", await page.locator(".cell.err").count());
await s.shot("S06-full-grid-one-wrong");
s.log("UI text:", await s.text());
writeFileSync("state-a2.json", JSON.stringify(await ctx.storageState({ indexedDB: true })));
await b.close();
