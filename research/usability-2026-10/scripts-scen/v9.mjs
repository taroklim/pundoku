import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync("state-vet2.json", "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, "V9");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(500);
await s.tap(page.getByTestId("open-settings"), "gear"); await page.waitForTimeout(600);
// leave guard before key creation: none expected. create
await s.tap(page.getByTestId("key-create"), "create key"); await page.waitForTimeout(1500);
await s.shot("S44-key-shown");
const key = await page.getByTestId("key-shown").innerText().catch(() => "");
s.log("KEY TEXT:", JSON.stringify(key));
s.log("TEXT:", await s.text());
// copy
await s.tap(page.getByTestId("key-copy"), "copy"); await page.waitForTimeout(600);
s.log("after copy:", await page.getByTestId("key-copy").innerText());
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(e => "ERR " + e.message));
s.log("clipboard:", clip);
await s.shot("S45-key-copied");
// leave guard: tap back
await s.tap(page.getByTestId("settings-back"), "back (key unsaved)"); await page.waitForTimeout(700);
await s.shot("S46-leave-guard");
s.log("GUARD TEXT:", await s.text());
// Stay
const stay = page.getByRole("button", { name: /Stay/ }); if (await stay.count()) await s.tap(stay.first(), "Stay");
await page.waitForTimeout(400);
// tab bar tap to leave? try tapping Year tab
await s.tap(page.locator("nav a, nav button").filter({ hasText: /Year/ }).first(), "tab Year (unsaved)").catch(e => s.log("tab err", e.message.slice(0,80)));
await page.waitForTimeout(700);
s.log("after tab tap hash:", await page.evaluate(() => location.hash), "guard visible:", await page.getByRole("button", { name: /Stay/ }).count());
await s.shot("S47-tab-while-unsaved");
if (await page.getByRole("button", { name: /Stay/ }).count()) await s.tap(page.getByRole("button", { name: /Stay/ }).first(), "Stay 2");
await page.waitForTimeout(300);
await s.tap(page.getByTestId("key-saved"), "Key saved"); await page.waitForTimeout(1200);
await s.shot("S48-key-linked");
s.log("LINKED TEXT:", await s.text());
// wait for sync
await page.waitForTimeout(3000);
writeFileSync("key.txt", key.replace(/\s+/g, "").replace(/\n/g, ""));
await ctx.storageState({ path: "state-vet2-linked.json", indexedDB: true });
// reissue sheet look
await s.tap(page.getByTestId("key-reissue"), "reissue"); await page.waitForTimeout(600);
await s.shot("S49-reissue-sheet");
s.log("SHEET:", await s.text());
await s.tap(page.getByRole("button", { name: /^Cancel$|Not now|Close/ }).first(), "cancel sheet").catch(e => s.log("no cancel btn", e.message.slice(0,60)));
await b.close();
