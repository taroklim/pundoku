// PD-144 — live scenarios on the real app: two independent slots, reload in the middle of both games,
// reselect of the active tab, "⋯" menu + Fill + Undo, Ink, reduced motion.
//   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers BASE=http://localhost:3991 node <repo>/design/pd144-live-scenarios.mjs
import { createRequire } from 'node:module';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');
const BASE = process.env.BASE ?? 'http://localhost:3991';
const results = [];
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

const run = async (eng, label, rm) => {
  const b = await eng.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', reducedMotion: rm ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const q = (id) => page.locator(`[data-testid="${id}"]`);
  const has = async (id) => (await q(id).count()) > 0;
  const tab = (id) => page.locator(`#tab-${id}`).tap();
  const move = async () => {
    await page.locator('.board button.cell[aria-label$="empty"]').first().tap();
    await page.locator('.pad button').first().tap();
    await page.waitForTimeout(200);
  };
  const left = async () => (await page.locator('[data-testid="status-line"] .st-long').first().textContent()) ?? '';

  await page.goto(BASE + '/#/today');
  await page.waitForSelector('.board:not(.idle)', { timeout: 30000 });
  await move();
  ok(`${label}: ход на Today сделан`, true);
  await tab('play');
  await page.waitForTimeout(400);
  ok(`${label}: хаб, слот дня виден, слота своей сетки нет`, (await has('hub-scroll')) && (await has('continue-day')) && !(await has('continue-own')));
  await q('setup-start').tap();
  await page.waitForSelector('.board:not(.idle)', { timeout: 30000 });
  await move();
  const own = await left();
  await tab('play'); // reselect
  await page.waitForTimeout(400);
  ok(`${label}: повторный тап по Play -> хаб без подтверждения`, (await has('hub-scroll')) && (await page.locator('[role=dialog]').count()) === 0);
  ok(`${label}: оба слота независимо`, (await has('continue-day')) && (await has('continue-own')), await q('continue-own').textContent());

  await page.reload();
  await page.waitForTimeout(1500);
  ok(`${label}: после перезагрузки хаб, оба слота на месте`, (await has('hub-scroll')) && (await has('continue-day')) && (await has('continue-own')));
  await q('continue-own').tap();
  await page.waitForSelector('.board:not(.idle)', { timeout: 20000 });
  ok(`${label}: своя сетка продолжена с тем же остатком`, (await left()) === own, `${own} / ${await left()}`);
  await tab('today');
  await page.waitForSelector('.board:not(.idle)', { timeout: 20000 });
  ok(`${label}: Today жив и тоже с ходом`, (await page.locator('.board button.cell').count()) === 81);

  await tab('play');
  await page.waitForTimeout(400);
  ok(`${label}: смена вкладки не уводит с доски Play (хаб — только по повторному тапу)`, !(await has('hub-scroll')));
  await tab('play');
  await page.waitForTimeout(400);
  await q('continue-day').tap();
  await page.waitForTimeout(600);
  ok(`${label}: слот дня ведёт на вкладку Today`, (await page.locator('#tab-today[aria-selected="true"]').count()) === 1);

  await tab('play'); await page.waitForTimeout(300);
  if (!(await has('hub-scroll'))) await tab('play');
  await page.waitForTimeout(300);
  await q('continue-own').tap(); await page.waitForSelector('.board:not(.idle)');
  const before = await left();
  await q('more-button').tap();
  ok(`${label}: меню «⋯»: фокус на первом пункте`, await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'menu-new'));
  await page.keyboard.press('ArrowDown');
  ok(`${label}: ↓ -> Fill`, await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'menu-fill'));
  await page.keyboard.press('Escape');
  ok(`${label}: Esc возвращает фокус на «⋯»`, await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'more-button'));
  await q('more-button').tap(); await q('menu-fill').tap(); await page.waitForTimeout(300);
  const marks = await page.locator('.marks span').count();
  ok(`${label}: Fill без подтверждения заполняет заметки`, marks > 0 && !(await has('more-menu')), `marks=${marks}`);
  await page.locator('button[aria-label="Undo"]').tap(); await page.waitForTimeout(300);
  ok(`${label}: одна запись Undo откатывает Fill`, (await page.locator('.marks span').count()) === 0 && (await left()) === before);

  await q('more-button').tap(); await q('menu-new').tap(); await page.waitForTimeout(400);
  ok(`${label}: «New puzzle» без подтверждения -> хаб`, await has('hub-scroll'));
  await q('setup-start').tap(); await page.waitForTimeout(300);
  ok(`${label}: «Начать» при своей сетке спрашивает «Отбросить»`, (await page.locator('[role=dialog]').count()) === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  await q('mode-row').tap(); await q('mode-ink').tap();
  ok(`${label}: Ink -> шит правила PD-74 поверх`, (await page.locator('[data-testid="ink-rule-start"]').count()) === 1);
  await q('ink-rule-start').tap(); await page.waitForTimeout(300); await q('mode-done').tap(); await page.waitForTimeout(300);
  ok(`${label}: строка «Режим» показывает Ink`, /ink/i.test((await q('mode-value').textContent()) ?? ''));
  await q('setup-start').tap(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Discard', exact: true }).tap();
  await page.waitForSelector('.board:not(.idle)', { timeout: 30000 });
  await page.waitForTimeout(500);
  ok(`${label}: чип Ink в подшапке новой партии`, (await page.locator('[data-testid="ink-chip"]').count()) > 0);
  await q('more-button').tap();
  ok(`${label}: Ink — «Fill» на месте, aria-disabled=true`, (await q('menu-fill').getAttribute('aria-disabled')) === 'true');
  await q('menu-fill').tap({ force: true });
  ok(`${label}: тап по недоступному — меню остаётся`, await has('more-menu'));
  ok(`${label}: нет ошибок страницы`, errs.length === 0, errs.join('|'));
  await b.close();
};

await run(chromium, 'chromium');
await run(chromium, 'chromium-rm', true);
await run(webkit, 'webkit');
console.log(results.every(Boolean) ? 'ALL PASS' : `FAILED ${results.filter((r) => !r).length}`);
