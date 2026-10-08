import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { webkit } = createRequire('/tmp/pundoku-ios/pw/')('playwright');
const PROFILE = JSON.parse(readFileSync('/tmp/qa-todayfix/state-vet.json', 'utf8'));
const { seedIdb } = await import(pathToFileURL(new URL('./lib-qa.mjs', import.meta.url).pathname).href);
const BASE = process.env.BASE; const OUT = process.env.OUT; const W = +(process.env.W ?? 393), H = +(process.env.H ?? 852);
const b = await webkit.launch();
for (const route of ['today', 'day/2026-09-27']) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'UTC', storageState: PROFILE.ls });
  await seedIdb(ctx, PROFILE.idb, BASE); // PD-217: посев на странице без приложения (не /health)
  await ctx.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = 'html{font-size:40px !important}'; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); });
  const p = await ctx.newPage(); await p.goto(BASE + '/#/' + route); await p.waitForSelector('.board button.cell', { timeout: 30000 }); await p.waitForTimeout(1200);
  const m = await p.evaluate(() => [...document.querySelectorAll('.play .subline *, .play .source, .play .sub-diff, .play .title')].map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return `${e.className || e.tagName}|${Math.round(e.scrollWidth)}/${Math.round(e.clientWidth)}|vis=${r.width > 2 && s.visibility !== 'hidden' && s.display !== 'none'}|ov=${s.overflow}|to=${s.textOverflow}|${(e.textContent || '').slice(0, 40)}`; }));
  console.log(route, '\n ' + m.join('\n ')); await p.screenshot({ path: `${OUT}-${route.replace('/', '_')}.png` }); await ctx.close();
}
await b.close();
