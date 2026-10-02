import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
// fresh profile: Year empty
{
  const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "A5-fresh");
  await page.goto(BASE + "/"); await page.waitForSelector(".board .cell .d.given");
  await s.tap(page.locator(".tabbar button, nav button").nth(2), "Year tab");
  await page.waitForTimeout(1000);
  await s.shot("S12-year-empty-fresh");
  s.log("TEXT:", await s.text());
  await s.tap(page.locator(".tabbar button, nav button").nth(1), "Play tab"); await page.waitForTimeout(800);
  await s.shot("S13-play-fresh-setup");
  s.log("PLAY TEXT:", await s.text());
  await ctx.close();
}
// profile with solved day
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-a3.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "A5");
await page.goto(BASE + "/"); await page.waitForSelector(".card");
await page.waitForTimeout(800);
// tap on Grid inf
await page.evaluate(() => document.querySelector("main.scroll").scrollTo(0, 99999)); await page.waitForTimeout(300);
await s.tap("[data-testid=grid-inf]", "Grid inf board");
await page.waitForTimeout(600);
await s.shot("S14-tap-gridinf");
s.log("after tapping Grid inf:", (await s.text()).slice(0, 250));
await s.tap(page.locator("nav button, .tabbar button").nth(2), "Year tab"); await page.waitForTimeout(1200);
await s.shot("S15-year-with-one-day");
s.log("YEAR TEXT:", await s.text());
s.log("year classes:", await page.evaluate(() => [...new Set([...document.querySelectorAll("main *")].map(e => e.className).filter(c => typeof c === "string" && c))].join(" ; ").slice(0, 700)));
await b.close();
