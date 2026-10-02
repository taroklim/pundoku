import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet2.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V3");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(600);
s.log("today fresh text head:", (await s.text()).slice(0, 60));
await s.tap(page.getByText("Ink mode").first(), "Ink row"); await page.waitForTimeout(800);
await s.shot("S31-ink-rule-sheet");
s.log("RULE TEXT:", (await s.text()).split("Ink doesn’t lift")[1]?.slice(0, 500));
// cancel first
await s.tap(page.getByRole("button", { name: "Not now" }), "Not now"); await page.waitForTimeout(500);
s.log("after Not now: ink row value:", await page.locator(".ink-entry, .gap").first().innerText().then(x=>x.replace(/\n/g," | ")));
await s.tap(page.getByText("Ink mode").first(), "Ink row again"); await page.waitForTimeout(500);
await s.tap(page.getByRole("button", { name: "Play in ink" }), "Play in ink"); await page.waitForTimeout(700);
s.log("after Play in ink:", (await s.text()).slice(0, 120));
await s.shot("S32-ink-on-before-move");
const { puzzle, solution } = await solve(page);
const empt = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
// right digit in first cell
await s.cell(empt[0]); await s.key(Number(solution[empt[0]]));
s.log("pad/actions after first move:", await page.locator(".actions").innerText().then(x=>x.replace(/\n/g," | ")), "| ink row present:", await page.getByText("Ink mode").count());
// try retap other digit on same filled cell
await s.key((Number(solution[empt[0]]) % 9) + 1);
s.log("tap other digit on locked cell ->", (await s.grid())[empt[0]]);
// wrong digit in second cell
await s.cell(empt[1]);
const wrong = (Number(solution[empt[1]]) % 9) + 1;
await s.key(wrong);
await page.waitForTimeout(150);
await s.shot("S33-ink-blot-moment", { });
await page.waitForTimeout(900);
await s.shot("S34-ink-blot-sealed");
s.log("blot cell digit:", (await s.grid())[empt[1]], "sr status:", await page.locator("p.sr-only[role=status]").innerText(), "| left:", await page.locator("[data-testid=status-line]").innerText());
// try to type into blot cell
await s.key(wrong === 9 ? 1 : wrong + 1);
s.log("tap on blot cell ->", (await s.grid())[empt[1]]);
// Erase, undo
s.log("Erase label:", await page.locator(".actions .act").last().innerText());
// notes in ink
await s.act(0); await s.cell(empt[2]); await s.key(4); await s.key(6);
s.log("notes in ink ->", await page.locator(`.cell[data-i="${empt[2]}"] .marks`).innerText().then(x=>x.replace(/\s/g,"")));
await s.act(1); // Erase notes (index shifts)
s.log("after Erase notes tap on notes cell:", await page.locator(`.cell[data-i="${empt[2]}"] .marks`).count());
writeFileSync("state-vet3.json", JSON.stringify(await ctx.storageState({ indexedDB: true })));
await b.close();
