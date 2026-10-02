import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "C2");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(600);
const { puzzle, solution } = await solve(page);
const empties = [...puzzle].map((c, i) => c === "0" ? i : -1).filter(i => i >= 0);
// place 5 correct, 1 note, 1 wrong
for (const i of empties.slice(0, 5)) { await s.cell(i); await s.key(+solution[i]); }
await s.act(0); await s.cell(empties[6]); await s.key(1); await s.key(2); await s.act(0);
await s.cell(empties[7]); const wrong = (+solution[empties[7]] % 9) + 1; await s.key(wrong);
const before = await s.grid(); const statusBefore = await page.getByTestId("status-line").innerText().catch(()=>"?");
s.log("status before:", statusBefore.replace(/\n/g," | "));
await s.shot("S59-c2-before-lang");
// language change mid-game
await s.tap(page.getByTestId("open-settings"), "gear"); await s.tap(page.getByTestId("lang-uk"), "uk"); await page.waitForTimeout(500);
await s.shot("S60-settings-uk");
s.log("uk settings:", (await s.text()).slice(0, 300));
await s.tap(page.getByTestId("settings-back"), "back"); await page.waitForTimeout(800);
const after = await s.grid(); s.log("grid preserved:", before === after);
s.log("status after (uk):", (await page.getByTestId("status-line").innerText().catch(()=>"?")).replace(/\n/g," | "));
s.log("TODAY uk text:", (await s.text()).slice(0, 400));
await s.shot("S61-today-uk-midgame");
s.log("selected cell kept? ", await page.evaluate(() => !!document.querySelector(".board .cell.sel, .board .cell[aria-selected=true]")));
// ru
await s.tap(page.getByTestId("open-settings"), "gear"); await s.tap(page.getByTestId("lang-ru"), "ru"); await s.tap(page.getByTestId("settings-back"), "back"); await page.waitForTimeout(500);
s.log("TODAY ru text:", (await s.text()).slice(0, 300));
await s.shot("S62-today-ru");
// back to en
await s.tap(page.getByTestId("open-settings"), "gear"); await s.tap(page.getByTestId("lang-en"), "en"); await s.tap(page.getByTestId("settings-back"), "back");
// orientation
await page.setViewportSize({ width: 852, height: 393 }); await page.waitForTimeout(800);
await s.shot("S63-landscape");
const geo = await page.evaluate(() => { const bd = document.querySelector(".board").getBoundingClientRect(); const pad = document.querySelector(".pad")?.getBoundingClientRect(); return { board: [bd.top, bd.bottom, bd.width], pad: pad && [pad.top, pad.bottom], sh: document.documentElement.scrollHeight, ih: innerHeight, tabbar: document.querySelector(".tabbar")?.getBoundingClientRect().top }; });
s.log("landscape geo:", JSON.stringify(geo));
await page.setViewportSize({ width: 393, height: 852 }); await page.waitForTimeout(500);
s.log("grid after rotate back preserved:", before === await s.grid());
// background/visibility: timer
const timer = async () => (await page.getByTestId("status-line").innerText()).replace(/\n/g," ");
const t1 = await timer();
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(5000);
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(1200);
s.log("timer before/after 5s background:", t1, "->", await timer());
await b.close();
