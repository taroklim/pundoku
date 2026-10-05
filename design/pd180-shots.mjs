/**
 * PD-180 — Питомец-клякса на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit: кадры и самопроверка.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 4280 --strictPort
 *   PD_PW_HOME=/tmp/pd161-pw BASE=http://localhost:4280 node design/pd180-shots.mjs
 *
 * Данные — настоящие партии движка (`design/pd180-seed.ts` → фикстуры тестов), записанные прямо в IndexedDB приложения
 * (`pundoku` / `days`) до загрузки приложения. Питомец включается так же, как тумблером: localStorage `pundoku.pet = "1"`.
 *
 * Кадры (design/pd180-shots/):
 *   <tag>-card-<mood>.png      — карточка результата Today: доволен / устал / удивлён (рекорд). «Спит» на карточке не бывает:
 *                                карточка есть только у решённого дня (макет PD-170).
 *   <tag>-year-<mood>.png      — лист дня Year: доволен / спит (пропущенный день) / устал / удивлён (рекорд).
 *   <tag>-settings-off|on.png  — Настройки → «Extras»: тумблер выкл (по умолчанию) и вкл; -settings-preview — превью 4 настроений.
 * Проверки: настроение каждой кляксы = ожидаемое; на полотне Year, странице месяца и на поле клякс нет; при Reduce Motion
 * клякса стоит (transform не меняется), без него — дышит; тумблер по умолчанию выкл. Никаких pkill: браузеры закрываются в finally.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PW_HOME = process.env.PD_PW_HOME || "/tmp/pd161-pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
function loadPlaywright() {
  for (const b of [process.cwd() + "/", PW_HOME + "/"]) {
    try {
      return createRequire(b)("playwright");
    } catch {
      /* следующий */
    }
  }
  console.error("Playwright не найден (cwd, " + PW_HOME + ")");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();

const BASE = process.env.BASE ?? "http://localhost:4280";
const OUT = join(HERE, "pd180-shots");
const ONLY = process.env.ONLY; // cr | wk — перезаписать кадры только своего движка
if (ONLY && existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.startsWith(`${ONLY}-`)) rmSync(join(OUT, f));
if (!ONLY) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localDate();
const seedRun = spawnSync("pnpm", ["exec", "tsx", "../../design/pd180-seed.ts", TODAY], { cwd: join(HERE, "../apps/api"), encoding: "utf8", maxBuffer: 64 << 20 });
if (seedRun.status !== 0) {
  console.error(seedRun.stderr);
  process.exit(1);
}
const SEED = JSON.parse(seedRun.stdout);

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const CONFIGS = [
  { w: 390, h: 844, scheme: "light", lang: "en" },
  { w: 390, h: 844, scheme: "dark", lang: "ru" },
  { w: 320, h: 568, scheme: "light", lang: "ru", ax3: true },
  { w: 320, h: 568, scheme: "dark", lang: "en", rm: true },
];

async function open(browser, c, { pet, days, firstUse }) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { ru: "ru-RU", en: "en-US" }[c.lang],
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ lang, ax3, pet }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
        if (pet) localStorage.setItem("pundoku.pet", "1");
      } catch {
        /* приватный режим */
      }
      if (ax3) {
        const add = () => {
          const s = document.createElement("style");
          s.textContent = "html{font-size:40px !important}";
          document.documentElement.appendChild(s);
        };
        if (document.documentElement) add();
        else document.addEventListener("DOMContentLoaded", add);
      }
    },
    { lang: c.lang, ax3: !!c.ax3, pet },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::|Load failed|Could not connect/.test(m.text())) errs.push(m.text());
  });
  // Запись в IndexedDB приложения — со статического файла того же origin (приложение ещё не запущено).
  await page.goto(`${BASE}/manifest.webmanifest`);
  await page.evaluate(
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
  return { ctx, page, errs };
}

/** Дышит ли клякса: два замера transform через полпериода. */
async function breathing(page, sel) {
  const g = page.locator(`${sel} .pet-breathe`).first();
  const a = await g.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(1600);
  const b = await g.evaluate((el) => getComputedStyle(el).transform);
  return a !== b;
}

