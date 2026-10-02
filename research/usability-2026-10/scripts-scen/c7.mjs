import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "PLAYSOLVE");
await page.goto(BASE + "/#/play"); await page.waitForTimeout(800);
await page.getByTestId("setup-difficulty").selectOption("easy");
await s.tap(page.getByRole("button", { name: /^Start$/ }), "Start"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(500);
const { puzzle, solution } = await solve(page);
for (let i = 0; i < 81; i++) if (puzzle[i] === "0") { await s.cell(i); await s.key(+solution[i]); }
await page.waitForTimeout(1500);
s.log("TEXT:", (await s.text()).slice(0, 500));
await s.shot("S68-play-solved");
const nb = page.getByRole("button", { name: /New game/ });
s.log("New game btn:", await nb.count());
if (await nb.count()) { await s.tap(nb.first(), "New game"); await page.waitForTimeout(800); s.log("after new game:", (await s.text()).slice(0, 200)); }
await b.close();
