import { createRequire } from 'node:module';
const { webkit } = createRequire('/tmp/pundoku-ios/pw/')('playwright');
const BASE = process.env.BASE; const OUT = process.env.OUT;
const b = await webkit.launch();
for (const route of ['today', 'play']) {
  const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'UTC' });
  const p = await ctx.newPage(); await p.goto(BASE + '/#/' + route);
  if (route === 'play') { await p.waitForSelector('[data-testid=setup-start]', { timeout: 30000 }); await p.locator('[data-testid=setup-start]').tap(); }
  await p.waitForSelector('.board button.cell', { timeout: 30000 }); await p.waitForTimeout(1000);
  const m = await p.evaluate(() => { const sc = document.querySelector('.scroll'); const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.top)}..${Math.round(r.bottom)}`; }; return { fit: !!document.querySelector('.play-fit'), scroll: sc ? [sc.scrollTop, sc.scrollHeight, sc.clientHeight, getComputedStyle(sc).overflowY] : null, board: R('.board'), pad: R('.pad'), actions: R('.actions'), tab: R('.tabbar'), inner: innerHeight, ovf: getComputedStyle(document.querySelector('.play')).overflowY }; });
  console.log(route, JSON.stringify(m)); await p.screenshot({ path: `${OUT}-${route}.png` }); await ctx.close();
}
await b.close();
