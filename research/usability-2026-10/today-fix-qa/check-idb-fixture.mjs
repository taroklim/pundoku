// PD-217: проверка фикстуры IndexedDB (флейк «seed verify failed»). Профиль «ветерана в прошлом» (день 2026-09-28), затем N
// посевов в чистые контексты. После каждого посева база читается обратно и сравнивается с дампом побайтно (JSON).
//   MODE=new (по умолчанию) — `newProfileCtx` (страница посева без приложения, `fixturePage`);
//   MODE=old — как было: страница BASE/health + RESTORE (на стенде vite там грузится приложение).
// Плюс прямой контроль причины: на странице посева не должен выполняться ни один скрипт.
// Запуск: PW_DIR=<playwright> BASE=http://127.0.0.1:<порт vite> SHOTS=/tmp/x STATE_DIR=/tmp/x node check-idb-fixture.mjs
// Код возврата 1 — хоть одна проверка не прошла. Браузер закрывается в finally.
import { pathToFileURL } from "node:url";
const lib = await import(pathToFileURL(new URL("./lib-qa.mjs", import.meta.url).pathname).href);
const { BASE, RESTORE, fixturePage, launch, newCtx, newProfileCtx, snapshotProfile } = lib;
const N = Number(process.env.N ?? 6);
const ENGINE = process.env.ENGINE ?? "chromium";
const MODE = process.env.MODE ?? "new";
const HOLD_MS = Number(process.env.HOLD_MS ?? 2500); // сколько страница посева живёт после RESTORE (как медленный следующий шаг)

const dumpOf = async (ctx) => (await snapshotProfile(ctx)).idb;
const strip = (idb) => JSON.stringify(Object.fromEntries(Object.entries(idb).map(([n, d]) => [n, Object.fromEntries(Object.entries(d.stores).map(([s, st]) => [s, { keys: st.keys, values: st.values }]))])));

const b = await launch(ENGINE);
let bad = 0;
try {
  const c0 = await newCtx(b, ENGINE);
  const p = await c0.newPage();
  await p.clock.install({ time: new Date("2026-09-28T12:00:00") });
  await p.goto(BASE + "/#/today");
  await p.waitForSelector(".board:not(.idle) .cell .d.given", { timeout: 120000 });
  await p.waitForTimeout(1500);
  await p.close();
  const profile = await snapshotProfile(c0);
  await c0.close();
  const want = strip(profile.idb);

  // Причина: выполняется ли скрипт на странице посева.
  {
    const ctx = await newCtx(b, ENGINE);
    try {
      let scripts;
      if (MODE === "old") {
        const p0 = await ctx.newPage();
        await p0.goto(BASE + "/health");
        scripts = await p0.evaluate(() => document.scripts.length);
      } else {
        const f = await fixturePage(ctx);
        scripts = await f.page.evaluate(() => document.scripts.length);
        await f.close();
      }
      console.log(`seed page scripts: ${scripts}`, scripts === 0 ? "OK" : "FAIL (приложение грузится на странице посева)");
      if (scripts !== 0) bad++;
    } finally {
      await ctx.close();
    }
  }

  for (let i = 0; i < N; i++) {
    let ctx;
    try {
      if (MODE === "old") {
        ctx = await newCtx(b, ENGINE, profile);
        const p0 = await ctx.newPage();
        await p0.goto(BASE + "/health");
        await p0.evaluate(RESTORE, profile.idb);
        await p0.waitForTimeout(HOLD_MS);
        await p0.close();
      } else {
        ctx = await newProfileCtx(b, ENGINE, profile);
        const f = await fixturePage(ctx);
        await f.page.waitForTimeout(HOLD_MS);
        await f.close();
      }
      const got = strip(await dumpOf(ctx));
      const same = got === want;
      if (!same) bad++;
      console.log(i, same ? "OK: база = дамп" : `FAIL: база != дамп (${got.length} vs ${want.length} симв.)`);
    } catch (e) {
      bad++;
      console.log(i, "FAIL", String(e.message ?? e).split("\n")[0].slice(0, 200));
    } finally {
      await ctx?.close();
    }
  }
} finally {
  await b.close();
}
console.log(`MODE=${MODE} engine=${ENGINE}: ${bad === 0 ? "PASS" : `FAIL ${bad}`}`);
process.exit(bad === 0 ? 0 : 1);
