import { pw, open, serve, P, settle, side, rect, box, fs } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium";
const MODES = (process.argv[3] ?? "normal,contrast,rt").split(",");
const PORT = +(process.argv[4] ?? 5441);
const SH = "/tmp/qa270/shots";
const BR = { chromium: "cr", webkit: "wk", firefox: "ff" }[BRN];
const results = {}; const fails = [];
const check = (n, ok, d = {}) => { results[n] = { ok: !!ok, ...d }; if (!ok) fails.push(n); console.log(`${ok ? "PASS" : "FAIL"} ${n}`, JSON.stringify(d)); };
const css = (W, H, z) => [Math.round(W / (z / 100)), Math.round(H / (z / 100))];
const MATRIX = [[1280, 800], [1440, 900], [1920, 1080]].flatMap(([W, H]) => [100, 125, 150].map((z) => [`${W}x${H}@${z}`, ...css(W, H, z), z]));
MATRIX.push(["compact-1024x640", 1024, 640, 125], ["compact-960x600", 960, 600, 150]);
const near = (a, b, e = 1.5) => Math.abs(a - b) <= e;
const isFull = (w, h) => w >= 1100 && h >= 680;
async function backdrop(p, sel) { return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return c.backdropFilter || c.webkitBackdropFilter; }, sel); }
const active = (p) => p.evaluate(() => { const e = document.activeElement; return e === document.body ? "body" : (e.dataset.testid || e.className || e.tagName); });

async function setMode(ctx, p, mode) {
  if (mode === "contrast") await p.emulateMedia({ contrast: "more" });
  if (mode === "rt") { const s = await ctx.newCDPSession(p); await s.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] }); }
}

const server = await serve("/tmp/qa270/dist", PORT);
const base = `http://127.0.0.1:${PORT}`;
const browser = await pw[BRN].launch();
try {
  for (const mode of MODES) {
    if (mode === "rt" && BRN !== "chromium") continue;
    for (const [label, w, h, z] of MATRIX)
      for (const scheme of z === 100 && mode === "normal" || label.startsWith("compact") && mode === "normal" ? ["light", "dark"] : ["light"]) {
        const full = isFull(w, h), compact = !full;
        const T = `${BR} ctx[${mode}] ${label} ${scheme}`;
        const { ctx, p, errs } = await open(browser, { w, h, dpr: z / 100, scheme, base });
        try {
          await setMode(ctx, p, mode);
          // ---- ModeMenu: правый клик по строке режима на хабе
          await side(p, "side-play", compact); await settle(p);
          const sbRect = await rect(p, ".sidebar");
          for (const mid of ["classic", "liar"]) {
            const row = await rect(p, `${P} [data-testid="mode-${mid}"]`);
            await p.locator(`${P} [data-testid="mode-${mid}"]`).click({ button: "right" });
            await settle(p, 500);
            const menu = await rect(p, "[data-testid='ctx-menu']");
            const lift = await rect(p, "[data-testid='ctx-scrim'] .ctx-lift");
            const scrim = await rect(p, "[data-testid='ctx-scrim']");
            const bf = await backdrop(p, "[data-testid='ctx-scrim']");
            const okLift = lift && row && near(lift.left, row.left, 1.5) && near(lift.top, row.top, 1.5) && near(lift.width, row.width, 1.5);
            const okMenu = menu && row && (menu.top >= row.bottom - 1 || menu.bottom <= row.top + 1) && menu.left >= (scrim?.left ?? 0) && menu.right <= w + 0.5 && menu.bottom <= h + 0.5 && menu.top >= -0.5 && near(menu.left, Math.max((scrim?.left ?? 0) + 10, Math.min(row.left, w - 10 - menu.width)), 2);
            check(`${T} ModeMenu(${mid}): lift on the row, menu at the row, in window (backdrop=${bf})`, okLift && okMenu, { row: box(row), lift: box(lift), menu: box(menu), scrim: box(scrim), sidebarRight: sbRect && Math.round(sbRect.right) });
            if ((label === "1440x900@100" || label === "compact-1024x640" || label === "1920x1080@150") && scheme === "light" && mid === "classic") await p.screenshot({ path: `${SH}/${BR}-ctx-${mode}-${label}-modemenu.png` });
            await p.keyboard.press("Escape"); await settle(p, 400);
            const gone = !(await p.$("[data-testid='ctx-menu']"));
            const act = await active(p);
            check(`${T} ModeMenu(${mid}): Esc closes, focus returns to the row (got ${act})`, gone && (act === `mode-${mid}` || /srow|mode-/.test(act)), { gone, act });
          }
          // ---- AccuseMenu: Лжец, правый клик по заданной клетке
          await side(p, "side-mode-liar", compact); await settle(p);
          const st = p.locator(`${P} [data-testid="mode-page-start"]`);
          if (await st.count()) await st.click();
          await p.waitForSelector(`${P} .desk-play .board button.cell`, { timeout: 40000 }); await settle(p, 600);
          const given = p.locator(`${P} .board button.cell:has(.d.given)`).nth(12);
          const cell = await given.boundingBox();
          await given.click({ button: "right" }); await settle(p, 500);
          const acc = await rect(p, "[data-testid='accuse-menu']");
          const accLift = await rect(p, "[data-testid='accuse-scrim'] .liar-lift");
          const accScrim = await rect(p, "[data-testid='accuse-scrim']");
          if (!acc) check(`${T} AccuseMenu: opened`, false, {});
          else {
            const bf = await backdrop(p, "[data-testid='accuse-scrim']");
            const okL = accLift && near(accLift.left, cell.x, 1.5) && near(accLift.top, cell.y, 1.5) && near(accLift.width, cell.width, 1.5);
            const okM = (acc.top >= cell.y + cell.height - 1 || acc.bottom <= cell.y + 1) && acc.left >= (accScrim?.left ?? 0) && acc.right <= w + 0.5 && acc.bottom <= h + 0.5 && acc.top >= -0.5 && near(acc.left, Math.max((accScrim?.left ?? 0) + 10, Math.min(cell.x, w - 10 - acc.width)), 2);
            check(`${T} AccuseMenu: lift on the cell, menu at the cell, in window (backdrop=${bf})`, okL && okM, { cell: [Math.round(cell.x), Math.round(cell.y), Math.round(cell.width)], lift: box(accLift), menu: box(acc) });
            if ((label === "1440x900@100" || label === "compact-1024x640" || label === "1920x1080@150") && scheme === "light") await p.screenshot({ path: `${SH}/${BR}-ctx-${mode}-${label}-accuse.png` });
            await p.keyboard.press("Escape"); await settle(p, 400);
            const act = await active(p);
            check(`${T} AccuseMenu: Esc closes; focus not on body (got ${act})`, !(await p.$("[data-testid='accuse-menu']")) && act !== "body", { act });
          }
          check(`${T}: no JS errors`, errs.length === 0, { errs });
        } catch (e) { check(`${T}: threw`, false, { e: String(e).slice(0, 300) }); await p.screenshot({ path: `${SH}/${BR}-ctx-${mode}-${label}-${scheme}-ERR.png` }).catch(() => {}); }
        await ctx.close();
      }
  }
} finally { await browser.close().catch(() => {}); server.close(); }
fs.writeFileSync(`/tmp/qa270/results-ctx-${BR}-${MODES.join("_")}.json`, JSON.stringify({ total: Object.keys(results).length, fails, results }, null, 1));
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} PASS${fails.length ? "\nFAIL:\n  " + fails.join("\n  ") : ""}`);
