// QA PD-150 — resume: перезагрузка посреди партии (Today / архив / Play / Ink). Ожидание: выбрана первая пустая клетка
// (Play: сохранённая, если ещё пуста), пустых нет -> ничего не выбрано; тап по цифре ставит, повторный по той же не стирает; клавиатура.
// BASE=... ENGINES=webkit,chromium node qa-resume.mjs [filter]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const PROFILE = JSON.parse(readFileSync(process.env.PROFILE ?? '/tmp/qa-todayfix/state-vet.json', 'utf8'));
const { RESTORE } = await import(pathToFileURL(new URL('./lib-qa.mjs', import.meta.url).pathname).href);
const { webkit, chromium } = createRequire('/tmp/pundoku-ios/pw/')('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3992';
const WT = process.env.WT ?? '/Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku-worktrees/pd-today-fix-qa';
const engine = await import(pathToFileURL(`${WT}/packages/engine/dist/index.js`).href);
const ENGINES = (process.env.ENGINES ?? 'webkit').split(',');
const filter = process.argv[2] ?? '';
const fails = []; const pass = [];
const cells = (page) => page.evaluate(() => [...document.querySelectorAll('.board button.cell')].map((e) => ({ i: +e.dataset.i, given: !!e.querySelector('.d.given'), d: e.querySelector('.d')?.textContent?.trim() ?? '', sel: e.getAttribute('aria-current') === 'true' })).sort((a, b) => a.i - b.i));
const solution = async (page) => { const cs = await cells(page); const puz = cs.map((c) => (c.given ? c.d : '0')).join(''); const s = engine.solve(puz); const str = typeof s === 'string' ? s : (s?.solution ?? s?.grid ?? s); return Array.isArray(str) ? str.join('') : String(str); };
const cell = (page, i) => page.locator(`.board button.cell[data-i="${i}"]`);
const key = (page, d) => page.locator('.pad .key').nth(d - 1);
async function withCtx(eng, fn, opts = {}) {
  const browser = await (eng === 'webkit' ? webkit : chromium).launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: eng === 'webkit', hasTouch: true, locale: 'en-US', timezoneId: 'UTC', ...(opts.vet ? { storageState: PROFILE.ls } : {}) });
  if (opts.vet) { const p0 = await ctx.newPage(); await p0.goto(BASE + '/health'); await p0.evaluate(RESTORE, PROFILE.idb); await p0.close(); }
  await ctx.route('**/api/devices', (r) => r.fulfill({ status: 503, body: '{}' })); // без регистрации устройства — sync не при чём
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try { await fn(page, errs); } finally { await browser.close(); }
}
const mk = (eng, name) => { const L = `${eng} ${name}`; const ok = (c, m) => { if (c) pass.push(`${L}: ${m}`); else { fails.push(`${L}: ${m}`); console.log(`FAIL ${L}: ${m}`); } }; return ok; };
async function startToday(page, route = 'today') { await page.goto(BASE + '/#/' + route); await page.waitForSelector('.board button.cell', { timeout: 45000 }); await page.waitForTimeout(800); }
async function reload(page, play) { await page.reload(); if (play) { await page.locator('[data-testid="continue-own"]').waitFor({ timeout: 45000 }); await page.waitForTimeout(500); await page.locator('[data-testid="continue-own"]').tap(); } await page.waitForSelector('.board button.cell', { timeout: 45000 }); await page.waitForTimeout(1500); }
const firstEmpty = (cs) => cs.find((c) => !c.d)?.i ?? null;
const selected = (cs) => cs.filter((c) => c.sel).map((c) => c.i);
async function fill(page, sol, idxs) { for (const i of idxs) { await cell(page, i).tap(); await key(page, +sol[i]).tap(); } await page.waitForTimeout(300); }

