// QA PD-150 — синхронизация (PD-126/142) после ускорения старта.
// BASE=... API=... WT=... node qa-sync.mjs [filter]   (webkit, iPhone 16, UTC)
import { pathToFileURL } from 'node:url';
const L = await import(pathToFileURL(new URL('../../../docs/ios-selfcheck/lib.mjs', import.meta.url).pathname).href);
const S2 = await import(pathToFileURL(new URL('../../../docs/ios-selfcheck/s2-play.mjs', import.meta.url).pathname).href);
const { BASE, API, newContext, gotoApp, fillCorrect, api } = L;
const { deviceToken, waitServer, setVisibility } = S2;
const T = (id) => `[data-testid="${id}"]`;
const SOLVED = /"status":\s*"solved"/;
const filter = process.argv[2] ?? '';
const fails = [];
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const { webkit } = (await import('node:module')).createRequire('/tmp/pundoku-ios/pw/')('playwright');
const browser = await webkit.launch();
const dev = async () => {
  const ctx = await newContext(browser, { extra: { timezoneId: 'UTC' } });
  const page = await ctx.newPage();
  const net = []; const errs = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) net.push({ m: r.method(), u: new URL(r.url()).pathname, t: Date.now() }); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  return { ctx, page, net, errs };
};
const count = (net, m, u) => net.filter((x) => x.m === m && x.u === u).length;
const want = (n) => !filter || n.includes(filter);

if (want('clean')) {
  console.log('--- S1 чистое устройство: нет GET /api/snapshot, нет ошибок ---');
  const d = await dev(); await gotoApp(d.page); await d.page.waitForSelector('.board .cell .d.given', { timeout: 25000 }); await d.page.waitForTimeout(6000);
  ok(count(d.net, 'POST', '/api/devices') === 1, `POST /api/devices ровно 1 (${count(d.net, 'POST', '/api/devices')})`);
  ok(count(d.net, 'GET', '/api/snapshot') === 0, `GET /api/snapshot = ${count(d.net, 'GET', '/api/snapshot')} (ожидалось 0)`);
  ok(count(d.net, 'PUT', '/api/snapshot') <= 1, `PUT на чистом устройстве = ${count(d.net, 'PUT', '/api/snapshot')} (паритет с main: один, только installSeed, days:{})`);
  ok(d.errs.length === 0, `ошибок консоли/HTTP нет (${JSON.stringify(d.errs)})`);
  // решаем -> ушло на сервер; перезагрузка зарегистрированного -> GET 200
  const tok = await deviceToken(d.page); ok(!!tok, 'токен сохранён в IDB');
  await fillCorrect(d.page);
  const sv = await waitServer(tok, SOLVED); ok(sv.ok, `решённый день ушёл на сервер за ${sv.ms} мс`);
  d.net.length = 0;
  await d.page.reload(); await d.page.waitForSelector('.board', { timeout: 25000 }); await d.page.waitForTimeout(4000);
  ok(count(d.net, 'GET', '/api/snapshot') >= 1, `reload зарегистрированного: GET snapshot = ${count(d.net, 'GET', '/api/snapshot')}`);
  ok(count(d.net, 'POST', '/api/devices') === 0, 'reload: повторной регистрации нет');
  ok(d.errs.length === 0, `reload: ошибок нет (${JSON.stringify(d.errs)})`);
  ok(await d.page.locator(T('grid-inf-section')).count() > 0, 'после reload решённый день показывается решённым');
  await d.ctx.close();
}

if (want('hidden')) {
  console.log('--- S2 закрытие вкладки сразу после хода (visibility hidden), debounce 2000 мс ---');
  const d = await dev(); await gotoApp(d.page); await d.page.waitForSelector('.board .cell .d.given', { timeout: 25000 });
  const tok = await deviceToken(d.page);
  const { left } = await fillCorrect(d.page, { keepLast: 1 });
  await waitServer(tok, '"unfinished"', 15000); // прошлые ходы
  await d.page.waitForTimeout(2500);
  // последняя клетка: ставим и сразу скрываем вкладку
  const { solution } = await L.solutionOf(d.page);
  await L.place(d.page, left[0], Number(solution[left[0]]));
  const t0 = Date.now(); await setVisibility(d.page, 'hidden');
  const sv = await waitServer(tok, SOLVED, 15000);
  ok(sv.ok && Date.now() - t0 < 1800, `push на hidden: решение дошло за ${Date.now() - t0} мс (< 2000 debounce => именно hidden-push)`);
  await d.ctx.close();
  // жёсткое закрытие страницы сразу после хода
  const e = await dev(); await gotoApp(e.page); await e.page.waitForSelector('.board .cell .d.given', { timeout: 25000 });
  const tk = await deviceToken(e.page);
  const f = await fillCorrect(e.page, { keepLast: 1 }); await e.page.waitForTimeout(2500);
  const s2 = await L.solutionOf(e.page);
  await L.place(e.page, f.left[0], Number(s2.solution[f.left[0]]));
  await e.page.close({ runBeforeUnload: true });
  const sv2 = await waitServer(tk, SOLVED, 8000);
  console.log(`   info: после page.close без hidden-события решение на сервере: ${sv2.ok} (${sv2.ms} мс; на iOS pagehide/hidden срабатывает всегда, при debounce 2 с допустимо)`);
  // повторное открытие того же профиля: ход не потерян локально
  const p2 = await e.ctx.newPage(); await p2.goto(BASE + '/'); await p2.waitForSelector('.board', { timeout: 25000 }); await p2.waitForTimeout(2500);
  ok(await p2.locator(T('grid-inf-section')).count() > 0, 'после закрытия вкладки ход сохранён локально (день решён при открытии)');
  await e.ctx.close();
}

