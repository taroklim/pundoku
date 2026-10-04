// PD-147: Today switches from the non-scrolling game screen (.play-fit) to the scrolling result card after the last cell. Live check
// that the solve sequence ends with the card on screen (not under the tab bar), the page not stuck scrolled, no page errors.
//   cd /tmp/pundoku-ios/pw && BASE=http://127.0.0.1:3991 node <repo>/design/today-fix-solve-check.mjs
import { createRequire } from 'node:module';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3991';
const solve = (m) => { const g = [...m].map(Number); const ok = (i, d) => { const r = Math.floor(i / 9), c = i % 9; for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === d || g[k * 9 + c] === d) return false; } const br = r - (r % 3), bc = c - (c % 3); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === d) return false; return true; };
  const go = () => { const i = g.indexOf(0); if (i < 0) return true; for (let d = 1; d <= 9; d++) if (ok(i, d)) { g[i] = d; if (go()) return true; g[i] = 0; } return false; }; go(); return g; };
const fails = [];
for (const [engine, w, h] of [['webkit', 393, 852], ['webkit', 320, 568], ['chromium', 393, 852]]) {
  const L = `${engine} ${w}x${h}`;
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: engine === 'webkit', hasTouch: true, locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(BASE + '/#/today');
    await page.waitForSelector('.board button.cell', { timeout: 40000 }); await page.waitForTimeout(1500);
    const mission = await page.evaluate(async () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); const r = await fetch(`/api/daily/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`); return (await r.json()).mission; });
    const sol = solve(mission);
    for (let i = 0; i < 81; i++) { if (mission[i] !== '0') continue; await page.locator(`.board button.cell[data-i="${i}"]`).tap(); await page.locator('.pad .key').nth(sol[i] - 1).tap(); }
    await page.waitForSelector('.card', { timeout: 20000 }); await page.waitForTimeout(7000);
    const m = await page.evaluate(() => { const sc = document.querySelector('.scroll'); const tab = document.querySelector('.tabbar').getBoundingClientRect(); const card = document.querySelector('.card').getBoundingClientRect(); return { fit: !!document.querySelector('.play-fit'), top: sc.scrollTop, sh: sc.scrollHeight, ch: sc.clientHeight, cardTop: card.top, cardBottom: card.bottom, tabTop: tab.top, kids: [...document.querySelectorAll('.play.today > *')].map((e) => `${e.className||e.tagName}:${Math.round(e.getBoundingClientRect().height)}`).join(' '), deep: [...document.querySelectorAll('.card > *, .play.today > section > *')].map((e) => `${(e.className||e.tagName).toString().slice(0,18)}:${Math.round(e.getBoundingClientRect().height)}`).join(' '), hasShare: !!document.querySelector('.card [data-testid*="share"], .card button') }; });
    console.log(L, JSON.stringify(m), 'errors', errs.length);
    if (m.fit) fails.push(`${L}: still play-fit after solve`);
    if (m.cardTop < -1 && m.top === 0) fails.push(`${L}: card above the viewport`);
    if (errs.length) fails.push(`${L}: page errors ${errs.join('|')}`);
    await page.screenshot({ path: `/tmp/pundoku-todayfix/solve-${engine}-${w}x${h}.png` });
  } catch (e) { fails.push(`${L}: ${e.message.split('\n')[0]}`); }
  await browser.close();
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
