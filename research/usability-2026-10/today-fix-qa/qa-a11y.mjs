// QA PD-150 — a11y дока подсказки на Today и регресс Play (хаб/док PD-144). webkit 393x852.
// BASE=... node qa-a11y.mjs
import { createRequire } from 'node:module';
const { webkit } = createRequire('/tmp/pundoku-ios/pw/')('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3992';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const info = (m) => console.log(`   info: ${m}`);
const q = (p, id) => p.locator(`[data-testid="${id}"]`);
const browser = await webkit.launch();
const mk = async (extra = {}) => { const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'UTC', ...extra }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); return { ctx, p, errs }; };
const bb = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.top, b.left, b.width, b.height].map((x) => +x.toFixed(1)).join(','); }, s);
const waitBoard = async (p) => { await p.waitForSelector('.board button.cell', { timeout: 40000 }); await p.waitForTimeout(900); };

// ---- Today ----
{
  const { ctx, p, errs } = await mk(); await p.goto(BASE + '/#/today'); await waitBoard(p);
  const lamp = q(p, 'hint-button');
  const a = await lamp.evaluate((e) => ({ label: e.getAttribute('aria-label'), exp: e.getAttribute('aria-expanded'), ctl: e.getAttribute('aria-controls'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
  ok(!!a.label && a.exp === 'false' && !a.ctl, `лампочка закрыта: aria-label="${a.label}", aria-expanded=false, без aria-controls`);
  ok(a.w >= 44 && a.h >= 44, `лампочка ${a.w}x${a.h} >= 44pt`);
  const board0 = await bb(p, '.board'); const title0 = await bb(p, '.play .title');
  await lamp.tap(); await p.waitForTimeout(500); if (await q(p, 'hint-rule-go').count()) { await q(p, 'hint-rule-go').tap(); await p.waitForTimeout(700); }
  const d = await p.evaluate(() => { const dock = document.querySelector('[data-testid="hint-dock"]'); const btn = document.querySelector('[data-testid="hint-button"]'); const fo = [...document.querySelectorAll('button,a,input,[tabindex]')].filter((e) => e.getClientRects().length && e.tabIndex >= 0).map((e) => e.dataset.testid || e.className || e.tagName); const ae = document.activeElement; const live = dock?.querySelector('[role=status]'); return { role: dock?.getAttribute('role'), label: dock?.getAttribute('aria-label'), id: dock?.id, exp: btn?.getAttribute('aria-expanded'), ctl: btn?.getAttribute('aria-controls'), focus: ae?.tagName + (ae?.className ? '.' + ae.className : ''), focusIn: dock?.contains(ae), live: live?.getAttribute('aria-live'), atomic: live?.getAttribute('aria-atomic'), stepHidden: dock?.querySelector('[data-testid=hint-step]')?.getAttribute('aria-hidden'), padPresent: !!document.querySelector('.pad'), order: fo }; });
  ok(d.role === 'group' && !!d.label, `док: role=group, aria-label="${d.label}"`);
  ok(d.exp === 'true' && d.ctl === d.id && !!d.id, `лампочка: aria-expanded=true, aria-controls=${d.ctl} -> id дока ${d.id}`);
  ok(d.focusIn, `фокус при открытии внутри дока (${d.focus})`);
  ok(d.live === 'polite' && d.atomic === 'true' && d.stepHidden === 'true', `live-регион polite/atomic, видимый счётчик aria-hidden`);
  info(`порядок фокуса при открытом доке: ${d.order.join(' > ')}`);
  const iDock = d.order.findIndex((x) => /hint-/.test(x) && x !== 'hint-button'); const iTab = d.order.findIndex((x) => /tab/.test(String(x)));
  ok(iDock >= 0 && (iTab < 0 || iDock < iTab), 'кнопки дока в порядке фокуса до таб-бара (VoiceOver: после доски/лампочки, до вкладок)');
  const board1 = await bb(p, '.board'); const title1 = await bb(p, '.play .title');
  ok(board1 === board0 && title1 === title0, `bbox доски/заголовка не менялись (${board0} -> ${board1})`);
  // Tab/Enter внутри дока
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  const f2 = await p.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName); info(`после 2xTab фокус: ${f2}`);
  await q(p, 'hint-close').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const af = await p.evaluate(() => ({ dock: !!document.querySelector('[data-testid=hint-dock]'), ae: document.activeElement?.dataset.testid ?? document.activeElement?.tagName, exp: document.querySelector('[data-testid=hint-button]')?.getAttribute('aria-expanded'), pad: !!document.querySelector('.pad') }));
  ok(!af.dock && af.exp === 'false' && af.pad, `Enter на «Закрыть»: док закрыт, панель вернулась`);
  info(`фокус после закрытия с клавиатуры: ${af.ae} (ожидается hint-button, чтобы фокус не терялся в body)`);
  ok(af.ae === 'hint-button', 'фокус возвращается на лампочку');
  // Escape
  await lamp.tap(); await p.waitForTimeout(500); if (await q(p, 'hint-rule-go').count()) { await q(p, 'hint-rule-go').tap(); await p.waitForTimeout(500); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); info(`Escape закрывает док: ${!(await q(p, 'hint-dock').count())}`);
  ok(errs.length === 0, `ошибок консоли нет (${JSON.stringify(errs)})`);
  await ctx.close();
}
// ---- reduced motion ----
{
  const { ctx, p } = await mk({ reducedMotion: 'reduce' }); await p.goto(BASE + '/#/today'); await waitBoard(p);
  await q(p, 'hint-button').tap(); await p.waitForTimeout(450); if (await q(p, 'hint-rule-go').count()) { await q(p, 'hint-rule-go').tap(); await p.waitForTimeout(500); }
  const m = await p.evaluate(() => [...document.querySelectorAll('[data-testid="hint-dock"], [data-testid="hint-dock"] *')].map((e) => { const s = getComputedStyle(e); return { n: e.dataset.testid || e.tagName, a: s.animationName, ad: s.animationDuration, t: s.transitionProperty, td: s.transitionDuration }; }).filter((x) => x.a !== 'none' || !/^0s(, 0s)*$/.test(x.td)));
  const moving = m.filter((x) => x.a !== 'none' && !/^0s/.test(x.ad));
  info(`reduced-motion: элементов дока с анимацией/переходом: ${JSON.stringify(m).slice(0, 400)}`);
  const trf = m.filter((x) => /transform|top|height|margin/.test(x.t) && !/^0s/.test(x.td));
  ok(trf.length === 0 && moving.every((x) => /fade|cross|opacity/i.test(x.a)), `reduced-motion: нет движения (transform/высота) в доке`);
  await ctx.close();
}
// ---- Play: хаб и док (PD-144) ----
{
  const { ctx, p, errs } = await mk(); await p.goto(BASE + '/#/play'); await p.waitForSelector('[data-testid="hub-scroll"], [data-testid="setup-start"]', { timeout: 40000 }); await p.waitForTimeout(800);
  const hub = await p.evaluate(() => ({ hub: !!document.querySelector('.play.play-hub'), fit: !!document.querySelector('.play-fit'), sc: (() => { const s = document.querySelector('[data-testid=hub-scroll]'); return s ? [s.scrollHeight, s.clientHeight] : null; })(), h: document.documentElement.scrollHeight }));
  ok(hub.hub && !hub.fit, `Play-хаб: .play-hub, без .play-fit (${JSON.stringify(hub)})`);
  await q(p, 'setup-start').tap(); await waitBoard(p);
  const pf = await p.evaluate(() => ({ fit: !!document.querySelector('.play.play-fit'), hintable: !!document.querySelector('.play.play-hintable') }));
  ok(pf.fit && pf.hintable, `Play в партии: play-fit play-hintable (${JSON.stringify(pf)})`);
  const b0 = await bb(p, '.board'); const t0 = await bb(p, '.play .title') ?? await bb(p, '.play .subline');
  await q(p, 'hint-button').tap(); await p.waitForTimeout(500); if (await q(p, 'hint-rule-go').count()) { await q(p, 'hint-rule-go').tap(); await p.waitForTimeout(600); }
  const open = await q(p, 'hint-dock').count();
  const b1 = await bb(p, '.board'); const t1 = await bb(p, '.play .title') ?? await bb(p, '.play .subline');
  ok(open === 1 && b0 === b1 && t0 === t1, `Play-док: поле/заголовок не сдвигаются (${b0} -> ${b1})`);
  for (let i = 0; i < 3; i++) { if (await q(p, 'hint-more').count()) { await q(p, 'hint-more').tap(); await p.waitForTimeout(350); } }
  ok((await bb(p, '.board')) === b0, 'Play-док: после ступеней поле на месте');
  await q(p, 'hint-close').tap().catch(() => {}); await p.waitForTimeout(400);
  ok((await bb(p, '.board')) === b0, 'Play: после закрытия поле на месте');
  // возврат в хаб: вкладка Play -> «Continue»
  ok(errs.length === 0, `Play: ошибок консоли нет (${JSON.stringify(errs).slice(0, 200)})`);
  await ctx.close();
}
await browser.close();
console.log(fails.length ? `\nFAILED ${fails.length}\n- ${fails.join('\n- ')}` : '\nALL PASS');