if (want('offline')) {
  console.log('--- S3 потеря сети ---');
  const d = await dev(); await gotoApp(d.page); await d.page.waitForSelector('.board .cell .d.given', { timeout: 25000 });
  const tok = await deviceToken(d.page); await d.page.waitForTimeout(500);
  await d.ctx.setOffline(true);
  await fillCorrect(d.page);
  await d.page.waitForTimeout(4000);
  const mid = await api('/api/snapshot', { headers: { authorization: `Bearer ${tok}` } });
  ok(mid.status === 404 || !SOLVED.test(mid.text), `офлайн: на сервере решения нет (HTTP ${mid.status})`);
  ok(await d.page.locator(T('grid-inf-section')).count() > 0, 'офлайн: игра работает, день решён локально');
  await d.ctx.setOffline(false);
  await d.page.evaluate(() => window.dispatchEvent(new Event('online')));
  const sv = await waitServer(tok, SOLVED, 30000);
  ok(sv.ok, `возврат сети: ход доехал на сервер за ${sv.ms} мс`);
  ok(d.errs.filter((e) => !/Failed to load|offline|network/i.test(e)).length === 0, `ошибок кроме сетевых нет (${JSON.stringify(d.errs).slice(0, 200)})`);
  await d.ctx.close();
  console.log('--- S3b первый запуск без сети, затем сеть ---');
  const e = await dev(); await e.ctx.setOffline(true); await gotoApp(e.page).catch(() => {});
  await e.page.waitForTimeout(500); await e.ctx.setOffline(false);
  await e.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await e.page.waitForTimeout(500);
  const tk = await deviceToken(e.page).catch(() => null);
  console.log('   info: token after offline-first-run:', !!tk);
  await e.ctx.close();
}

if (want('restore')) {
  console.log('--- S4 ключ -> restore на втором устройстве -> замена ключа ---');
  const a = await dev(); await gotoApp(a.page); await a.page.waitForSelector('.board .cell .d.given', { timeout: 25000 });
  const ta = await deviceToken(a.page); await fillCorrect(a.page);
  ok((await waitServer(ta, SOLVED)).ok, 'A: решённый день на сервере');
  const auth = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  const k1 = await api('/api/recovery/key', { method: 'POST', headers: auth(ta) });
  const key1 = k1.json?.key ?? k1.json?.data?.key; ok(k1.status < 300 && !!key1, `A: ключ выдан (HTTP ${k1.status})`);
  // B: чистое устройство, ключ вводится в Settings
  const b = await dev(); await gotoApp(b.page); await b.page.waitForSelector('.board .cell .d.given', { timeout: 25000 });
  await b.page.locator(T('open-settings')).tap(); await b.page.waitForSelector(T('key-have'), { timeout: 15000 });
  await b.page.locator(T('key-have')).tap(); await b.page.waitForSelector(T('key-field'));
  await b.page.locator(T('key-field')).fill(String(key1));
  await b.net.splice(0);
  await b.page.locator(T('key-restore')).tap();
  await b.page.waitForSelector(T('key-restored'), { timeout: 20000 }).catch(() => {});
  ok(await b.page.locator(T('key-restored')).count() > 0, 'B: restore по ключу прошёл');
  await b.page.waitForTimeout(3000);
  ok(count(b.net, 'GET', '/api/snapshot') >= 1, `B: после restore запрошен снапшот (GET=${count(b.net, 'GET', '/api/snapshot')})`);
  await b.page.goto(BASE + '/#/today'); await b.page.waitForSelector('.board, [data-testid=grid-inf-section]', { timeout: 20000 }); await b.page.waitForTimeout(1500);
  ok(await b.page.locator(T('grid-inf-section')).count() > 0, 'B: день, решённый на A, показывается решённым (подтянут с сервера)');
  // замена ключа на A
  const r1 = await api('/api/recovery/key/rotate', { method: 'POST', headers: auth(ta) });
  const key2 = r1.json?.key ?? r1.json?.data?.key;
  const cf = await api('/api/recovery/key/rotate/confirm', { method: 'POST', headers: auth(ta), body: JSON.stringify({ pendingId: r1.json?.pendingId }) });
  ok(r1.status === 200 && cf.status === 200, `A: замена ключа rotate/confirm HTTP ${r1.status}/${cf.status}`);
  const redeemOld = await api('/api/recovery/redeem', { method: 'POST', headers: auth(await deviceToken(b.page)), body: JSON.stringify({ key: key1 }) });
  ok(redeemOld.status === 400, `старый ключ не принимается (HTTP ${redeemOld.status})`);
  const tb = await deviceToken(b.page);
  const st = await api('/api/recovery', { headers: auth(tb) });
  ok(st.json?.hasKey === true, 'B остаётся подключённым после замены ключа');
  ok(a.errs.length === 0 && b.errs.length === 0, `ошибок нет (A:${JSON.stringify(a.errs)} B:${JSON.stringify(b.errs)})`);
  await a.ctx.close(); await b.ctx.close();
}
await browser.close();
console.log(fails.length ? `\nFAILED ${fails.length}\n- ${fails.join('\n- ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
