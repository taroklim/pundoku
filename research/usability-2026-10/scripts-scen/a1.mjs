import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b);
const page = await ctx.newPage();
const s = new Session(page, "A1");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
const t0 = Date.now();
await page.goto(BASE + "/");
await page.waitForSelector(".board .cell .d.given", { timeout: 20000 });
s.log("board visible after ms", Date.now() - t0);
await page.waitForTimeout(800);
const { puzzle, solution } = await solve(page);
const empties = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
s.log("empties", empties.length, "first empties", empties.slice(0, 6).join(","));
// 1. sel state
const sel = await page.evaluate(() => document.querySelector(".cell.sel")?.dataset.i);
s.log("auto-selected cell", sel);
// 2. tap digit right away: correct digit in first selected
const c0 = empties[0];
await s.key(Number(solution[c0]));
await page.waitForTimeout(400);
s.log("after 1st digit:", await page.evaluate(() => document.querySelector(".today-status, .gap")?.innerText.replace(/\n/g," | ")));
await s.shot("S01-first-digit-placed");
const sel2 = await page.evaluate(() => document.querySelector(".cell.sel")?.dataset.i);
s.log("selection after placing:", sel2, "(was", sel, ")");
// ink row gone?
s.log("ink row present:", await page.locator(".ink-entry, [data-testid=ink-entry]").count(), await page.evaluate(()=>document.querySelector('.gap').innerText.replace(/\n/g,' | ')));
// 3. press same digit again on the same cell (toggle?)
await s.key(Number(solution[c0])); await page.waitForTimeout(300);
s.log("same digit again on same cell ->", (await s.grid())[c0]);
// 4. try to overwrite correct digit with another
const other = (Number(solution[c0]) % 9) + 1;
await s.key(other); await page.waitForTimeout(300);
s.log("overwrite correct with", other, "->", (await s.grid())[c0], "err class:", await page.locator(`.cell[data-i="${c0}"].err`).count());
await s.shot("S02-wrong-over-own-digit");
console.log("undo state", await page.locator(".actions .act").nth(1).getAttribute("aria-disabled"));
// 5. Notes
await s.act(0);
s.log("notes aria-pressed", await page.locator(".actions .act").nth(0).getAttribute("aria-pressed"));
await s.shot("S03-notes-mode-on");
const c1 = empties[1];
await s.cell(c1);
for (const d of [2, 5, 7]) await s.key(d);
await page.waitForTimeout(200);
await s.shot("S04-notes-three");
s.log("marks cell", c1, await page.locator(`.cell[data-i="${c1}"] .marks`).innerText().then(x=>x.replace(/\n/g,"")));
// toggle one off
await s.key(5);
s.log("after toggling 5:", await page.locator(`.cell[data-i="${c1}"] .marks`).innerText().then(x=>x.replace(/\n/g,"")));
// notes into cell with digit?
await s.cell(c0); await s.key(3);
s.log("notes into filled cell c0 ->", (await s.grid())[c0], await page.locator(`.cell[data-i="${c0}"] .marks`).count());
// state persisted?
const st = await ctx.storageState({ indexedDB: true });
writeFileSync("/tmp/pundoku-usab/scen/usab/state-a1.json", JSON.stringify(st));
s.log("taps total", s.taps);
await b.close();
