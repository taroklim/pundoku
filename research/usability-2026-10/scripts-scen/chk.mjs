import { pw, ctxFor, Session, BASE } from "./u.mjs";
import { readFileSync } from "node:fs";
const b = await pw.webkit.launch();
for (const f of ["state-vet.json","state-vet3.json"]) {
const ctx = await ctxFor(b, { storageState: JSON.parse(readFileSync(f, "utf8")) });
const page = await ctx.newPage(); const s = new Session(page, f);
await page.goto(BASE + "/#/year"); await page.waitForTimeout(1500);
s.log((await s.text()).slice(0, 200));
await ctx.close();}
await b.close();
