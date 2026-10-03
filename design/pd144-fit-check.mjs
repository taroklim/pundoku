// PD-144 (D-1/D-2) — live test: the hint dock (PD-133) must not move or shrink the board, the AX3 chips must not break the layout.
//
//   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers BASE=http://localhost:3991 \
//     node <repo>/design/pd144-fit-check.mjs [filter] [--quick]
//
// For every case (engine x screen x language x theme x type size x mode) it measures the board bbox (top, left, width, height) of the
// fresh game, then opens the hint dock and walks the whole ladder (steps 1..4) plus the «mistake» branch (a duplicate digit placed on
// purpose) and asserts the board bbox is IDENTICAL at every step and after closing. Also asserts: screen does not scroll, subline is one
// line, pad + action row + dock sit above the tab bar, the dock's buttons are fully visible, touch targets >= 44 px.
// Ink: no lamp, nothing to reserve — the board is compared before/after opening the menu only (no dock exists).
// The «none» branch («nothing found») cannot be reached on demand on a fresh grid; its layout is a subset of a ladder step (no key, no
// foot) and is covered by jsdom (hint.ui.test.tsx) and by the model (play/fitModel.test.ts).
// PW_WEBKIT_EXEC=<path to pw_run.sh> overrides the WebKit build (when the default one is not installed).
// Exit code 1 on any failure. Prints a table: screen -> board px closed / with dock.
import { createRequire } from 'node:module';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');

const BASE = process.env.BASE ?? 'http://localhost:3991';
const filter = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
const quick = process.argv.includes('--quick');
const SCREENS = [[320, 568], [375, 667], [390, 844], [393, 852]];
const LOCALE = { en: 'en-US', uk: 'uk-UA', ru: 'ru-RU' };

const cases = [];
for (const engine of ['chromium', 'webkit'])
  for (const [w, h] of SCREENS) {
    // en everywhere; uk/ru where the dock text is longest (short screens); dark once per size; AX3 and Ink on every size.
    cases.push({ engine, w, h, lang: 'en', scheme: 'light' });
    cases.push({ engine, w, h, lang: 'en', scheme: 'dark' });
    if (w <= 375) for (const lang of ['uk', 'ru']) cases.push({ engine, w, h, lang, scheme: 'light' });
    for (const lang of w <= 375 ? ['en', 'ru'] : ['en']) cases.push({ engine, w, h, lang, scheme: 'light', ax3: 1 });
    cases.push({ engine, w, h, lang: 'en', scheme: 'dark', ink: 1 });
    cases.push({ engine, w, h, lang: 'ru', scheme: 'light', ax3: 1, ink: 1 });
  }
const picked = cases.filter((c) => !quick || c.engine === 'chromium').filter((c) => !filter || label(c).includes(filter));

function label(c) { return `${c.engine} ${c.w}x${c.h} ${c.lang} ${c.scheme}${c.ax3 ? ' AX3' : ''}${c.ink ? ' ink' : ''}`; }

const measure = (page) => page.evaluate(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), l: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const fit = document.querySelector('.play-fit');
  const sub = document.querySelector('.subline');
  const lineH = sub ? parseFloat(getComputedStyle(sub).lineHeight) || 0 : 0;
  const touch = [...document.querySelectorAll('.act, .hint-more, .hint-close, .hint-btn, .key, .tabbar [role=tab]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => [e.className, Math.round(e.getBoundingClientRect().height)]);
  const more = document.querySelector('[data-testid="hint-more"]'); const bar = document.querySelector('.tabbar').getBoundingClientRect();
  const mb = more?.getBoundingClientRect();
  return {
    board: R('.board'), tab: R('.tabbar'), pad: R('.pad'), actions: R('.actions'), dock: R('[data-testid="hint-dock"]'), sub: R('.subline'), lineH,
    fit: fit ? [fit.scrollHeight, fit.clientHeight] : null, doc: [document.documentElement.scrollHeight, innerHeight], docW: [document.documentElement.scrollWidth, innerWidth],
    moreOk: mb ? mb.bottom <= bar.top + 0.5 && mb.top >= 0 : null, touch, lamp: !!document.querySelector('[data-testid="hint-button"]'),
    kind: document.querySelector('[data-testid="hint-dock"]')?.dataset.kind ?? null,
  };
});
const same = (a, b) => a.t === b.t && a.l === b.l && a.w === b.w && a.h === b.h;
const fmt = (b) => `${b.w}@${b.t}`;

