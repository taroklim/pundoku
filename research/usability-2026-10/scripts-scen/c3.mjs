import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "C3");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(600);
const { puzzle, solution } = await solve(page);
const empties = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
const sub = async () => (await page.locator(".screen-sub, header p, [data-testid=today-sub]").first().innerText().catch(() => "?")).replace(/\n/g, " ");
const hdr = async () => page.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || ["?"])[0]);
// background timer
s.log("timer t0:", await hdr());
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(8000);
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(1500);
s.log("timer after 8s hidden (+1.5 visible):", await hdr(), "(if timer paused: ~+1.5s)");
// double tap fast on a cell then digit
const c0 = empties[0];
await page.locator(`.board .cell[data-i="${c0}"]`).dblclick().catch(()=>{});
await page.locator(`.board .cell[data-i="${c0}"]`).tap(); await page.locator(`.board .cell[data-i="${c0}"]`).tap();
s.log("double tap cell: selected?", await page.evaluate((i) => document.querySelector(`.board .cell[data-i="${i}"]`).className, c0));
// double-tap digit key quickly (same digit twice = toggles erase)
const d = +solution[c0];
await page.locator(".pad .key").nth(d - 1).dblclick();
s.log("after dbltap digit", d, "cell:", (await s.grid())[c0], "(0/blank = erased by 2nd tap)");
// 10+ digits/sec via touchscreen taps
const box = await page.locator(".pad .key").nth(4).boundingBox();
const t0 = Date.now();
for (let i = 0; i < 12; i++) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
s.log("12 taps in ms:", Date.now() - t0, "cell:", (await s.grid())[c0]);
// really fast rapid across different keys by dispatching touch events (no await between)
await page.evaluate(async () => { const keys = [...document.querySelectorAll(".pad .key")]; for (let n = 0; n < 30; n++) { keys[n % 9].click(); } });
s.log("after 30 synthetic clicks; cell:", (await s.grid())[c0], "status:", (await page.getByTestId("status-line").innerText()).replace(/\n/g, " "));
// keyboard: arrows + digits
await page.keyboard.press("Escape");
await s.cell(empties[1]);
await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown");
const selIdx = await page.evaluate(() => { const c = document.querySelector(".board .cell.selected, .board .cell.sel, .board .cell[aria-selected=true]"); return c ? c.dataset.i : null; });
s.log("start", empties[1], "after right+down sel:", selIdx);
await page.keyboard.press("5"); s.log("kbd 5 -> grid at sel:", selIdx != null ? (await s.grid())[selIdx] : "?");
await page.keyboard.press("n"); await page.keyboard.press("1"); await page.keyboard.press("2"); await page.keyboard.press("n");
s.log("n,1,2,n pressed; text near cell:", await page.evaluate((i) => document.querySelector(`.board .cell[data-i="${i}"]`).innerText.replace(/\n/g, ","), selIdx));
await page.keyboard.press("Meta+z"); await page.keyboard.press("Control+z");
await page.keyboard.press("Backspace");
await s.shot("S64-keyboard");
// back gesture: goBack from Today
await page.goto(BASE + "/#/year"); await page.waitForTimeout(500); await page.goto(BASE + "/#/today"); await page.waitForTimeout(500);
await page.goBack(); await page.waitForTimeout(700); s.log("goBack from today after goto year->today:", await page.evaluate(() => location.hash));
await s.tap(page.getByRole("tab", { name: /Play/ }), "Play tab"); await page.waitForTimeout(400);
await s.tap(page.getByRole("tab", { name: /Year/ }), "Year tab"); await page.waitForTimeout(400);
await page.goBack(); await page.waitForTimeout(700); s.log("goBack after tab taps:", await page.evaluate(() => location.hash));
await b.close();
