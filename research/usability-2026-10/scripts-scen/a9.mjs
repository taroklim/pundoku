import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b);
const page = await ctx.newPage(); const s = new Session(page, "A9");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/play"); await page.waitForSelector("[data-testid=setup-difficulty]");
for (const d of ["easy", "medium", "hard", "expert", "master"]) {
  await page.locator("[data-testid=setup-difficulty]").selectOption(d);
  const t = Date.now();
  await s.tap(page.getByRole("button", { name: "Start" }), "Start " + d);
  let tPrep = null;
  await page.waitForSelector(".board:not(.idle) .cell .d.given", { timeout: 60000 });
  tPrep = Date.now() - t;
  const g = await s.givens();
  const clues = [...g].filter(c => c !== "0").length;
  s.log(d, "board ready ms", tPrep, "clues", clues, "sub:", await page.locator(".subline").first().innerText());
  if (d === "master" || d === "easy") await s.shot("S20-play-" + d);
  // leave: how? try Play tab -> same tab again; check select visible in toolbar
  if (d === "easy") {
    s.log("toolbar has select:", await page.locator("select.difficulty").count());
    s.log("TEXT:", (await s.text()).slice(0, 200));
  }
  // go back to setup by changing difficulty via toolbar select
  if (d !== "master") {
    const nxt = ["easy", "medium", "hard", "expert", "master"][["easy", "medium", "hard", "expert", "master"].indexOf(d) + 1];
    await page.locator("select.difficulty").selectOption(nxt);
    await page.waitForSelector("[data-testid=setup-difficulty]");
    s.log("toolbar change selects ->", nxt, "-> returns to setup; setup difficulty value:", await page.locator("[data-testid=setup-difficulty]").inputValue(), "taps (no tap counted for select)");
  }
}
await b.close();
