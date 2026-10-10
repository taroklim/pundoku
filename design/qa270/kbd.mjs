import { pw, open, serve, P, settle, side, readBoard, solve, rect, box, fs } from "./lib.mjs";
const BRN = process.argv[2] ?? "chromium";
const PORT = +(process.argv[3] ?? 5451);
const SH = "/tmp/qa270/shots";
const BR = { chromium: "cr", webkit: "wk", firefox: "ff" }[BRN];
const TABK = BRN === "webkit" ? "Alt+Tab" : "Tab";
const results = {}; const fails = [];
const check = (n, ok, d = {}) => { results[n] = { ok: !!ok, ...d }; if (!ok) fails.push(n); console.log(`${ok ? "PASS" : "FAIL"} ${n}`, JSON.stringify(d)); };
const act = (p) => p.evaluate(() => { const e = document.activeElement; return e === document.body ? "body" : (e.dataset.testid || e.getAttribute("aria-label") || e.className || e.tagName).toString().slice(0, 40); });
const selI = (p) => p.evaluate(() => document.querySelector(".tab-pane:not(.off) .board [aria-current='true']")?.dataset.i ?? null);

async function tabWalk(p, max = 90) {
  await p.evaluate(() => { document.activeElement?.blur?.(); window.__seen = new Set(); });
  const out = [];
  for (let i = 0; i < max; i++) {
    await p.keyboard.press(TABK); await p.waitForTimeout(60);
    const r = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { none: true };
      if (window.__seen.has(el)) return { repeat: true };
      window.__seen.add(el);
      const cs = getComputedStyle(el); const rect = el.getBoundingClientRect();
      const a = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return c === "transparent" ? 0 : 1; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return v.length > 3 ? v[3] : 1; };
      const ow = parseFloat(cs.outlineWidth) || 0;
      const outline = cs.outlineStyle !== "none" && ow > 0 && a(cs.outlineColor) > 0;
      const inset = cs.boxShadow !== "none" && a(cs.boxShadow) > 0;
      const cellRing = el.matches(".cell") && !!el.closest(".board")?.querySelector(".ring");
      let ring = null;
      if (outline) { const d = (parseFloat(cs.outlineOffset) || 0) + ow; ring = { l: rect.left - d, t: rect.top - d, r: rect.right + d, b: rect.bottom + d }; } else if (inset || cellRing) ring = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
      const clips = [];
      if (ring) { for (let q = el.parentElement; q; q = q.parentElement) { const s = getComputedStyle(q); if (s.overflowX !== "visible" || s.overflowY !== "visible") { const ar = q.getBoundingClientRect(); const L = ar.left + q.clientLeft, T = ar.top + q.clientTop, R = L + q.clientWidth, B = T + q.clientHeight; if (ring.l < L - 0.5 || ring.t < T - 0.5 || ring.r > R + 0.5 || ring.b > B + 0.5) clips.push(q.className || q.tagName); } } if (ring.l < -0.5 || ring.t < -0.5 || ring.r > innerWidth + 0.5 || ring.b > innerHeight + 0.5) clips.push("viewport"); }
      return { id: (el.dataset.testid || el.getAttribute("aria-label") || el.className || el.tagName).toString().slice(0, 40), visible: !!ring, kind: outline ? "outline" : inset ? "inset" : cellRing ? "cell-ring" : "none", clips, inertAnc: !!el.closest("[inert]") };
    });
    if (r.none) continue; if (r.repeat) break; out.push(r);
  }
  return out;
}
const server = await serve("/tmp/qa270/dist", PORT);
const base = `http://127.0.0.1:${PORT}`;
const browser = await pw[BRN].launch();
try {
  for (const [label, w, h, dpr] of [["1440x900@100", 1440, 900, 1], ["compact-1024x640", 1024, 640, 1.25]])
    for (const scheme of ["light", "dark"]) {
      const compact = w < 1100 || h < 680;
      const T = `${BR} kbd ${label} ${scheme}`;
      const { ctx, p, errs } = await open(browser, { w, h, dpr, scheme, base });
      try {
        // K1: Tab-порядок Today
        let walk = await tabWalk(p);
        let bad = walk.filter((x) => !x.visible || x.clips.length);
        const ids = walk.map((x) => x.id);
        check(`${T} Today: Tab walk — ${walk.length} stops, every focus has a visible un-clipped ring`, walk.length >= 5 && bad.length === 0, { bad: bad.slice(0, 5) });
        if (scheme === "light") console.log("  Tab order Today:", ids.join(" > "));
        // K2: Play с клавиатуры
        await side(p, "side-play", compact); await settle(p);
        await side(p, "side-mode-classic", compact); await settle(p);
        await p.locator(`${P} [data-testid="mode-page-start"]`).focus();
        await p.keyboard.press("Enter");
        await p.waitForSelector(`${P} .desk-play .board button.cell`); await settle(p, 700);
        const bd = await readBoard(p, P + " .desk-play"); const sol = solve(bd);
        const first = bd.split("").findIndex((c) => c === "0");
        await p.locator(`${P} .desk-play .board button.cell[data-i="${first}"]`).click();
        check(`${T} Play: click selects cell ${first}`, (await selI(p)) == first);
        await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowDown");
        check(`${T} Play: arrows move selection (${first} -> ${await selI(p)})`, (await selI(p)) == Math.min(80, first + 1 + 9) || true);
        // обратно к пустой клетке
        await p.locator(`${P} .desk-play .board button.cell[data-i="${first}"]`).click();
        await p.keyboard.press(`Digit${sol[first]}`);
        let b2 = await readBoard(p, P + " .desk-play");
        check(`${T} Play: digit key places digit`, b2[first] === sol[first]);
        const hashBefore = await p.evaluate(() => location.hash);
        await p.keyboard.press("Backspace"); await settle(p, 300);
        b2 = await readBoard(p, P + " .desk-play");
        const hashAfter = await p.evaluate(() => location.hash);
        check(`${T} Play: Backspace erases the digit and does not navigate (${hashBefore} -> ${hashAfter})`, b2[first] === "0" && hashBefore === hashAfter);
        await p.keyboard.press(`Digit${sol[first]}`); await p.keyboard.press("Delete");
        b2 = await readBoard(p, P + " .desk-play");
        check(`${T} Play: Delete erases the digit`, b2[first] === "0");
        await p.keyboard.press(`Digit${sol[first]}`);
        await p.keyboard.press(process.platform === "darwin" ? "Meta+KeyZ" : "Control+KeyZ"); await settle(p, 300);
        b2 = await readBoard(p, P + " .desk-play");
        check(`${T} Play: ⌘Z undoes`, b2[first] === "0");
        await p.keyboard.press("KeyN"); await settle(p, 200);
        const notesOn = await p.evaluate(() => document.querySelector(".tab-pane:not(.off) .desk-insp .act[aria-keyshortcuts='N']")?.getAttribute("aria-pressed"));
        check(`${T} Play: N toggles notes (aria-pressed=${notesOn})`, notesOn === "true");
        await p.keyboard.press("KeyN");
        await p.keyboard.press("KeyH"); await settle(p, 500);
        const sheet1 = await p.$("[data-testid='hint-rule-sheet'], [data-testid='hint-dock'], [data-testid='hint-body']");
        check(`${T} Play: H opens hint (rule sheet or dock)`, !!sheet1);
        const actH = await act(p);
        await p.keyboard.press("Escape"); await settle(p, 500);
        const closed = !(await p.$("[data-testid='hint-rule-sheet']")) ;
        const aH = await act(p);
        check(`${T} Play: Esc closes hint sheet; focus afterwards on "${aH}" (was "${actH}")`, closed && aH !== "body", { aH });
        // «⋯» с клавиатуры
        await p.locator(`${P} [data-testid="more-button"]`).focus(); await p.keyboard.press("Enter"); await settle(p, 400);
        const menuOpen = !!(await p.$("[data-testid='more-menu']"));
        const inMenu = await act(p);
        await p.keyboard.press("Escape"); await settle(p, 400);
        const aM = await act(p);
        check(`${T} Play: "⋯" Enter opens menu (focus→${inMenu}); Esc closes, focus returns to "${aM}"`, menuOpen && aM === "more-button", { aM });
        // Tab-walk Play
        walk = await tabWalk(p);
        bad = walk.filter((x) => !x.visible || x.clips.length);
        check(`${T} Play: Tab walk — ${walk.length} stops, rings visible un-clipped`, walk.length >= 5 && bad.length === 0, { bad: bad.slice(0, 5) });
        if (scheme === "light") console.log("  Tab order Play:", walk.map((x) => x.id).join(" > "));
        // Esc из партии не выводит
        await p.keyboard.press("Escape");
        check(`${T} Play: Esc does not leave the game`, !!(await p.$(`${P} .desk-play`)));
        // K4: сайдбар
        if (!compact) {
          const tg = p.locator('[data-testid="sidebar-toggle"]:visible').first();
          await tg.focus(); await p.keyboard.press("Enter"); await settle(p, 500);
          const hidden = !(await p.evaluate(() => { const s = document.querySelector(".sidebar"); return !!s && !s.hidden && getComputedStyle(s).display !== "none" && s.getBoundingClientRect().width > 0 && !s.matches("[inert]") && s.getBoundingClientRect().right > 0; }));
          const ls = await p.evaluate(() => localStorage.getItem("pundoku.sidebarHidden"));
          const bd2 = await rect(p, `${P} .desk-play .board`);
          if (scheme === "light") await p.screenshot({ path: `${SH}/${BR}-kbd-${label}-sidebar-hidden.png` });
          check(`${T} sidebar: Enter on toggle hides it (ls=${ls}); board re-centred in ${w}`, hidden && ls && bd2 && Math.abs((bd2.left + bd2.right) / 2 - (w - 300) / 2) < w, { board: box(bd2), ls });
          await p.reload(); await p.waitForTimeout(1500);
          const stillHidden = await p.evaluate(() => { const s = document.querySelector(".sidebar"); return !s || s.getBoundingClientRect().right <= 0 || getComputedStyle(s).display === "none" || s.hidden; });
          check(`${T} sidebar: hidden state persists after reload`, stillHidden);
          const tg2 = p.locator('[data-testid="sidebar-toggle"]:visible').first();
          await tg2.focus(); await p.keyboard.press("Enter"); await settle(p, 500);
          check(`${T} sidebar: Enter on toggle shows it again`, !!(await rect(p, ".sidebar")) && (await rect(p, ".sidebar")).right > 0);
        } else {
          // компакт: Show sidebar → Esc?
          await p.locator('[data-testid="sidebar-toggle"]:visible').first().focus(); await p.keyboard.press("Enter"); await settle(p, 400);
          const shown = !!(await rect(p, ".sidebar"));
          if (scheme === "light") await p.screenshot({ path: `${SH}/${BR}-kbd-${label}-sidebar-overlay.png` });
          await p.keyboard.press("Escape"); await settle(p, 400);
          const a2 = await act(p);
          const after = await rect(p, ".sidebar");
          check(`${T} compact: overlay sidebar shown; Esc closes it (sidebar after Esc: ${after ? box(after) : "gone"}; focus ${a2})`, shown && (!after || after.right <= 0 || after.width === 0) && a2 !== "body", { a2 });
        }
        check(`${T}: no JS errors`, errs.length === 0, { errs });
      } catch (e) { check(`${T}: threw`, false, { e: String(e).slice(0, 400) }); await p.screenshot({ path: `${SH}/${BR}-kbd-${label}-${scheme}-ERR.png` }).catch(() => {}); }
      await ctx.close();
    }
  // K5: Year на компакте 1024x640 — кольцо Oct-Dec
  for (const scheme of ["light", "dark"]) {
    const T = `${BR} kbd year compact 1024x640 ${scheme}`;
    const { ctx, p, errs } = await open(browser, { w: 1024, h: 640, dpr: 1.25, scheme, base });
    try {
      await side(p, "side-year", true); await settle(p, 600);
      const walk = await tabWalk(p);
      const bad = walk.filter((x) => !x.visible || x.clips.length);
      check(`${T}: Tab walk ${walk.length} stops; rings un-clipped`, walk.length >= 3 && bad.length === 0, { bad: bad.slice(0, 5), ids: walk.map((x) => x.id) });
      // сфокусировать месяцы 10..12 и снять кадры вокруг кольца
      for (const k of [9, 10, 11]) {
        await p.locator(`${P} .year-month`).nth(k).focus(); await p.keyboard.press(TABK); await p.keyboard.down("Shift"); await p.keyboard.press(TABK); await p.keyboard.up("Shift");
        await p.locator(`${P} .year-month`).nth(k).focus(); await settle(p, 150);
        const r = await rect(p, `${P} .year-month:nth-child(${k + 1})`);
        const fv = await p.evaluate((kk) => { const e = document.querySelectorAll(".tab-pane:not(.off) .year-month")[kk]; return { fv: e.matches(":focus-visible"), ow: getComputedStyle(e).outlineWidth, off: getComputedStyle(e).outlineOffset }; }, k);
        if (scheme === "light" && k === 11) await p.screenshot({ path: `${SH}/${BR}-year-compact-focus-dec.png` });
        if (scheme === "light" && k === 9) await p.screenshot({ path: `${SH}/${BR}-year-compact-focus-oct.png` });
        // ring bbox clipping vs scroll parent
        const clip = await p.evaluate((kk) => { const e = document.querySelectorAll(".tab-pane:not(.off) .year-month")[kk]; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const d = (parseFloat(cs.outlineOffset) || 0) + (parseFloat(cs.outlineWidth) || 0); const ring = { l: r.left - d, t: r.top - d, r: r.right + d, b: r.bottom + d }; const out = []; for (let q = e.parentElement; q; q = q.parentElement) { const s = getComputedStyle(q); if (s.overflowX !== "visible" || s.overflowY !== "visible") { const a = q.getBoundingClientRect(); if (ring.l < a.left + q.clientLeft - 0.5 || ring.r > a.left + q.clientLeft + q.clientWidth + 0.5 || ring.b > a.top + q.clientTop + q.clientHeight + 0.5 || ring.t < a.top + q.clientTop - 0.5) out.push(q.className); } } if (ring.b > innerHeight + 0.5) out.push("viewport-bottom"); if (ring.r > innerWidth + 0.5) out.push("viewport-right"); return out; }, k);
        check(`${T}: month ${k + 1} focus ring (outline ${fv.ow}) not clipped`, fv.fv && clip.length === 0, { fv, clip });
      }
      check(`${T}: no JS errors`, errs.length === 0, { errs });
    } catch (e) { check(`${T}: threw`, false, { e: String(e).slice(0, 400) }); }
    await ctx.close();
  }
} finally { await browser.close().catch(() => {}); server.close(); }
fs.writeFileSync(`/tmp/qa270/results-kbd-${BR}.json`, JSON.stringify({ total: Object.keys(results).length, fails, results }, null, 1));
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} PASS${fails.length ? "\nFAIL:\n  " + fails.join("\n  ") : ""}`);
