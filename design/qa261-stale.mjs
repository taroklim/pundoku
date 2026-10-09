/**
 * QA PD-261 — (в) Low: «проснуться» теряется при возврате из архива (стейл-данные Year при открытии листа по yearDate).
 *   PD_PW_HOME=... BASE=http://localhost:5341 node design/qa261-stale.mjs
 * Поток: Year → вчера (незаконченный, «спит», запомнено) → «Finish» → решаем последнюю клетку в архиве → возврат на Year/<date>.
 */
/**
 * QA PD-261 — независимая живая проверка PD-260 (Питомец B «Капля»), chromium + webkit на реальной сборке (vite preview).
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5341 --strictPort
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend BASE=http://localhost:5341 node design/qa261-check.mjs [card,live,leak,wake,year]
 *   ENGINES=chromium,webkit (по умолчанию оба). Кадры → design/qa261-shots/.
 *
 * Данные — design/pd260-seed.ts (настоящие партии движка в IndexedDB). Сценарии отличаются от pd260-check:
 *   card — матрица 320–430 (+AX3, light/dark, en/uk/ru, RM): посадка один раз; ВСЕ анимации документа во время посадки
 *          только внутри .pet карточки (вне — только вход карточки); только transform/opacity; конечные; чернила внутри
 *          карточки и не на заголовке/подписи; RM — нет покоя, transform тождественный во всех точках; конец — стоит.
 *   live — живое время: через ≈14,5 с ни одной анимации кляксы; CDP (chromium): после замирания — нет перерисовок/стилей;
 *          RM переключили на лету — покой тождественный; 8 быстрых переключений вкладок — без накопления анимаций.
 *   leak — Settings поверх Today: клякса карточки стоит; превью Настроек — конечные анимации; закрыли лист дня Year —
 *          ни одной анимации у отсоединённых элементов; Year → Play — у кляксы листа нет анимаций.
 *   wake — сквозной «проснуться» БЕЗ подложенной памяти: Year показал «спит» → день решён (запись в IDB) → Year → wake один
 *          раз → повторный показ — покой; RM — только прозрачность.
 *   year — 320/360/375 AX3 en/uk/ru light/dark: строки даты не заходят на кляксу (в т. ч. в любой точке покоя).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pw = createRequire((process.env.PD_PW_HOME || "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5341";
const OUT = join(HERE, "qa261-shots");
mkdirSync(OUT, { recursive: true });
const ENGINES = (process.env.ENGINES ?? "chromium,webkit").split(",");
const FILTER = (process.argv[2] ?? "card,live,leak,wake,year").split(",");

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localDate(new Date(Date.now() - 864e5)); // семя «сегодня» = вчера: вчерашний день — незаконченный архивный (одна клетка до конца)
const seedRun = spawnSync("pnpm", ["exec", "tsx", "../../design/pd260-seed.ts", TODAY], { cwd: join(HERE, "../apps/api"), encoding: "utf8", maxBuffer: 64 << 20 });
if (seedRun.status !== 0) {
  console.error(seedRun.stderr);
  process.exit(1);
}
const SEED = JSON.parse(seedRun.stdout);
const DUR = { arrive: { happy: 760, tired: 900, surprised: 860 }, wake: 820 };
const DUR_RM = { arrive: 220, wake: 260 };
const DELAY = 300;

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond });
  const d = typeof extra === "string" ? extra : JSON.stringify(extra);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${d ? "  " + d.slice(0, 400) : ""}`);
};
const info = (name, extra) => console.log(`INFO  ${name}  ${typeof extra === "string" ? extra : JSON.stringify(extra)}`);

async function open(browser, c, { days, firstUse = null, seen = null }) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h ?? 844 },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { ru: "ru-RU", en: "en-US", uk: "uk-UA" }[c.lang],
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ lang, fs, seen }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
        localStorage.setItem("pundoku.pet", "1");
        if (seen && !sessionStorage.getItem("qa261-seeded")) localStorage.setItem("pundoku.petSeen", JSON.stringify(seen));
      } catch {}
      if (fs) {
        const add = () => {
          const s = document.createElement("style");
          s.textContent = `html{font-size:${fs}px !important}`;
          document.documentElement.appendChild(s);
        };
        if (document.documentElement) add();
        else document.addEventListener("DOMContentLoaded", add);
      }
    },
    { lang: c.lang, fs: c.ax3 ? 40 : 0, seen },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::|Load failed|Could not connect|access control/.test(m.text())) errs.push(m.text());
  });
  await page.goto(`${BASE}/manifest.webmanifest`);
  await putDays(page, days, firstUse);
  return { ctx, page, errs };
}
const putDays = (page, days, firstUse = null) =>
  page.evaluate(
    async ({ days, firstUse }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("pundoku", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("kv");
          r.result.createObjectStore("days", { keyPath: "date" });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction(["days", "kv"], "readwrite");
        for (const d of days) tx.objectStore("days").put(d);
        if (firstUse) tx.objectStore("kv").put(firstUse, "meta:firstUseDate");
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { days, firstUse },
  );

async function solveLast(page, last) {
  await page.locator(".board button.cell").first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(500);
  await page.locator(`.board button.cell[data-i="${last.cell}"]`).click();
  await page.locator(".pad .key").nth(last.digit - 1).click();
}
const tagOf = (bn, c, extra = "") => `${bn}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}${extra}`;

const Y = TODAY;
const YR = '[data-testid="pet-year"] .pet';
const P = SEED.pending.happy;
for (const engine of ENGINES) {
  const browser = await pw[engine].launch();
  try {
    const { ctx, page, errs } = await open(browser, { w: 393, h: 852, scheme: "light", lang: "en" }, { days: [...SEED.year, ...P.days], firstUse: SEED.year.map((d) => d.date).sort()[0] });
    await page.goto(`${BASE}/#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    const month = Number(Y.slice(5, 7)) - 1;
    await page.locator(`.year-month[data-month="${month}"]`).click();
    await page.locator('[data-testid="month-page"]').waitFor();
    await page.waitForTimeout(350);
    await page.locator(`.ycell[data-date="${Y}"]`).click();
    await page.locator('[data-testid="day-card"]').waitFor();
    await page.waitForTimeout(400);
    const m0 = await page.locator(YR).getAttribute("data-mood").catch(() => null);
    const seen0 = await page.evaluate(() => localStorage.getItem("pundoku.petSeen"));
    info(`${engine}: лист вчерашнего незаконченного дня`, { mood: m0, seen: seen0 });
    await page.locator('[data-testid="finish-day"]').click();
    await solveLast(page, P.last);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${engine}-stale-1-archive-solved.png`) });
    info(`${engine}: после решения — hash`, await page.evaluate(() => location.hash));
    const btns = await page.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].filter((b) => b.offsetParent !== null && !b.closest("[inert]")).map((b) => (b.id || b.dataset.testid || b.className) + ":" + (b.textContent || "").trim().slice(0, 20)));
    info(`${engine}: видимые кнопки`, btns.join(" | "));
    // Возврат: вкладка Year (как делает пользователь) и/или route #/year/<date>.
    // Наблюдатель: любой data-act на кляксе листа дня за время возврата.
    await page.evaluate(() => {
      window.__acts = [];
      const rec = () => document.querySelectorAll('[data-testid="pet-year"] .pet').forEach((e) => { const a = e.dataset.act ?? "-" + e.dataset.mood; if (window.__acts.at(-1) !== a) window.__acts.push(a); });
      new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-act", "data-mood"] });
    });
    const via = process.env.VIA ?? "archive-back";
    if (via === "hash") await page.evaluate((d) => { location.hash = `#/year/${d}`; }, Y);
    else if (via === "tab") await page.locator("#tab-year").click().catch(() => {});
    else await page.locator('[data-testid="archive-back"]').click().catch(async () => { await page.goBack(); });
    await page.waitForTimeout(1200);
    info(`${engine}: после возврата — hash`, await page.evaluate(() => location.hash));
    const sheet = await page.locator('[data-testid="day-card"]').count();
    const att = sheet ? await page.locator(YR).evaluate((e) => ({ mood: e.dataset.mood, act: e.dataset.act ?? null })).catch(() => null) : null;
    info(`${engine}: лист дня открыт=${sheet}`, att);
    await page.screenshot({ path: join(OUT, `${engine}-stale-2-return.png`) });
    const seen1 = await page.evaluate(() => localStorage.getItem("pundoku.petSeen"));
    info(`${engine}: petSeen после`, seen1);
    const acts = await page.evaluate(() => window.__acts);
    info(`${engine}: история data-act/mood кляксы листа`, acts);
    ok(`${engine}: при возврате из архива клетка «проснуться» играет`, acts.includes("wake"), JSON.stringify(acts));
    await ctx.close();
  } finally {
    await browser.close();
  }
}
const fails = results.filter((r) => !r.cond);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
