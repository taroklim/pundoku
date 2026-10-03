// Play-only профиль: сколько GET /api/snapshot и какие статусы на 1-м и 2-м запуске (известный остаток из отчёта developer)
import { pathToFileURL } from 'node:url';
const L = await import(pathToFileURL(new URL('../../../docs/ios-selfcheck/lib.mjs', import.meta.url).pathname).href);
const { webkit } = (await import('node:module')).createRequire('/tmp/pundoku-ios/pw/')('playwright');
const b = await webkit.launch(); const ctx = await L.newContext(b, { extra: { timezoneId: 'UTC' } }); const p = await ctx.newPage();
const log = []; p.on('response', (r) => { if (r.url().includes('/api/')) log.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
await p.goto(L.BASE + '/#/play'); await p.waitForTimeout(6000); console.log('launch1', log.splice(0));
await p.reload(); await p.waitForTimeout(6000); console.log('launch2', log.splice(0));
await p.reload(); await p.waitForTimeout(4000); console.log('launch3', log.splice(0));
await b.close();
