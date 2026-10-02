import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b);
const page = await ctx.newPage(); const s = new Session(page, "V4");
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(500);
s.log("ink row before:", await page.getByText("Ink mode").count());
await s.act(0);               // notes on
s.log("ink row after toggling Notes mode (no move yet):", await page.getByText("Ink mode").count());
await s.key(3);               // one note
s.log("ink row after FIRST pencil mark:", await page.getByText("Ink mode").count());
await s.key(3);               // remove note again
s.log("ink row after removing that note:", await page.getByText("Ink mode").count());
await s.shot("S35-ink-row-gone-after-note");
// also: does erase/undo restore the ink option?
await s.act(1);
s.log("after Undo:", await page.getByText("Ink mode").count());
// Play new game: ink choice sticky?
await b.close();
