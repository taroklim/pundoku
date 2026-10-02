import { pw, ctxFor, Session, BASE } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "FIRST");
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(600);
await s.shot("S00-first-launch");
await b.close();
