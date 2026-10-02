import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
let key;
{
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet2.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V11a");
await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1500);
await s.tap(page.getByTestId("key-reissue"), "reissue");
await s.tap(page.getByRole("button", { name: /^Replace key$/ }).last(), "confirm"); await page.waitForTimeout(1500);
key = (await page.getByTestId("key-shown").innerText()).replace(/\s+/g, "");
s.log("key", key);
await s.tap(page.getByTestId("key-saved"), "saved"); await page.waitForTimeout(3000);
// make a play with notes etc? record Year status text
await page.goto(BASE + "/#/year"); await page.waitForTimeout(1200);
s.log("A year text:", (await s.text()).slice(0, 400));
await ctx.close();
}
writeFileSync("key.txt", key);
// B: fresh profile (clean, as if wiped phone) restore with messy key format
{
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "V11b");
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(500);
await s.tap(page.getByTestId("open-settings"), "gear"); await page.waitForTimeout(500);
await s.tap(page.getByTestId("key-have"), "have key");
const messy = " " + key.toLowerCase().replace(/(.{4})/g, "$1 ").trim() + " ";
await page.getByTestId("key-field").fill(messy); s.log("typed:", messy);
await s.shot("S53-key-typed");
await s.tap(page.getByTestId("key-restore"), "restore"); await page.waitForTimeout(3000);
s.log("RESULT:", (await s.text()).slice(0, 400));
await s.shot("S54-restored");
await page.goto(BASE + "/#/year"); await page.waitForTimeout(1500);
s.log("B year text:", (await s.text()).slice(0, 400));
await s.shot("S55-year-restored");
await page.goto(BASE + "/#/today"); await page.waitForTimeout(1500);
s.log("B today:", (await s.text()).slice(0, 400));
// reload and check persistence
await page.reload(); await page.waitForTimeout(2000);
await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1200);
s.log("B settings after reload:", (await s.text()).slice(0, 300));
await ctx.close();
}
await b.close();
