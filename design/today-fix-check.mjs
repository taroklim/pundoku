// PD-147 (b) — live test: on Today (and the archive) the hint dock (PD-139) must not move the board or the heading, on any
// ladder step (1..4) and in the «mistake» branch; the pad / action row / dock sit above the tab bar; the page does not scroll
// while a game is on. Same properties as design/pd144-fit-check.mjs for Play, measured on `#/today`.
//
//   cd /tmp/pundoku-ios/pw && PLAYWRIGHT_BROWSERS_PATH=... BASE=http://localhost:3991 \
//     node <repo>/design/today-fix-check.mjs [filter] [--quick] [--shots=<dir>] [--soft]
//
// For every case (engine x screen x language x theme x type size) it measures the board and title bbox of the fresh game, opens
// the dock, walks steps 1..4 and the «mistake» branch (a duplicate digit placed on purpose) and asserts both bboxes are IDENTICAL
// at every step and after closing. `--soft`: print the deltas but do not set a failing exit code (used for the «before» run).
// `--shots=<dir>`: frames of the fresh game, step 2 and the «mistake» branch for the en/light case of every size.
// Today only: the «source» line under the status is part of the gap, so the reserve must hold it too.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');

// PROFILE=<state.json> seeds a «veteran» profile (cookies/localStorage + IndexedDB dump, see research/usability-2026-10/ia-measure/lib-after.mjs): the archive needs days after the first use.
const PROFILE = process.env.PROFILE ? JSON.parse(readFileSync(process.env.PROFILE, 'utf8')) : null;
const RESTORE = PROFILE ? (await import(pathToFileURL(new URL('../research/usability-2026-10/ia-measure/lib-after.mjs', import.meta.url).pathname).href)).RESTORE : null;
const BASE = process.env.BASE ?? 'http://localhost:3991';
const ROUTE = process.env.ROUTE ?? 'today'; // e.g. ROUTE=day/2026-10-01 for the archive screen
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const quick = args.includes('--quick');
const soft = args.includes('--soft');
const shotsDir = (args.find((a) => a.startsWith('--shots=')) ?? '').slice(8);
const SCREENS = [[320, 568], [375, 667], [390, 844], [393, 852]];
const LOCALE = { en: 'en-US', uk: 'uk-UA', ru: 'ru-RU' };

const cases = [];
for (const engine of ['chromium', 'webkit'])
  for (const [w, h] of SCREENS) {
    cases.push({ engine, w, h, lang: 'en', scheme: 'light' });
    cases.push({ engine, w, h, lang: 'en', scheme: 'dark' });
    for (const lang of ['uk', 'ru']) cases.push({ engine, w, h, lang, scheme: 'light' });
    for (const lang of w <= 375 ? ['en', 'ru'] : ['en']) cases.push({ engine, w, h, lang, scheme: 'light', ax3: 1 });
  }
const picked = cases.filter((c) => !quick || c.engine === 'webkit').filter((c) => !filter || label(c).includes(filter));
function label(c) { return `${c.engine} ${c.w}x${c.h} ${c.lang} ${c.scheme}${c.ax3 ? ' AX3' : ''}`; }

const measure = (page) => page.evaluate(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), l: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const sc = document.querySelector('.scroll');
  const sub = document.querySelector('.subline');
  const lineH = sub ? parseFloat(getComputedStyle(sub).lineHeight) || 0 : 0;
  const more = document.querySelector('[data-testid="hint-more"]'); const bar = document.querySelector('.tabbar').getBoundingClientRect();
  const mb = more?.getBoundingClientRect();
  const close = document.querySelector('[data-testid="hint-close"]')?.getBoundingClientRect();
  const touch = [...document.querySelectorAll('.act, .hint-more, .hint-close, .hint-btn, .key, .tabbar [role=tab]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => [e.className, Math.round(e.getBoundingClientRect().height)]);
  return {
    board: R('.board'), title: R('.play .title'), tab: R('.tabbar'), pad: R('.pad'), actions: R('.actions'), dock: R('[data-testid="hint-dock"]'), sub: R('.subline'), lineH,
    scroll: sc ? [sc.scrollTop, sc.scrollHeight, sc.clientHeight] : null, doc: [document.documentElement.scrollHeight, innerHeight],
    docW: [document.documentElement.scrollWidth, innerWidth], btnOk: [mb, close].filter(Boolean).every((b) => b.bottom <= bar.top + 0.5 && b.top >= 0), touch,
    kind: document.querySelector('[data-testid="hint-dock"]')?.dataset.kind ?? null,
  };
});
const same = (a, b) => a && b && a.t === b.t && a.l === b.l && a.w === b.w && a.h === b.h;
const fmt = (b) => (b ? `${b.w}@${b.t}` : 'none');