const fails = [];
const table = [];
const run = async (browser, c) => {
  const L = label(c);
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2, isMobile: c.engine === 'webkit', hasTouch: true, locale: LOCALE[c.lang], colorScheme: c.scheme });
  await ctx.addInitScript((px) => {
    const add = () => { const s = document.createElement('style'); s.textContent = `html{font-size:${px}px !important}`; document.documentElement.appendChild(s); };
    if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
  }, c.ax3 ? 40 : 17);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const q = (id) => page.locator(`[data-testid="${id}"]`);
  const bad = (msg) => { fails.push(`${L}: ${msg}`); console.log(`FAIL  ${L}: ${msg}`); };
  const check = (cond, msg) => { if (!cond) bad(msg); };
  try {
    await page.goto(BASE + '/#/play');
    await page.waitForTimeout(1200);
    if (c.ink) { await q('mode-row').tap(); await q('mode-ink').tap(); await q('ink-rule-start').tap(); await page.waitForTimeout(300); await q('mode-done').tap(); }
    await q('setup-start').tap();
    await page.waitForSelector('.board:not(.idle)', { timeout: 40000 });
    await page.waitForTimeout(700);
    const m0 = await measure(page);
    check(m0.fit && m0.fit[0] === m0.fit[1] && m0.doc[0] <= m0.doc[1] && m0.docW[0] <= m0.docW[1], `screen scrolls ${JSON.stringify([m0.fit, m0.doc, m0.docW])}`);
    check(m0.sub.h < m0.lineH * 1.6 + 1, `subline is not one line (h=${m0.sub.h}, line=${m0.lineH})`);
    check(m0.actions.b <= m0.tab.t + 0.5 && m0.pad.b <= m0.tab.t + 0.5, `pad/actions under the tab bar (${m0.actions.b} > ${m0.tab.t})`);
    check(m0.touch.every(([, h]) => h >= 44 || h === 0), `touch target < 44: ${JSON.stringify(m0.touch.filter(([, h]) => h < 44))}`);
    if (c.ink) {
      check(!m0.lamp, 'Ink: the hint lamp must not exist');
      table.push([L, fmt(m0.board), 'no lamp', '']);
      return;
    }
    // Hint ladder.
    await q('hint-button').tap(); await page.waitForTimeout(500);
    if (await q('hint-rule-go').count()) { await q('hint-rule-go').tap(); await page.waitForTimeout(700); }
    let dockH = [];
    for (let step = 1; step <= 4; step++) {
      if (step > 1) { await q('hint-more').tap(); await page.waitForTimeout(450); }
      const m = await measure(page);
      if (!m.dock) { bad(`no dock at step ${step}`); break; }
      check(same(m.board, m0.board), `step ${step}: board moved ${fmt(m0.board)} -> ${fmt(m.board)}`);
      check(m.fit[0] === m.fit[1] && m.doc[0] <= m.doc[1], `step ${step}: screen scrolls ${JSON.stringify([m.fit, m.doc])}`);
      check(m.dock.b <= m.tab.t + 0.5 && m.dock.t >= m.board.b - 0.5, `step ${step}: dock outside its slot (${m.dock.t}..${m.dock.b}, board.b ${m.board.b}, tab ${m.tab.t})`);
      check(m.moreOk, `step ${step}: the dock button is not fully visible`);
      check(m.sub.h < m.lineH * 1.6 + 1, `step ${step}: subline is not one line`);
      check(m.touch.every(([, h]) => h >= 44 || h === 0), `step ${step}: touch target < 44: ${JSON.stringify(m.touch.filter(([, h]) => h < 44))}`);
      dockH.push(Math.round(m.dock.h));
    }
    await q('hint-close').tap(); await page.waitForTimeout(500);
    const mc = await measure(page);
    check(same(mc.board, m0.board), `after close: board ${fmt(m0.board)} -> ${fmt(mc.board)}`);
    check(mc.sub.h < mc.lineH * 1.6 + 1 && mc.actions.b <= mc.tab.t + 0.5, 'after close: subline/actions broken (the «with help» chip)');
    // «mistake» branch: put a digit that duplicates a given in the same row into an empty cell.
    const cells = await page.evaluate(() => [...document.querySelectorAll('.board button.cell')].map((e) => ({ i: +e.dataset.i, d: e.querySelector('.d.given')?.textContent?.trim() ?? '', empty: !e.querySelector('.d') })));
    let target = null;
    for (const e of cells.filter((x) => x.empty)) {
      const row = cells.filter((x) => Math.floor(x.i / 9) === Math.floor(e.i / 9) && x.d);
      if (row.length) { target = { i: e.i, d: row[0].d }; break; }
    }
    if (!target) bad('no empty cell with a given in its row for the «mistake» branch');
    else {
      await page.locator(`.board button.cell[data-i="${target.i}"]`).tap();
      await page.locator('.pad .key').nth(+target.d - 1).tap(); await page.waitForTimeout(400);
      await q('hint-button').tap(); await page.waitForTimeout(600);
      const mm = await measure(page);
      check(mm.kind === 'mistake', `«mistake» branch not reached (kind=${mm.kind})`);
      check(same(mm.board, m0.board), `mistake: board ${fmt(m0.board)} -> ${fmt(mm.board)}`);
      check(mm.dock && mm.dock.b <= mm.tab.t + 0.5 && mm.moreOk, 'mistake: dock/button not above the tab bar');
      check(mm.fit[0] === mm.fit[1], 'mistake: screen scrolls');
      dockH.push(`m${Math.round(mm.dock?.h ?? 0)}`);
    }
    check(errs.length === 0, `page errors: ${errs.join('|')}`);
    table.push([L, fmt(m0.board), 'same on 1-4+mistake', dockH.join('/')]);
  } catch (e) {
    bad(`exception: ${e.message.split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
};

for (const engine of ['chromium', 'webkit']) {
  const list = picked.filter((c) => c.engine === engine);
  if (!list.length) continue;
  const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'webkit' && process.env.PW_WEBKIT_EXEC ? { executablePath: process.env.PW_WEBKIT_EXEC } : {});
  for (const c of list) await run(browser, c);
  await browser.close();
}
console.log('\ncase | board closed (w@top) | with dock | dock heights per step');
for (const r of table) console.log(r.join(' | '));
console.log(fails.length ? `\nFAILED ${fails.length}` : `\nALL PASS (${table.length} cases)`);
process.exit(fails.length ? 1 : 0);
