import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-a3.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "A6");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/year"); await page.waitForSelector(".year");
await page.waitForTimeout(800);
const marks = await page.evaluate(() => [...document.querySelectorAll(".ymark")].filter(e=>e.closest(".year-months")).slice(0,40).map(e => { const r = e.getBoundingClientRect(); return { cls: e.className, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, tag: e.tagName, label: e.getAttribute("aria-label") || e.closest("button")?.getAttribute("aria-label") }; }));
s.log("marks sample", JSON.stringify(marks.slice(0,3)));
s.log("buttons in months:", await page.locator(".year-months button").count(), " ymark elements:", await page.locator(".year-months .ymark").count());
// tap Oct month
const octCard = page.locator(".year-month").nth(9);
await s.tap(octCard, "Oct month card");
await page.waitForTimeout(900);
await s.shot("S16-year-month-sheet");
s.log("SHEET TEXT:", await s.text());
await b.close();
