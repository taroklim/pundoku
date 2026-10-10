import { pw, open, serve, P, settle, rect, box, MISSION, SOLUTION, fs } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium"; const PORT = +(process.argv[3] ?? 5471);
const BR = { chromium: "cr", webkit: "wk", firefox: "ff" }[BRN];
const SH = "/tmp/qa270/shots"; const results = {}; const fails = [];
const check = (n, ok, d = {}) => { results[n] = { ok: !!ok, ...d }; if (!ok) fails.push(n); console.log(`${ok ? "PASS" : "FAIL"} ${n}`, JSON.stringify(d)); };
const server = await serve("/tmp/qa270/dist", PORT); const base = `http://127.0.0.1:${PORT}`;
const browser = await pw[BRN].launch();
try {
  for (const [label, w, h, dpr] of [["1280x800@100", 1280, 800, 1], ["1440x900@100", 1440, 900, 1], ["1920x1080@100", 1920, 1080, 1], ["1536x960@125", 1536, 960, 1.25]]) for (const loc of ["en-US", "ru-RU", "uk-UA"]) for (const variant of ["hint+late", "plain"]) {
    const T = `${BR} late ${label} ${loc} ${variant}`;
    const { ctx, p, errs } = await open(browser, { w, h, dpr, base, locale: loc });
    try {
      const html = await p.evaluate(() => document.documentElement.lang);
      if (variant === "hint+late") {
        // подсказка до решения
        await p.locator(`${P} [data-testid="hint-button"]`).click(); await settle(p, 400);
        const go = p.locator("[data-testid='hint-rule-go']"); if (await go.count()) await go.click();
        await settle(p, 500);
        await p.evaluate(() => 0);
        // полночь прошла
        await ctx.clock.setFixedTime(new Date("2026-10-10T00:10:00Z"));
      }
      for (let i = 0; i < 81; i++) if (MISSION[i] === "0") { await p.locator(`${P} .board button.cell[data-i="${i}"]`).click({ timeout: 8000 }); await p.keyboard.press(`Digit${SOLUTION[i]}`); }
      await p.waitForSelector(`${P} [data-testid="grid-inf-section"]`, { timeout: 20000 }); await settle(p, 1300);
      const late = !!(await p.$("[data-testid='late-note']")), hintsRow = !!(await p.$(`${P} .desk-insp [data-testid='assisted-row']`));
      const m = await p.evaluate(() => { const i = document.querySelector(".desk-insp"); i.scrollTop = 0; return { over: i.scrollHeight - i.clientHeight, sh: i.scrollHeight, ch: i.clientHeight }; });
      await p.screenshot({ path: `${SH}/${BR}-late-${label}-${loc}-${variant}-top.png` });
      await p.evaluate(() => { const i = document.querySelector(".desk-insp"); i.scrollTop = i.scrollHeight; }); await settle(p, 250);
      const cut = await p.evaluate(() => { const i = document.querySelector(".desk-insp"); const ir = i.getBoundingClientRect(); return [...i.querySelectorAll("button, a")].filter((e) => e.getClientRects().length).filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > ir.bottom + 0.5 || r.top < ir.top - 0.5; }).map((e) => (e.dataset.testid || e.textContent).trim().slice(0, 20)); });
      await p.screenshot({ path: `${SH}/${BR}-late-${label}-${loc}-${variant}-bottom.png` });
      // видимость всех интерактивных при scrollTop = max и 0 вместе: каждый виден хотя бы в одном из положений
      check(`${T} (lang=${html}, late=${late}, assisted=${hintsRow}): inspector overflow ${m.over}px; controls unreachable at bottom: ${cut.length}`, cut.length === 0, { ...m, cut, late, hintsRow });
      check(`${T}: no JS errors`, errs.length === 0, { errs });
    } catch (e) { check(`${T}: threw`, false, { e: String(e).slice(0, 300) }); await p.screenshot({ path: `${SH}/${BR}-late-${label}-${loc}-${variant}-ERR.png` }).catch(() => {}); }
    await ctx.close();
  }
} finally { await browser.close().catch(() => {}); server.close(); }
fs.writeFileSync(`/tmp/qa270/results-late-${BR}.json`, JSON.stringify({ total: Object.keys(results).length, fails, results }, null, 1));
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} PASS${fails.length ? "\nFAIL:\n  " + fails.join("\n  ") : ""}`);
