import { pw, ctxFor, Session, BASE } from "./u.mjs";
for (const eng of ["webkit", "chromium"]) {
const b = await pw[eng].launch();
const ctx = await ctxFor(b, { engine: eng }); const page = await ctx.newPage(); const s = new Session(page, "C5-" + eng);
await page.goto(BASE + "/#/today"); await page.waitForSelector(".board:not(.idle) .cell .d.given"); await page.waitForTimeout(3000);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? (r.active ? "active" : "present") : "none"; });
s.log("SW:", sw);
await s.cell(0).catch(()=>{});
await ctx.setOffline(true);
let ok = true;
try { await page.reload({ timeout: 8000 }); await page.waitForSelector(".board:not(.idle) .cell .d.given", { timeout: 8000 }); } catch (e) { ok = false; s.log("offline reload failed:", e.message.slice(0, 100)); }
s.log("offline reload ok:", ok);
if (ok) {
  s.log("text:", (await s.text()).slice(0, 120));
  await s.tap(page.getByRole("tab", { name: /Year/ }), "Year offline"); await page.waitForTimeout(600); s.log("year offline:", (await s.text()).slice(0, 80));
  await s.tap(page.getByRole("tab", { name: /Play/ }), "Play"); await page.waitForTimeout(600); s.log("play offline:", (await s.text()).slice(0, 120));
  await s.tap(page.getByTestId("setup-start").first(), "start").catch(e => s.log("no start btn"));
  await page.waitForTimeout(1500); s.log("play started? board:", await page.locator(".board .cell").count());
  await page.goto(BASE + "/#/settings"); await page.waitForTimeout(1000); s.log("settings offline:", (await s.text()).slice(0, 160));
  await s.shot("S67-offline-" + eng);
}
await ctx.setOffline(false);
await b.close();
}
