import { pw, open, serve, P, settle, readBoard, solve, MISSION, SOLUTION, fs } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium";
const BR = { chromium: "cr", webkit: "wk", firefox: "ff" }[BRN];
const OUT = "/tmp/qa270/phone"; fs.mkdirSync(OUT, { recursive: true });
const sN = await serve("/tmp/qa270/dist", 5461), sB = await serve("/tmp/pd290-base", 5462);
const browser = await pw[BRN].launch();
const HIDE = ".clock, .subline .clock, [data-testid='insp-time'] { visibility: hidden !important; }";
async function shot(p, tag, dir, name) { await p.waitForTimeout(500); await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/${dir}/${BR}-${tag}-${name}.png`, animations: "disabled" }); }
async function capture(base, dir, w, h, scheme, extraMedia) {
  fs.mkdirSync(`${OUT}/${dir}`, { recursive: true });
  const tag = `${w}x${h}-${scheme}${extraMedia ? "-" + extraMedia : ""}`;
  const { ctx, p, errs } = await open(browser, { w, h, dpr: 3, scheme, base, touch: !process.env.NOTOUCH });
  await p.addStyleTag({ content: HIDE });
  if (extraMedia === "contrast") await p.emulateMedia({ contrast: "more" });
  const S = (n) => shot(p, tag, dir, n);
  await S("01-today");
  // Today: решить → карточка + Grid ∞ (тот же стор для обеих сборок)
  await p.locator("#tab-play").click(); await S("02-hub");
  await p.locator(`${P} [data-testid="mode-classic"]`).click({ button: "right" }); await S("03-ctx-menu"); if (process.env.STOP) { await ctx.close(); return errs; }
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  await p.locator(`${P} [data-testid="mode-classic"]`).click(); await S("04-mode-sheet");
  await p.locator('[data-testid="sheet-start"]').click();
  await p.waitForSelector(`${P} .board button.cell`, { timeout: 40000 }); await S("05-play");
  // подсказка (лампочка → правило → док)
  await p.locator(`${P} [data-testid="hint-button"]`).click(); await S("06-hint-rule");
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  const bd = await readBoard(p, P); const sol = solve(bd);
  const empt = []; for (let i = 0; i < 81; i++) if (bd[i] === "0") empt.push(i);
  for (const i of empt.slice(0, 25)) { await p.locator(`${P} .board button.cell[data-i="${i}"]`).click(); await p.keyboard.press(`Digit${sol[i]}`); }
  await S("07-play-mid");
  await p.locator(`${P} .act[aria-keyshortcuts], ${P} [data-testid="play-n"]`).first().click({ button: "right" }).catch(() => {});
  await p.waitForTimeout(500); await S("08-fill-sheet");
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  for (const i of empt.slice(25)) { await p.locator(`${P} .board button.cell[data-i="${i}"]`).click(); await p.keyboard.press(`Digit${sol[i]}`); }
  await p.waitForTimeout(1500); await S("09-play-solved");
  await p.locator("#tab-today").click(); await p.waitForTimeout(500);
  for (let i = 0; i < 81; i++) if (MISSION[i] === "0") { await p.locator(`${P} .board button.cell[data-i="${i}"]`).click(); await p.keyboard.press(`Digit${SOLUTION[i]}`); }
  await p.waitForSelector(`${P} [data-testid="grid-inf-section"]`, { timeout: 20000 }); await p.waitForTimeout(1500); await S("10-today-solved");
  await p.evaluate(() => { const s = document.querySelector(".tab-pane:not(.off) .scroll") || document.scrollingElement; s.scrollTop = s.scrollHeight; }); await S("11-today-solved-scrolled");
  await p.locator("#tab-year").click(); await S("12-year");
  await p.locator(`${P} .year-month`).nth(9).click().catch(() => {}); await p.waitForTimeout(700); await S("13-year-sheet");
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  await p.locator(`${P} [data-testid="open-settings"]`).click(); await S("14-settings");
  await p.keyboard.press("Escape").catch(() => {});
  // Лжец: правый клик по клетке
  await ctx.close();
  const o2 = await open(browser, { w, h, dpr: 3, scheme, base, touch: !process.env.NOTOUCH });
  const p2 = o2.p; await p2.addStyleTag({ content: HIDE });
  if (extraMedia === "contrast") await p2.emulateMedia({ contrast: "more" });
  await p2.locator("#tab-play").click(); await p2.waitForTimeout(400);
  await p2.locator(`${P} [data-testid="mode-liar"]`).click(); await p2.waitForTimeout(500);
  const st = p2.locator('[data-testid="sheet-start"]'); if (await st.count()) await st.click();
  await p2.waitForSelector(`${P} .board button.cell`, { timeout: 40000 }); await p2.waitForTimeout(600);
  await p2.locator(`${P} .board button.cell:has(.d.given)`).nth(12).click({ button: "right" }); await shot(p2, tag, dir, "15-accuse");
  await o2.ctx.close();
  return errs;
}
try {
  for (const [w, h, scheme, em] of [[393, 852, "light"], [393, 852, "dark"], [320, 568, "light"], [430, 932, "light"], [393, 852, "light", "contrast"]]) {
    if (process.env.ONLYDARK && !(scheme === "dark")) continue;
    if (process.env.SELF && !(w === 393 && (scheme === "light" || process.env.ONLYDARK) && !em) && !(w === 430)) continue;
    const e1 = await capture(`http://127.0.0.1:5462`, process.env.SELF ? (process.env.TAG ?? "base2") : "base", w, h, scheme, em);
    const e2 = process.env.SELF ? e1 : await capture(`http://127.0.0.1:5461`, "new", w, h, scheme, em);
    console.log("captured", w, h, scheme, em ?? "", "errs", e1.length, e2.length);
  }
} finally { await browser.close().catch(() => {}); sN.close(); sB.close(); }