for (const eng of ENGINES) {
  for (const route of ['today', 'day/2026-09-27']) {
    const name = route === 'today' ? 'Today' : 'archive';
    if (filter && !`${eng} ${name}`.includes(filter)) continue;
    const ok = mk(eng, name);
    await withCtx(eng, async (page, errs) => {
      await startToday(page, route);
      let cs = await cells(page); const sol = await solution(page);
      const empties = cs.filter((c) => !c.d).map((c) => c.i);
      ok(selected(cs).length <= 1, 'fresh: at most one selected');
      // 1) ходы: первые 3 пустых + одна дальняя; курсор оставляем на пустой не-первой клетке
      await fill(page, sol, [...empties.slice(0, 3), empties[40]]);
      await cell(page, empties[10]).tap(); await page.waitForTimeout(300);
      await reload(page, false);
      cs = await cells(page);
      ok(selected(cs).length === 1 && selected(cs)[0] === firstEmpty(cs), `after reload selected=${JSON.stringify(selected(cs))}, first empty=${firstEmpty(cs)} (expected 4th empty ${empties[3]})`);
      ok(firstEmpty(cs) === empties[3], `moves survived (first empty ${firstEmpty(cs)} vs ${empties[3]})`);
      // 2) тап по цифре: ставит; тот же — не стирает; другая — заменяет
      const t = firstEmpty(cs);
      await key(page, +sol[t]).tap(); await page.waitForTimeout(300);
      cs = await cells(page); ok(cs[t].d === sol[t], 'one tap places the digit');
      await key(page, +sol[t]).tap(); await page.waitForTimeout(300);
      cs = await cells(page); ok(cs[t].d === sol[t], 'second tap on the same digit does NOT erase (PD-115)');
      const other = (+sol[t] % 9) + 1; await key(page, other).tap(); await page.waitForTimeout(300);
      cs = await cells(page); ok(cs[t].d === String(other), 'tap on another digit replaces');
      // 3) клавиатура после resume: фокус на выбранной клетке -> цифра/Backspace/стрелки
      await reload(page, false);
      cs = await cells(page); const t2 = firstEmpty(cs); ok(selected(cs)[0] === t2, `keyboard case: selection ${selected(cs)} = first empty ${t2}`);
      await cell(page, t2).focus(); await page.keyboard.press('Digit' + sol[t2]); await page.waitForTimeout(300);
      cs = await cells(page); ok(cs[t2].d === sol[t2], 'keyboard digit places into the resumed cell');
      await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
      cs = await cells(page); ok(cs[t2].d === '', 'Backspace erases it');
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
      cs = await cells(page); ok(t2 % 9 === 8 ? selected(cs)[0] === t2 : (selected(cs)[0] > t2 && selected(cs)[0] <= t2 + 8 - (t2 % 9)), `ArrowRight moves selection from ${t2} (${selected(cs)})`);
      // 4) все пустые заполнены, но не решено -> ничего не выбрано (меняем две клетки в строке местами -> сетка полная, неверная)
      await reload(page, false);
      cs = await cells(page); const rest = cs.filter((c) => !c.d).map((c) => c.i);
      const [a, b] = (() => { for (const x of rest) for (const y of rest) if (x < y && Math.floor(x / 9) === Math.floor(y / 9) && sol[x] !== sol[y]) return [x, y]; return [null, null]; })();
      const normal = rest.filter((i) => i !== a && i !== b);
      await fill(page, sol, normal);
      await cell(page, a).tap(); await key(page, +sol[b]).tap(); await cell(page, b).tap(); await key(page, +sol[a]).tap(); await page.waitForTimeout(500);
      cs = await cells(page);
      const full = cs.every((c) => c.d);
      ok(full, 'grid full (swapped pair) and not solved screen');
      const solved = await page.locator('.card, [data-testid="result-card"]').count();
      await reload(page, false);
      cs = await cells(page);
      if (full && !solved) ok(selected(cs).length === 0, `full unsolved grid: nothing selected after reload (${JSON.stringify(selected(cs))})`);
      else ok(true, `info: full=${full} solvedCard=${solved} (selection ${JSON.stringify(selected(cs))})`);
      ok(errs.length === 0, `no page errors ${errs.join('|')}`);
    }, { vet: route !== 'today' });
  }
  // Ink на Today
  if (!filter || `${eng} Ink`.includes(filter)) {
    const ok = mk(eng, 'Today-Ink');
    await withCtx(eng, async (page, errs) => {
      await startToday(page);
      let cs = await cells(page); const sol = await solution(page); const empties = cs.filter((c) => !c.d).map((c) => c.i);
      await page.locator('[data-testid="ink-row"]').tap(); await page.waitForTimeout(500);
      if (await page.locator('[data-testid="ink-rule-start"]').count()) await page.locator('[data-testid="ink-rule-start"]').tap();
      await page.waitForTimeout(500);
      await fill(page, sol, empties.slice(0, 4));
      await cell(page, empties[12]).tap(); await page.waitForTimeout(300);
      await reload(page, false);
      cs = await cells(page);
      ok(selected(cs).length === 1 && selected(cs)[0] === firstEmpty(cs) && firstEmpty(cs) === empties[4], `Ink after reload selected=${JSON.stringify(selected(cs))}, first empty=${firstEmpty(cs)}, expected ${empties[4]}`);
      const t = firstEmpty(cs); await key(page, +sol[t]).tap(); await page.waitForTimeout(300); cs = await cells(page); ok(cs[t].d === sol[t], 'Ink: one tap places');
      await key(page, +sol[t]).tap(); await page.waitForTimeout(300); cs = await cells(page); ok(cs[t].d === sol[t], 'Ink: same digit tapped twice stays');
      ok(errs.length === 0, `no page errors ${errs.join('|')}`);
    });
  }
  // Play
  if (!filter || `${eng} Play`.includes(filter)) {
    const ok = mk(eng, 'Play');
    await withCtx(eng, async (page, errs) => {
      await page.goto(BASE + '/#/play'); await page.locator('[data-testid="setup-start"]').waitFor({ timeout: 45000 }); await page.waitForTimeout(600);
      await page.locator('[data-testid="setup-start"]').tap();
      await page.waitForSelector('.board:not(.idle) button.cell', { timeout: 60000 }); await page.waitForTimeout(600);
      let cs = await cells(page); const sol = await solution(page); const empties = cs.filter((c) => !c.d).map((c) => c.i);
      await fill(page, sol, empties.slice(0, 3));
      // (a) заметка в пустой не-первой клетке (клетка остаётся пустой, ход записан) -> курсор там же
      await cell(page, empties[10]).tap(); await key(page, 3).tap(); await page.waitForTimeout(200); await cell(page, empties[10]).focus(); await page.keyboard.press('Backspace'); await page.waitForTimeout(500);
      cs = await cells(page); ok(cs[empties[10]].d === '' && selected(cs)[0] === empties[10], 'precond: digit placed and erased, cell empty and selected');
      await reload(page, true); cs = await cells(page);
      ok(selected(cs).length === 1 && selected(cs)[0] === empties[10], `Play: cursor kept on empty (erased) cell ${empties[10]} (selected ${JSON.stringify(selected(cs))})`);
      // (a2) только выбор клетки, без хода (сохранение — на pagehide); баллы информационные: то же поведение у baseline
      await cell(page, empties[20]).tap(); await page.waitForTimeout(500);
      await reload(page, true); cs = await cells(page);
      console.log(`INFO ${eng} Play: select-only (no move) cursor ${empties[20]} -> after reload selected ${JSON.stringify(selected(cs))}`);
      // (b) курсор на заполненной -> первая пустая
      await fill(page, sol, [empties[11]]); await page.waitForTimeout(400); cs = await cells(page); console.log('DBG after fill', empties[11], JSON.stringify(cs[empties[11]]), 'sel', JSON.stringify(selected(cs)));
      await reload(page, true); cs = await cells(page);
      ok(selected(cs).length === 1 && selected(cs)[0] === empties[3], `Play: cursor on filled cell -> first empty ${empties[3]} (selected ${JSON.stringify(selected(cs))})`);
      console.log('DBG', eng, 'empties', JSON.stringify(empties.slice(0,12)), 'now empty', JSON.stringify(cs.filter((c) => !c.d).map((c) => c.i).slice(0,12)), 'sel', JSON.stringify(selected(cs)));
      const t = selected(cs)[0]; await key(page, +sol[t]).tap(); await page.waitForTimeout(250); await key(page, +sol[t]).tap(); await page.waitForTimeout(300);
      cs = await cells(page); ok(cs[t].d === sol[t], 'Play: digit placed, repeat does not erase');
      // (c) заметки не отменяют пустоту: включить Notes, поставить заметку в первую пустую -> после reload она всё равно «первая пустая»
      ok(errs.length === 0, `no page errors ${errs.join('|')}`);
    });
  }
}
console.log(`\nPASS checks: ${pass.length}`); console.log(fails.length ? `FAILED ${fails.length}\n` + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
