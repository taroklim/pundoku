// Перемер PD-140: цикл «новый контекст с профилем ветерана -> тап Year» на main 96bbd4a (после PD-146).
// Профиль сеется вручную (IndexedDB с ожиданием tx.oncomplete, см. lib-after.mjs). Режим OLD=1 — как в исходном repro-year-blank.mjs:
// storageState({indexedDB:true}) (запись без ожидания фиксации), чтобы сравнить с нормальным посевом.
// Запуск: N=20 [OLD=1] node repro-year-after.mjs   (нужен стенд и /tmp/pundoku-iarem/state-vet.json от measure-after.mjs)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, STATE_DIR, instrument, launch, newCtx, newProfileCtx, waitMark } from "./lib-after.mjs";

const N = Number(process.env.N ?? 20);
const OLD = process.env.OLD === "1";
const profile = JSON.parse(readFileSync(join(STATE_DIR, "state-vet.json"), "utf8"));

const b = await launch("webkit");
let ok = 0;
const fails = [];
for (let i = 0; i < N; i++) {
  let ctx;
  try {
    if (OLD) {
      // воссоздаём «как раньше»: сперва посев вручную в отдельном контексте, снимок — штатным storageState с IndexedDB
      const seedCtx = await newProfileCtx(b, "webkit", profile);
      const st = await seedCtx.storageState({ indexedDB: true });
      await seedCtx.close();
      ctx = await b.newContext({ storageState: st, viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    } else {
      ctx = await newProfileCtx(b, "webkit", profile);
    }
    await instrument(ctx);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await page.locator(".tab").nth(2).tap();
    await page.waitForTimeout(700);
    const months = await page.locator(".year-month").count();
    const boundary = await page.getByText(/something went wrong/i).count();
    const blank = (await page.evaluate(() => document.body.innerText.trim().length)) < 20;
    if (months === 12 && !errs.length && !boundary && !blank) ok++;
    else fails.push({ i, months, boundary, blank, errs });
  } catch (e) {
    fails.push({ i, error: e.message.split("\n")[0] });
  } finally {
    await ctx?.close();
  }
  process.stdout.write(`${i + 1}/${N} ok=${ok}\r`);
}
console.log(`\nmode=${OLD ? "OLD storageState(indexedDB)" : "manual seed + tx.oncomplete"} N=${N} ok=${ok} fails=${fails.length}`);
if (fails.length) console.log(JSON.stringify(fails, null, 1));
await b.close();
