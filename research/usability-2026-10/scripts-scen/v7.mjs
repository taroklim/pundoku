import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet2.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V7");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
page.on("download", d => s.log("DOWNLOAD", d.suggestedFilename()));
await page.goto(BASE + "/#/year"); await page.waitForSelector(".year"); await page.waitForTimeout(700);
await s.tap(page.locator(".year-month").nth(8), "Sep"); await page.waitForTimeout(500);
await s.tap(page.locator('[role=dialog] button, .sheet button').filter({ hasText: /^29$/ }).first(), "Sep 29"); await page.waitForTimeout(500);
// slider test at 25%
await s.tap(page.getByRole("button", { name: /Watch your solve/ }), "Watch"); await page.waitForTimeout(500);
await s.tap(page.getByRole("button", { name: /Play the replay/ }), "Play the replay"); await page.waitForTimeout(500);
const bb = await page.locator("input[type=range]").boundingBox();
await page.touchscreen.tap(bb.x + bb.width * 0.25, bb.y + bb.height / 2); await page.waitForTimeout(300);
s.log("tap at 25% of slider ->", await page.getByText(/Move \d+ of \d+/).innerText());
await s.tap(page.getByRole("button", { name: "Nine stages" }), "Nine stages"); await page.waitForTimeout(500);
s.log("back to stages:", (await s.text()).includes("Nine stages of your solve"));
// Done closes only this sheet? 
await s.tap(page.getByRole("button", { name: "Done" }).last(), "Done"); await page.waitForTimeout(700);
s.log("after Done (top sheet):", (await s.text()).slice(-160));
// Share
await s.tap(page.getByRole("button", { name: /Share/ }), "Share"); await page.waitForTimeout(1500);
await s.shot("S42-share-export-sheet");
s.log("EXPORT TEXT:", (await s.text()).split("Fingerprint")[1]?.slice(0, 300));
s.log("export buttons:", await page.evaluate(() => [...document.querySelectorAll("button")].map(b => (b.getAttribute("aria-label") || b.innerText || "").trim().replace(/\n/g," ")).filter(Boolean).slice(-8).join(" ; ")));
s.log("navigator.share:", await page.evaluate(() => typeof navigator.share), "canShare:", await page.evaluate(() => typeof navigator.canShare));
await b.close();
