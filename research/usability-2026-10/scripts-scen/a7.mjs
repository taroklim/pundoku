import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-a3.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "A7");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/year"); await page.waitForSelector(".year");
await page.waitForTimeout(600);
await s.tap(page.locator(".year-month").nth(9), "Oct card"); await page.waitForTimeout(700);
// day buttons in sheet
const days = page.locator('[role=dialog] button, .sheet button').filter({ hasText: /^1$/ });
s.log("buttons labelled 1:", await days.count());
await s.tap(days.first(), "day 1"); await page.waitForTimeout(700);
await s.shot("S17-day-card-notplayed");
s.log("TEXT:", await s.text());
// future day
await page.getByRole("button", { name: /Back to October|‹/ }).first().tap().catch(()=>{});
await page.waitForTimeout(500);
s.log("after back:", (await s.text()).slice(-200));
await b.close();
