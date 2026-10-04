import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(process.cwd() + "/")("playwright");
import { writeFileSync } from "node:fs";
const OUT = "/Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku-worktrees/pd-logo5-qa/research/usability-2026-10/logo-qa/shots/";
const T = process.argv[2] === "chromium" ? chromium : webkit, tag = process.argv[2] || "webkit";
const b = await T.launch(); const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: "en-US", acceptDownloads: true }); const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR", e.message));
await p.goto("http://127.0.0.1:3995/#/today"); await p.waitForSelector("button.cell", { timeout: 20000 }); await p.waitForTimeout(1500);
const grid = await p.evaluate(() => { const g = Array.from({ length: 9 }, () => Array(9).fill(0)); for (const c of document.querySelectorAll("button.cell")) { const l = c.getAttribute("aria-label"); const m = l.match(/(\d)[^\d]+(\d)[^\d]*(\d)?\s*$/); const nums = l.match(/\d/g); const r = +nums[0] - 1, k = +nums[1] - 1; if (nums.length === 3 && /clue/i.test(l)) g[r][k] = +nums[2]; } return g; });
const sol = await p.evaluate(async (g) => (await import("/src/play/__qa_fp_probe.ts")).solveGrid(g), grid);
console.log("solved?", !!sol);
let n = 0;
for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (!grid[r][c]) {
  const idx = r * 9 + c; // data-i по строкам? проверим
  await p.locator(`button.cell[aria-label^="Row ${r + 1}, column ${c + 1}"]`).click();
  await p.keyboard.press(String(sol[r * 9 + c])); n++;
}
console.log("entered", n);
await p.waitForTimeout(2500);
await p.screenshot({ path: OUT + `ui-${tag}-solved.png` });
await p.locator('[data-testid="share"], button:has-text("Share")').first().scrollIntoViewIfNeeded();
await p.locator('button:has-text("Share")').first().click();
await p.waitForSelector('[data-testid="fp-image"]', { timeout: 20000 }); await p.waitForTimeout(800);
await p.screenshot({ path: OUT + `ui-${tag}-exportsheet.png` });
const b64 = await p.evaluate(async () => { const src = document.querySelector('[data-testid="fp-image"]').src; const bl = await (await fetch(src)).blob(); const buf = new Uint8Array(await bl.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); });
writeFileSync(OUT + `ui-${tag}-real-fp.png`, Buffer.from(b64, "base64"));
console.log("fp bytes", Buffer.from(b64, "base64").length, "status:", await p.locator('[data-testid="fp-status"]').textContent());
const dl = p.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await p.locator('[data-testid="fp-share"]').click(); const d = await dl; console.log("download:", d ? d.suggestedFilename() : "none (share API?)");
await b.close();