const fails = [];
const table = [];
const run = async (browser, c) => {
  const L = label(c);
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2, isMobile: c.engine === 'webkit', hasTouch: true, locale: LOCALE[c.lang], colorScheme: c.scheme, ...(PROFILE ? { storageState: PROFILE.ls } : {}) });
  if (PROFILE?.idb && Object.keys(PROFILE.idb).length) { const p0 = await ctx.newPage(); await p0.goto(BASE + '/health'); await p0.evaluate(RESTORE, PROFILE.idb); await p0.close(); }
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
  const shot = async (name) => { if (shotsDir && c.lang === 'en' && c.scheme === 'light' && !c.ax3) await page.screenshot({ path: `${shotsDir}/${c.engine}-${c.w}x${c.h}-${name}.png` }); };
  try {
    await page.goto(BASE + '/#/' + ROUTE);
    await page.waitForSelector('.board button.cell', { timeout: 40000 });
    await page.waitForTimeout(900);
    const m0 = await measure(page);
    await shot('0-fresh');
    check(m0.scroll && m0.scroll[0] === 0 && m0.scroll[1] <= m0.scroll[2] + 1 && m0.docW[0] <= m0.docW[1], `playing screen scrolls ${JSON.stringify([m0.scroll, m0.docW])}`);
    check(m0.sub.h < m0.lineH * 1.6 + 1, `subline is not one line (h=${m0.sub.h}, line=${m0.lineH})`);
    check(m0.actions.b <= m0.tab.t + 0.5 && m0.pad.b <= m0.tab.t + 0.5, `pad/actions under the tab bar (${m0.actions.b} > ${m0.tab.t})`);
    check(m0.touch.every(([, h]) => h >= 44 || h === 0), `touch target < 44: ${JSON.stringify(m0.touch.filter(([, h]) => h < 44))}`);
    await q('hint-button').tap(); await page.waitForTimeout(500);
    if (await q('hint-rule-go').count()) { await q('hint-rule-go').tap(); await page.waitForTimeout(700); }
    const dockH = [];
    for (let step = 1; step <= 4; step++) {
      if (step > 1) { await q('hint-more').tap(); await page.waitForTimeout(450); }
      const m = await measure(page);
      if (!m.dock) { bad(`no dock at step ${step}`); break; }
      if (step === 2) await shot('1-step2');
      check(same(m.board, m0.board), `step ${step}: board moved ${fmt(m0.board)} -> ${fmt(m.board)}`);
      check(same(m.title, m0.title), `step ${step}: title moved ${fmt(m0.title)} -> ${fmt(m.title)}`);
      check(m.scroll[0] === 0 && m.scroll[1] <= m.scroll[2] + 1, `step ${step}: screen scrolls ${JSON.stringify(m.scroll)}`);
      check(m.dock.b <= m.tab.t + 0.5 && m.dock.t >= m.board.b - 0.5, `step ${step}: dock outside its slot (${m.dock.t}..${m.dock.b}, board.b ${m.board.b}, tab ${m.tab.t})`);
      check(m.btnOk, `step ${step}: the dock button is not fully visible`);
      check(m.sub.h < m.lineH * 1.6 + 1, `step ${step}: subline is not one line`);
      check(m.touch.every(([, h]) => h >= 44 || h === 0), `step ${step}: touch target < 44: ${JSON.stringify(m.touch.filter(([, h]) => h < 44))}`);
      dockH.push(Math.round(m.dock.h));
    }
    await q('hint-close').tap(); await page.waitForTimeout(500);
    const mc = await measure(page);
    check(same(mc.board, m0.board) && same(mc.title, m0.title), `after close: board ${fmt(m0.board)} -> ${fmt(mc.board)}, title ${fmt(m0.title)} -> ${fmt(mc.title)}`);
    check(mc.sub.h < mc.lineH * 1.6 + 1 && mc.actions.b <= mc.tab.t + 0.5, 'after close: subline/actions broken');
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
      await shot('2-mistake');
      check(mm.kind === 'mistake', `«mistake» branch not reached (kind=${mm.kind})`);
      check(same(mm.board, m0.board), `mistake: board ${fmt(m0.board)} -> ${fmt(mm.board)}`);
      check(same(mm.title, m0.title), `mistake: title ${fmt(m0.title)} -> ${fmt(mm.title)}`);
      check(mm.dock && mm.dock.b <= mm.tab.t + 0.5 && mm.btnOk, 'mistake: dock/button not above the tab bar');
      check(mm.scroll[0] === 0 && mm.scroll[1] <= mm.scroll[2] + 1, `mistake: screen scrolls ${JSON.stringify(mm.scroll)}`);
      dockH.push(`m${Math.round(mm.dock?.h ?? 0)}`);
    }
    check(errs.length === 0, `page errors: ${errs.join('|')}`);
    table.push([L, `board ${fmt(m0.board)} title@${m0.title?.t}`, dockH.join('/')]);
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
console.log('\ncase | board closed (w@top), title top | dock heights per step');
for (const r of table) console.log(r.join(' | '));
console.log(fails.length ? `\nFAILED ${fails.length}` : `\nALL PASS (${table.length} cases)`);
process.exit(fails.length && !soft ? 1 : 0);
