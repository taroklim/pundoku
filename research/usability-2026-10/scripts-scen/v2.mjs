import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V2");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/year"); await page.waitForSelector(".year"); await page.waitForTimeout(800);
await s.tap(page.locator(".year-month").nth(8), "Sep"); await page.waitForTimeout(600);
await s.tap(page.locator('[role=dialog] button, .sheet button').filter({ hasText: /^30$/ }).first(), "Sep 30"); await page.waitForTimeout(500);
await s.tap(page.getByTestId("finish-day"), "Finish this puzzle"); 
await page.waitForSelector("[data-testid=archive-screen] .board:not(.idle) .cell .d.given", { timeout: 20000 });
await page.waitForTimeout(600);
s.log("URL", page.url());
await s.shot("S28-archive-resumed");
s.log("ARCHIVE TEXT:", (await s.text()).slice(0, 220));
s.log("ink row present:", await page.getByText("Ink mode").count());
// does the 30 filled digits persist?
const g = await s.grid(); const gv = await s.givens();
s.log("player digits restored:", [...g].filter((c, i) => c !== "0" && gv[i] === "0").length);
// browser back
await page.goBack(); await page.waitForTimeout(800);
s.log("after goBack URL:", page.url(), "| text:", (await s.text()).slice(0, 80));
await page.goForward(); await page.waitForTimeout(1000);
s.log("after goForward URL:", page.url());
// finish
const { puzzle, solution } = await solve(page);
const cur = await s.grid();
const todo = [...puzzle].map((c, i) => i).filter(i => puzzle[i] === "0" && cur[i] !== solution[i]);
for (const i of todo) { await s.cell(i); await s.key(Number(solution[i])); }
await page.waitForTimeout(2500);
await s.shot("S29-archive-solved-card");
s.log("SOLVED TEXT:", await s.text());
await s.tap(page.getByTestId("archive-back"), "back to Year"); await page.waitForTimeout(900);
await s.shot("S30-year-after-archive-solve");
s.log("after back:", page.url(), (await s.text()).slice(0, 300));
writeFileSync("state-vet2.json", JSON.stringify(await ctx.storageState({ indexedDB: true })));
await b.close();