async function runConfig(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}`;
  try {
    // ---- карточка результата Today: 3 настроения ----
    for (const mood of ["happy", "tired", "surprised"]) {
      const { ctx, page, errs } = await open(browser, c, { pet: true, days: SEED.card[mood], firstUse: null });
      try {
        await page.goto(`${BASE}/#/today`);
        await page.locator('[data-testid="pet-card"] svg.pet-svg').waitFor({ timeout: 30000 });
        await page.waitForTimeout(700);
        const got = await page.locator('[data-testid="pet-card"] svg.pet-svg').getAttribute("data-mood");
        ok(`${tag}: карточка — ${mood}`, got === mood, got ?? "");
        const label = await page.locator('[data-testid="pet-card"] svg.pet-svg').getAttribute("aria-label");
        ok(`${tag}: карточка — подпись VoiceOver на языке`, c.lang === "ru" ? /^Клякса, / .test(label ?? "") : /^Blot, /.test(label ?? ""), label ?? "");
        ok(`${tag}: на поле/мини-поле кляксы нет`, (await page.locator(".board svg.pet-svg, .mini svg.pet-svg, [data-testid='grid-inf-section'] svg.pet-svg").count()) === 0);
        ok(`${tag}: на экране одна клякса`, (await page.locator("svg.pet-svg").count()) === 1);
        const box = await page.locator('[data-testid="pet-card"] svg.pet-svg').boundingBox();
        ok(`${tag}: размер 44 pt`, Math.round(box.width) === 44, String(box.width));
        // Заголовок карточки не заезжает под кляксу.
        const overlap = await page.evaluate(() => {
          const p = document.querySelector('[data-testid="pet-card"]').getBoundingClientRect();
          const r = document.createRange();
          r.selectNodeContents(document.querySelector("#result-title"));
          const t = r.getBoundingClientRect();
          return t.right > p.left + 4 && t.top < p.bottom && t.bottom > p.top ? `${t.right}>${p.left}` : "";
        });
        ok(`${tag}: заголовок не под кляксой`, overlap === "", overlap);
        if (mood === "happy") {
          const moving = await breathing(page, '[data-testid="pet-card"]');
          ok(`${tag}: ${c.rm ? "Reduce Motion — стоит" : "дышит"}`, c.rm ? !moving : moving);
        }
        await page.locator('[data-testid="result-card"]').scrollIntoViewIfNeeded();
        await page.evaluate(() => document.querySelector('[data-testid="result-card"]').scrollIntoView({ block: "start" }));
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(OUT, `${tag}-card-${mood}.png`) });
        ok(`${tag}: card-${mood} без ошибок консоли`, errs.length === 0, errs.join(" | "));
      } finally {
        await ctx.close();
      }
    }

    // ---- Year: лист дня, 4 настроения ----
    {
      const first = SEED.year.map((d) => d.date).sort()[0];
      const { ctx, page, errs } = await open(browser, c, { pet: true, days: SEED.year, firstUse: first });
      try {
        await page.goto(`${BASE}/#/year`);
        await page.locator(".year-month").first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(600);
        ok(`${tag}: полотно Year без клякс`, (await page.locator("svg.pet-svg").count()) === 0);
        for (const mood of ["happy", "asleep", "tired", "surprised"]) {
          const date = SEED.dates[mood];
          const month = Number(date.slice(5, 7)) - 1;
          if ((await page.locator('[data-testid="year-sheet"]').count()) === 0) {
            await page.locator(`.year-month[data-month="${month}"]`).click();
          } else if ((await page.locator('[data-testid="year-sheet"][data-page="day"]').count()) > 0) {
            await page.locator(".ysheet .back").click();
          }
          await page.locator('[data-testid="month-page"]').waitFor();
          await page.waitForTimeout(350);
          if (mood === "happy") ok(`${tag}: страница месяца без клякс`, (await page.locator("svg.pet-svg").count()) === 0);
          await page.locator(`.ycell[data-date="${date}"]`).click();
          await page.locator('[data-testid="pet-year"] svg.pet-svg').waitFor({ timeout: 10000 });
          await page.waitForTimeout(450);
          const got = await page.locator('[data-testid="pet-year"] svg.pet-svg').getAttribute("data-mood");
          ok(`${tag}: Year ${date} — ${mood}`, got === mood, got ?? "");
          const box = await page.locator('[data-testid="pet-year"] svg.pet-svg').boundingBox();
          ok(`${tag}: Year — 40 pt`, Math.round(box.width) === 40, String(box.width));
          await page.screenshot({ path: join(OUT, `${tag}-year-${mood}.png`) });
        }
        ok(`${tag}: Year без ошибок консоли`, errs.length === 0, errs.join(" | "));
      } finally {
        await ctx.close();
      }
    }

    // ---- Настройки: тумблер выкл по умолчанию → вкл ----
    {
      const { ctx, page, errs } = await open(browser, c, { pet: false, days: [], firstUse: null });
      try {
        await page.goto(`${BASE}/#/settings`);
        const sw = page.locator('[data-testid="pet-toggle"]');
        await sw.waitFor({ timeout: 30000 });
        ok(`${tag}: тумблер по умолчанию выкл`, !(await sw.isChecked()));
        await page.evaluate(() => document.querySelector("#settings-h-extras").scrollIntoView({ block: "start" }));
        await page.waitForTimeout(350);
        await page.screenshot({ path: join(OUT, `${tag}-settings-off.png`) });
        await sw.locator("xpath=ancestor::label").click();
        await page.waitForTimeout(450);
        ok(`${tag}: тумблер включается, превью проявляется`, (await sw.isChecked()) && !(await page.locator('[data-testid="pet-moods"]').evaluate((e) => e.classList.contains("off"))));
        ok(`${tag}: настройка сохранена локально`, (await page.evaluate(() => localStorage.getItem("pundoku.pet"))) === "1");
        await page.screenshot({ path: join(OUT, `${tag}-settings-on.png`) });
        await page.locator('[data-testid="pet-moods"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(OUT, `${tag}-settings-preview.png`) });
        ok(`${tag}: превью — 4 настроения`, (await page.locator('[data-testid="pet-moods"] svg.pet-svg').count()) === 4);
        ok(`${tag}: Настройки без ошибок консоли`, errs.length === 0, errs.join(" | "));
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

for (const [name, type] of [
  ["cr", chromium],
  ["wk", webkit],
]) {
  if (ONLY && ONLY !== name) continue;
  for (const c of CONFIGS) {
    try {
      await runConfig(name, type, c);
    } catch (e) {
      ok(`${name}-${c.w}-${c.scheme}-${c.lang}: прогон без исключений`, false, String(e).split("\n")[0]);
    }
  }
}

const fails = results.filter((r) => !r.cond);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
process.exit(fails.length ? 1 : 0);
