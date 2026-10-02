import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync, statSync } from "node:fs";
for (const eng of ["webkit", "chromium"]) {
  const b = await pw[eng].launch();
  const ctx = await ctxFor(b, { engine: eng, storageState: JSON.parse(readFileSync("state-a3.json", "utf8")) });
  const page = await ctx.newPage(); const s = new Session(page, "V7c-" + eng);
  page.on("pageerror", e => s.log("PAGEERROR", e.message));
  page.on("download", async d => { await d.saveAs("/tmp/pundoku-usab/scen/usab/fp-" + eng + ".png"); s.log("DOWNLOAD", d.suggestedFilename()); });
  await page.goto(BASE + "/#/today"); await page.waitForSelector(".card"); await page.waitForTimeout(800);
  await s.tap(page.getByRole("button", { name: /^Share$/ }).first(), "Share"); await page.waitForTimeout(1500);
  await s.tap(page.getByTestId("fp-share"), "fp-share"); await page.waitForTimeout(2500);
  s.log("note under button:", await page.locator(".tl-share-block").innerText().then(x => x.replace(/\n/g, " | ")));
  await b.close();
}
try { console.log(statSync("fp-chromium.png").size, "bytes chromium png"); } catch {}
