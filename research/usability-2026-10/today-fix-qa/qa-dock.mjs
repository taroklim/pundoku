// QA PD-150 (ex PD-147) — независимая проверка дока подсказки на Today/архиве: bbox доски и заголовка неизменны при открытии/закрытии дока.
// Ветки: ступени 1-4, ошибка (mistake), «не нашёл» (none; сетка Inkala-типа подсовывается через route-перехват API), Ink (вход по ink-row).
// BASE=http://127.0.0.1:3992 PROFILE=/tmp/qa-todayfix/state-vet.json ROUTE=today|day/2026-09-27 ENGINES=webkit,chromium node qa-dock.mjs [filter] [--soft]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { webkit, chromium } = createRequire('/tmp/pundoku-ios/pw/')('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3992';
const ROUTE = process.env.ROUTE ?? 'today';
const PROFILE = process.env.PROFILE ? JSON.parse(readFileSync(process.env.PROFILE, 'utf8')) : null;
const RESTORE = PROFILE ? (await import(pathToFileURL(new URL('./lib-qa.mjs', import.meta.url).pathname).href)).RESTORE : null;
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const soft = args.includes('--soft');
const ENGINES = (process.env.ENGINES ?? 'webkit').split(',');
const SCREENS = [[320, 568], [375, 667], [390, 844], [393, 852]];
const LOCALE = { en: 'en-US', uk: 'uk-UA', ru: 'ru-RU' };
const HARD = '800000000003600000070090200050007000000045700000100030001000068008500010090000400';
const cases = [];
for (const engine of ENGINES) for (const [w, h] of SCREENS) {
  for (const [lang, scheme] of [['en', 'light'], ['en', 'dark'], ['uk', 'light'], ['ru', 'dark']]) cases.push({ engine, w, h, lang, scheme });
  cases.push({ engine, w, h, lang: 'en', scheme: 'light', ax3: 1 });
  if (w <= 375) cases.push({ engine, w, h, lang: 'ru', scheme: 'light', ax3: 1 });
}
const label = (c) => `${c.engine} ${c.w}x${c.h} ${c.lang} ${c.scheme}${c.ax3 ? ' AX3' : ''}`;
const picked = cases.filter((c) => !filter || label(c).includes(filter));
const measure = (page) => page.evaluate(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), l: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const sc = document.querySelector('.scroll'); const tab = document.querySelector('.tabbar').getBoundingClientRect();
  const btns = ['hint-more', 'hint-close'].map((id) => document.querySelector(`[data-testid="${id}"]`)).filter(Boolean).map((e) => e.getBoundingClientRect());
  return { board: R('.board'), title: R('.play .title'), tab: R('.tabbar'), pad: R('.pad'), actions: R('.actions'), dock: R('[data-testid="hint-dock"]'),
    scroll: sc ? [sc.scrollTop, sc.scrollHeight, sc.clientHeight] : null, docW: [document.documentElement.scrollWidth, innerWidth],
    btnOk: btns.every((b) => b.bottom <= tab.top + 0.5 && b.top >= 0), nbtn: btns.length,
    kind: document.querySelector('[data-testid="hint-dock"]')?.dataset.kind ?? null, fit: !!document.querySelector('.play.play-fit'),
    focus: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName };
});
const same = (a, b) => a && b && a.t === b.t && a.l === b.l && a.w === b.w && a.h === b.h;
const fmt = (b) => (b ? `${b.w}@${b.t}` : 'none');
const fails = []; const table = [];
async function run(browser, c) {
  const L = label(c);
  const ctxs = [];
  const bad = (m) => { fails.push(`${L} [${ROUTE}]: ${m}`); console.log(`FAIL  ${L} [${ROUTE}]: ${m}`); };
  const check = (cond, m) => { if (!cond) bad(m); };
  const errs = [];
  const newPage = async (hard) => {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2, isMobile: c.engine === 'webkit', hasTouch: true, locale: LOCALE[c.lang], colorScheme: c.scheme, timezoneId: 'UTC', ...(PROFILE ? { storageState: PROFILE.ls } : {}) });
    ctxs.push(ctx);
    if (PROFILE?.idb && Object.keys(PROFILE.idb).length) { const p0 = await ctx.newPage(); await p0.goto(BASE + '/health'); await p0.evaluate(RESTORE, PROFILE.idb); await p0.close(); }
    await ctx.addInitScript((px) => { const add = () => { const s = document.createElement('style'); s.textContent = `html{font-size:${px}px !important}`; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); }, c.ax3 ? 40 : 17);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    if (hard) await page.route('**/api/daily/*', (r) => r.request().url().includes('/verify') ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ date: r.request().url().split('/').pop(), mission: HARD, difficulty: 'expert', source: 'sudoku.com', winRate: 0.1 }) }));
    return page;
  };
  const q = (page, id) => page.locator(`[data-testid="${id}"]`);
  const open = async (page) => { await page.goto(BASE + '/#/' + ROUTE); await page.waitForSelector('.board button.cell', { timeout: 40000 }); await page.waitForTimeout(900); };
  const openHint = async (page) => { await q(page, 'hint-button').tap(); await page.waitForTimeout(500); if (await q(page, 'hint-rule-go').count()) { await q(page, 'hint-rule-go').tap(); await page.waitForTimeout(700); } };
  const stable = (m, m0, tag) => {
    check(same(m.board, m0.board), `${tag}: board moved ${fmt(m0.board)} -> ${fmt(m.board)}`);
    check(same(m.title, m0.title), `${tag}: title moved ${fmt(m0.title)} -> ${fmt(m.title)}`);
    check(m.scroll && m.scroll[0] === 0 && m.scroll[1] <= m.scroll[2] + 1 && m.docW[0] <= m.docW[1], `${tag}: scrolls ${JSON.stringify([m.scroll, m.docW])}`);
  };
  try {
    // --- ступени 1-4 + закрытие + ошибка
    let page = await newPage(false); await open(page);
    const m0 = await measure(page);
    check(m0.fit, 'no .play-fit class on the playing screen');
    check(m0.actions.b <= m0.tab.t + 0.5 && m0.pad.b <= m0.tab.t + 0.5, `pad/actions under tab bar`);
    stable(m0, m0, 'fresh');
    await openHint(page);
    const dh = [];
    for (let s = 1; s <= 4; s++) {
      if (s > 1) { await q(page, 'hint-more').tap(); await page.waitForTimeout(450); }
      const m = await measure(page);
      if (!m.dock) { bad(`no dock at step ${s}`); break; }
      stable(m, m0, `step ${s}`);
      check(m.dock.b <= m.tab.t + 0.5 && m.dock.t >= m.board.b - 0.5, `step ${s}: dock outside slot (${m.dock.t}..${m.dock.b}; board.b ${m.board.b}; tab ${m.tab.t})`);
      check(m.btnOk && m.nbtn > 0, `step ${s}: dock buttons under tab bar / missing`);
      dh.push(Math.round(m.dock.h));
    }
    await q(page, 'hint-close').tap(); await page.waitForTimeout(500);
    const mc = await measure(page); stable(mc, m0, 'after close');
    // повторное открытие/закрытие 3 раза (дрейф)
    for (let k = 0; k < 3; k++) { await openHint(page); await q(page, 'hint-close').tap(); await page.waitForTimeout(350); }
    stable(await measure(page), m0, 'after 3 open/close');
    // ошибка
    const cells = await page.evaluate(() => [...document.querySelectorAll('.board button.cell')].map((e) => ({ i: +e.dataset.i, d: e.querySelector('.d.given')?.textContent?.trim() ?? '', empty: !e.querySelector('.d') })));
    let target = null;
    for (const e of cells.filter((x) => x.empty)) { const row = cells.filter((x) => Math.floor(x.i / 9) === Math.floor(e.i / 9) && x.d); if (row.length) { target = { i: e.i, d: row[0].d }; break; } }
    await page.locator(`.board button.cell[data-i="${target.i}"]`).tap(); await page.locator('.pad .key').nth(+target.d - 1).tap(); await page.waitForTimeout(400);
    await openHint(page);
    const mm = await measure(page);
    check(mm.kind === 'mistake', `mistake branch not reached (${mm.kind})`);
    stable(mm, m0, 'mistake'); check(mm.btnOk, 'mistake: buttons under tab bar');
    await q(page, 'hint-close').tap(); await page.waitForTimeout(400); stable(await measure(page), m0, 'mistake close');
    await page.close();
    // --- «не нашёл»: сетка без одиночек
    page = await newPage(true); await open(page);
    const h0 = await measure(page);
    await openHint(page);
    const hn = await measure(page);
    check(hn.kind === 'none', `none branch not reached (${hn.kind})`);
    stable(hn, h0, 'none'); check(hn.dock && hn.dock.b <= hn.tab.t + 0.5 && hn.btnOk, 'none: dock/buttons under tab bar');
    await q(page, 'hint-close').tap(); await page.waitForTimeout(400); stable(await measure(page), h0, 'none close');
    await page.close();
    // --- Ink (только Today): строка входа, шит, вход; поле не должно отличаться от обычной партии
    if (ROUTE === 'today') {
      page = await newPage(false); await open(page);
      const i0 = await measure(page);
      const has = await q(page, 'ink-row').count();
      if (!has) bad('no ink-row on a fresh Today');
      else {
        const rb = await q(page, 'ink-row').boundingBox();
        check(rb.y > i0.board.b - 0.5 && rb.y + rb.height <= i0.pad.t + 1 && rb.height >= 43.5, `ink-row not between board and pad / <44: ${JSON.stringify(rb)} board.b=${i0.board.b} pad.t=${i0.pad.t}`);
        await q(page, 'ink-row').tap(); await page.waitForTimeout(600);
        if (await q(page, 'ink-rule-start').count()) { await q(page, 'ink-rule-start').tap(); await page.waitForTimeout(600); }
        const ik = await measure(page); stable(ik, i0, 'ink');
        check(ik.actions.b <= ik.tab.t + 0.5, 'ink: actions under tab bar');
        if (await q(page, 'hint-button').count()) { await openHint(page); stable(await measure(page), i0, 'ink+dock'); }
      }
      await page.close();
    }
    check(errs.length === 0, `page errors: ${errs.join('|')}`);
    table.push([L, `board ${fmt(m0.board)} title@${m0.title?.t}`, dh.join('/')]);
  } catch (e) { bad(`exception: ${e.message.split('\n')[0]}`); } finally { for (const x of ctxs) await x.close().catch(() => {}); }
}
for (const engine of ENGINES) {
  const list = picked.filter((c) => c.engine === engine); if (!list.length) continue;
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  for (const c of list) await run(browser, c);
  await browser.close();
}
for (const r of table) console.log(r.join(' | '));
console.log(fails.length ? `\nFAILED ${fails.length}` : `\nALL PASS (${table.length} cases)`);
process.exit(fails.length && !soft ? 1 : 0);
