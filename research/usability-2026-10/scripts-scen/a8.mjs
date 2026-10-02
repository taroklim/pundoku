import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-a3.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "A8");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/play"); await page.waitForTimeout(1500);
s.log("play entry TEXT:", await s.text());
await s.shot("S18-play-setup");
// difficulty row
await s.tap(page.getByText("Difficulty").first(), "Difficulty row"); await page.waitForTimeout(700);
await s.shot("S19-play-difficulty-picker");
s.log("picker TEXT:", await s.text());
s.log("picker html:", await page.evaluate(() => (document.querySelector("[role=dialog], select, .sheet, [role=radiogroup], [role=listbox]")?.outerHTML ?? "none").slice(0, 600)));
await b.close();
