import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b);
const page = await ctx.newPage(); const s = new Session(page, "A11");
await page.goto(BASE + "/#/play"); await page.waitForSelector("[data-testid=setup-difficulty]");
await s.tap(page.getByRole("button", { name: "Start" }), "Start medium");
await page.waitForSelector(".board:not(.idle) .cell .d.given");
const { puzzle, solution } = await solve(page);
const empt = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
for (const i of empt.slice(0, 20)) { await s.cell(i); await s.key(Number(solution[i])); }
s.log("20 digits placed:", await page.locator("[data-testid=status-line]").innerText());
const sel = page.locator("select.difficulty");
const box = await sel.boundingBox();
s.log("toolbar select box", JSON.stringify(box), "font-size", await sel.evaluate(e => getComputedStyle(e).fontSize));
await s.shot("S23-play-toolbar-select-visible");
// simulate accidentally choosing other value
await sel.selectOption("hard");
await page.waitForTimeout(500);
await s.shot("S24-play-game-discarded");
s.log("now:", (await s.text()).slice(0, 150));
// is old game anywhere? tab round-trip
const tabs = page.locator("nav button, .tabbar button");
await s.tap(tabs.nth(0)); await s.tap(tabs.nth(1)); await page.waitForTimeout(500);
s.log("after round trip:", (await s.text()).slice(0, 100));
await b.close();
