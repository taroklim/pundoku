import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync } from "node:fs";
const b = await pw.webkit.launch();
// A: tab while key unsaved
{
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet2-linked.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V10a");
await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1500);
s.log("linked-state text:", (await s.text()).slice(0, 260));
await s.tap(page.getByTestId("key-reissue"), "reissue");
await s.tap(page.getByRole("button", { name: /^Replace key$/ }).last(), "confirm replace"); await page.waitForTimeout(1500);
s.log("after reissue:", (await s.text()).slice(0, 300));
await s.tap(page.getByRole("tab", { name: /Year/ }), "tab Year (key unsaved)"); await page.waitForTimeout(700);
s.log("hash:", await page.evaluate(() => location.hash), "guard:", await page.getByRole("button", { name: /Stay/ }).count());
await s.shot("S47-tab-while-unsaved");
if (await page.getByRole("button", { name: /Stay/ }).count()) { await s.tap(page.getByRole("button", { name: /Leave/ }), "Leave"); await page.waitForTimeout(500); s.log("hash after leave:", await page.evaluate(() => location.hash));
  await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1500); s.log("settings after leave w/o saving:", (await s.text()).slice(0,300)); await s.shot("S50-after-leave-unsaved"); }
await ctx.close();
}
// B: wrong key
{
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "V10b");
await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1500);
await s.tap(page.getByTestId("key-have"), "have key"); await page.waitForTimeout(500);
await s.shot("S51-enter-key");
s.log("TEXT:", await s.text());
await page.getByTestId("key-field").fill("AAAA-BBBB"); 
s.log("restore disabled? ", await page.getByTestId("key-restore").getAttribute("aria-disabled"), await page.getByTestId("key-restore").isDisabled());
await page.getByTestId("key-field").fill("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH");
await s.tap(page.getByTestId("key-restore"), "restore wrong"); await page.waitForTimeout(1500);
s.log("ERR:", await page.getByTestId("key-error").innerText().catch(() => "none"));
await s.shot("S52-wrong-key");
await ctx.close();
}
await b.close();
