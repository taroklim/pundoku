import { pw, ctxFor, Session, BASE } from "./u.mjs";
const b = await pw.webkit.launch();
// C1: first launch, API unreachable (web loaded)
{
const ctx = await ctxFor(b, { extra: { serviceWorkers: "block" } }); await ctx.route("**/api/**", r => r.abort("internetdisconnected"));
const page = await ctx.newPage(); const s = new Session(page, "C1-api-down");
page.on("pageerror", e => s.log("PAGEERROR", e.message));
await page.goto(BASE + "/#/today"); await page.waitForTimeout(4000);
s.log("text:", (await s.text()).slice(0, 300));
await s.shot("S57-api-down-first");
const cells = await page.locator(".board .cell .d.given").count(); s.log("givens:", cells);
if (cells) { await s.cell(40); await s.key(5); s.log("played ok; grid has digit:", (await s.grid())[40]); }
await s.tap(page.getByTestId("open-settings"), "gear"); await page.waitForTimeout(800);
s.log("settings:", (await s.text()).slice(0, 400));
await s.tap(page.getByTestId("key-create"), "create key offline").catch(e=>s.log("no create", e.message.slice(0,60))); await page.waitForTimeout(2000);
s.log("after create:", (await s.text()).slice(0, 500));
await s.shot("S58-create-key-offline");
await s.tap(page.getByTestId("key-have"), "have key").catch(()=>{});
await ctx.close();
}
// C1b: restore offline
{
const ctx = await ctxFor(b, { extra: { serviceWorkers: "block" } }); const page = await ctx.newPage(); const s = new Session(page, "C1b");
await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1500);
await ctx.route("**/api/**", r => r.abort("internetdisconnected"));
await s.tap(page.getByTestId("key-have"), "have key");
await page.getByTestId("key-field").fill("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH");
await s.tap(page.getByTestId("key-restore"), "restore offline"); await page.waitForTimeout(2000);
s.log("ERR:", await page.getByTestId("key-error").innerText().catch(() => "none"));
await ctx.close();
}
await b.close();
