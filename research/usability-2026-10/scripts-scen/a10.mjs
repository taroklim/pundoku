import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b);
const page = await ctx.newPage(); const s = new Session(page, "A10");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/play"); await page.waitForSelector("[data-testid=setup-difficulty]");
await page.locator("[data-testid=setup-difficulty]").selectOption("easy");
await s.tap(page.getByRole("button", { name: "Start" }), "Start easy");
await page.waitForSelector(".board:not(.idle) .cell .d.given");
const { puzzle, solution } = await solve(page);
const empt = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
for (const i of empt.slice(0, 12)) { await s.cell(i); await s.key(Number(solution[i])); }
const before = await s.grid();
s.log("12 digits placed, left:", await page.locator("[data-testid=status-line]").innerText());
await s.shot("S21-play-midgame");
const tabs = page.locator("nav button, .tabbar button");
await s.tap(tabs.nth(2), "Year"); await page.waitForTimeout(500);
await s.tap(tabs.nth(1), "Play"); await page.waitForTimeout(500);
s.log("after tab switch, grid same:", before === await s.grid(), "clock", await page.locator(".subline .clock").first().innerText());
await page.reload(); await page.waitForTimeout(1500);
s.log("after reload:", (await s.text()).slice(0, 120), "grid same:", before === (await s.grid().catch(()=>"")));
// toolbar change
await page.locator("select.difficulty").selectOption("hard").catch(e => s.log("select err", e.message.slice(0,80)));
await page.waitForTimeout(600);
s.log("after toolbar select:", (await s.text()).slice(0, 160));
await s.shot("S22-play-after-toolbar-select");
// can we get back?
await s.tap(tabs.nth(0), "Today"); await page.waitForTimeout(400);
await s.tap(tabs.nth(1), "Play"); await page.waitForTimeout(800);
s.log("back on Play:", (await s.text()).slice(0, 140));
await b.close();
