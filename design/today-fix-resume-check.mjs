// PD-147 (c)+(d) — live check, Today and Play, webkit + chromium.
//   (c) reload mid-game: the FIRST EMPTY cell is selected (uniform for Today and Play); one tap places a digit; a second tap on the
//       same digit does NOT erase it (PD-115).
//   (d) clean profile: no 404 `GET /api/snapshot` (no console error, no request at all on the very first start); the second start
//       (device token exists) DOES pull the snapshot, and moves made on the first start are pushed (restore sync is intact).
//
//   cd /tmp/pundoku-ios/pw && BASE=http://127.0.0.1:3991 node <repo>/design/today-fix-resume-check.mjs [engine]
import { createRequire } from 'node:module';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');

const BASE = process.env.BASE ?? 'http://127.0.0.1:3991';
const only = process.argv[2];
const fails = [];
const log = (s) => console.log(s);

const cellsOf = (page) => page.evaluate(() => [...document.querySelectorAll('.board button.cell')].map((e) => ({
  i: +e.dataset.i, empty: !e.querySelector('.d'), d: e.querySelector('.d')?.textContent?.trim() ?? '', sel: e.getAttribute('aria-current') === 'true',
})).sort((a, b) => a.i - b.i));

async function run(engine, route) {
  const L = `${engine} ${route}`;
  const bad = (m) => { fails.push(`${L}: ${m}`); log(`FAIL  ${L}: ${m}`); };
  const check = (c, m) => { if (!c) bad(m); };
  const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'webkit' && process.env.PW_WEBKIT_EXEC ? { executablePath: process.env.PW_WEBKIT_EXEC } : {});
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: engine === 'webkit', hasTouch: true, locale: 'en-US' });
  const snap = [];
  const errs = [];
  const watch = (page) => {
    page.on('response', (r) => { if (r.url().includes('/api/snapshot')) snap.push(`${r.request().method()} ${r.status()}`); });
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  };
  const page = await ctx.newPage();
  watch(page);
  const q = (id) => page.locator(`[data-testid="${id}"]`);
  try {
    await page.goto(BASE + '/#/' + route);
    if (route === 'play') { await page.waitForTimeout(1200); await q('setup-start').tap(); await page.waitForSelector('.board:not(.idle)', { timeout: 40000 }); }
    await page.waitForSelector('.board button.cell', { timeout: 40000 });
    await page.waitForTimeout(2500);
    // (d) first start on a clean profile
    const e404 = errs.filter((e) => /404|snapshot/i.test(e));
    check(e404.length === 0, `console errors mentioning 404/snapshot: ${JSON.stringify(e404)}`);
    check(!snap.some((s) => s.endsWith(' 404')), `404 on /api/snapshot: ${JSON.stringify(snap)}`);
    log(`${L}: first start, snapshot requests: ${JSON.stringify(snap)}, console errors: ${errs.length}`);
    // make a move in the first empty cell
    let cells = await cellsOf(page);
    const e1 = cells.find((c) => c.empty);
    await page.locator(`.board button.cell[data-i="${e1.i}"]`).tap();
    await page.locator('.pad .key').nth(0).tap();
    await page.waitForTimeout(2500); // persist + push
    cells = await cellsOf(page);
    check(cells.find((c) => c.i === e1.i).d === '1', 'the first move was not placed');
    const afterMove = snap.length;
    // reload mid-game
    await page.reload();
    if (route === 'play') { await q('continue-own').waitFor({ timeout: 40000 }); await page.waitForTimeout(1500); await q('continue-own').tap(); }
    await page.waitForSelector('.board button.cell', { timeout: 40000 });
    await page.waitForTimeout(2500);
    cells = await cellsOf(page);
    const firstEmpty = cells.find((c) => c.empty);
    const selected = cells.filter((c) => c.sel);
    log(`${L}: after reload first empty = ${firstEmpty?.i}, selected = ${JSON.stringify(selected.map((c) => c.i))}, snapshot requests: ${JSON.stringify(snap.slice(afterMove))}`);
    check(selected.length === 1 && selected[0].i === firstEmpty.i, `resume selection: expected first empty ${firstEmpty?.i}, got ${JSON.stringify(selected.map((c) => c.i))}`);
    check(cells.find((c) => c.i === e1.i).d === '1', 'the move did not survive the reload');
    // second start, token exists: the snapshot is pulled (restore sync is intact)
    // Play-only profile never pushes (an own game is not part of the snapshot): its second start legitimately gets GET 404 (nothing on the server yet),
    // that case is NOT removable safely (a lost local sync state after a successful push, PD-126) — so the pull/push checks are for Today.
    if (route === 'today') check(snap.slice(afterMove).some((s) => s.startsWith('GET ') && s.endsWith(' 200')), `second start did not pull the snapshot: ${JSON.stringify(snap.slice(afterMove))}`);
    if (route === 'today') check(snap.some((s) => s.startsWith('PUT ') || s.startsWith('POST ')), `no push of the snapshot at all: ${JSON.stringify(snap)}`);
    // one tap places, the same digit twice does not erase (PD-115)
    await page.locator('.pad .key').nth(4).tap(); await page.waitForTimeout(300);
    cells = await cellsOf(page);
    check(cells.find((c) => c.i === firstEmpty.i).d === '5', 'one tap on the pad did not place the digit into the selected cell');
    await page.locator('.pad .key').nth(4).tap(); await page.waitForTimeout(300);
    cells = await cellsOf(page);
    check(cells.find((c) => c.i === firstEmpty.i).d === '5', 'the same digit twice erased the cell (PD-115)');
    // no empties -> nothing is selected is covered by unit tests (resumeSelection)
    check(!errs.some((e) => /pageerror/.test(e)), `page errors: ${errs.join('|')}`);
    if (!fails.some((f) => f.startsWith(L))) log(`PASS  ${L}`);
  } catch (e) {
    bad(`exception: ${e.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

for (const engine of ['webkit', 'chromium']) {
  if (only && only !== engine) continue;
  for (const route of ['today', 'play']) await run(engine, route);
}
log(fails.length ? `\nFAILED ${fails.length}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
