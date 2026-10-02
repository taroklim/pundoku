import { pw, ctxFor, Session, BASE, solve } from "./u.mjs";
const b = await pw.webkit.launch();
const ctx = await ctxFor(b); const page = await ctx.newPage(); const s = new Session(page, "CAND");
for (const h of ["#/today"]) { await page.goto(BASE + "/" + h); await page.waitForSelector(".board:not(.idle) .cell .d.given"); }
const { puzzle } = await solve(page);
let cells = 0, digits = 0;
for (let i = 0; i < 81; i++) if (puzzle[i] === "0") { const r = Math.floor(i / 9), c = i % 9; const seen = new Set(); for (let k = 0; k < 9; k++) { seen.add(puzzle[r * 9 + k]); seen.add(puzzle[k * 9 + c]); } const br = r - r % 3, bc = c - c % 3; for (let a = 0; a < 3; a++) for (let d = 0; d < 3; d++) seen.add(puzzle[(br + a) * 9 + bc + d]); cells++; digits += 9 - [...seen].filter(x => x !== "0").length; }
s.log("empties", cells, "full candidates", digits, "taps for full notes (cell+digits) =", cells + digits, "+1 mode");
await b.close();
