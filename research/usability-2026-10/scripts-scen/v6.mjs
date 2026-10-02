import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet2.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V6");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/year"); await page.waitForSelector(".year"); await page.waitForTimeout(700);
await s.tap(page.locator(".year-month").nth(8), "Sep"); await page.waitForTimeout(500);
await s.tap(page.locator('[role=dialog] button, .sheet button').filter({ hasText: /^29$/ }).first(), "Sep 29"); await page.waitForTimeout(500);
await s.tap(page.getByRole("button", { name: /Watch your solve/ }), "Watch"); await page.waitForTimeout(600);
await s.tap(page.getByRole("button", { name: /Play the replay/ }), "Play the replay"); await page.waitForTimeout(500);
const mv = async () => (await page.getByText(/Move \d+ of \d+/).innerText());
await s.tap(page.getByRole("button", { name: "Play", exact: true }), "Play");
for (const ms of [1500, 3000, 3000]) { await page.waitForTimeout(ms); s.log("move:", await mv()); }
await s.shot("S40-timelapse-mid");
await s.tap(page.getByRole("button", { name: "Fast" }), "Fast");
await page.waitForTimeout(3000); s.log("fast 3s ->", await mv());
await s.tap(page.getByRole("button", { name: "Pause" }), "Pause"); s.log("paused at", await mv());
await s.tap(page.getByRole("button", { name: "Next move" }), "next"); s.log("next ->", await mv());
await s.tap(page.getByRole("button", { name: "Previous move" }), "prev"); await s.tap(page.getByRole("button", { name: "Previous move" }), "prev"); s.log("prev x2 ->", await mv());
// scrub slider
const slider = page.locator("input[type=range]");
s.log("slider count", await slider.count(), "min/max", await slider.getAttribute("max"));
const bb = await slider.boundingBox(); s.log("slider box", JSON.stringify(bb));
await page.touchscreen.tap(bb.x + bb.width * 0.5, bb.y + bb.height / 2); await page.waitForTimeout(300); s.log("tap middle of slider ->", await mv());
// let it finish
await s.tap(page.getByRole("button", { name: "Play", exact: true }), "Play");
await s.tap(page.getByRole("button", { name: "Fast" }), "Fast");
await page.waitForTimeout(12000);
s.log("end state:", await mv(), "| buttons:", await page.evaluate(() => [...document.querySelectorAll("button")].map(b => (b.getAttribute("aria-label") || b.innerText || "").trim().replace(/\n/g," ")).filter(Boolean).slice(0, 30).join(" ; ")));
await s.shot("S41-timelapse-end");
await b.close();
