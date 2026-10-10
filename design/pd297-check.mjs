/**
 * PD-297 — живая проверка: Питомец по умолчанию ВКЛ, покой — постоянное дыхание (везде, включая превью в Settings), пауза вне
 * экрана, стоит в скрытой вкладке/фоне, Reduce Motion главнее, явный «выкл» сохраняется после перезагрузки. РЕАЛЬНАЯ сборка.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd297-dist
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend DIST=/tmp/pd297-dist PORT=5601 \
 *     node design/pd297-check.mjs [chromium] [webkit]
 *
 * Сервер и сетка дня — `design/pdlow4/lib.mjs` (статическая раздача dist + мок /api/daily, время зафиксировано 2026-10-09 UTC).
 * Сетка дня решается по-настоящему (клавиатура), карточка результата — Today; лист дня Year — тот же день. 393×852.
 *  1. Чистый профиль (ключа `pundoku.pet` нет): тумблер вкл, футер «On by default»; карточка — посадка, потом дыхание:
 *     computed animation-iteration-count = infinite, Animation.iterations = Infinity, running; живьём через ≈14 с (дольше
 *     прежних «3 вдохов») — всё ещё running; лист дня Year — дышит бесконечно; превью Settings — 4 × бесконечно.
 *  2. Вне экрана: превью Settings за краем панели — data-paused, play-state paused; прокрутили к нему — running; карточка
 *     прокручена из вида — paused, вернули — running (тот же элемент, без ремаунта).
 *  3. Фон (visibilitychange, эмуляция как pd260-check): ни одной анимации у кляксы (data-still); вернулись — дышит.
 *  4. Reduce Motion: ни карточка, ни лист Year, ни превью не анимируются (покоя нет).
 *  5. Выкл тумблером → «0»; перезагрузка: тумблер выкл, на карточке кляксы нет, превью приглушено и стоит.
 *  6. Прежний формат «1» (включал до PD-297) — вкл.
 * Кадры — design/pd297-shots/ (не коммитятся, кроме ключевых). Браузер и сервер закрываются в finally.
 */
import fs from "node:fs";
import path from "node:path";
import { pw, serve, MISSION, SOLUTION, NOW } from "./pdlow4/lib.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? "/tmp/pd297-dist");
const PORT = +(process.env.PORT ?? 5601);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(HERE, "pd297-shots");
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2).filter((a) => ["chromium", "webkit"].includes(a));
const BROWSERS = args.length ? args : ["chromium", "webkit"];
const SHORT = { chromium: "cr", webkit: "wk" };
const P = ".tab-pane:not(.off)";
const DATE = NOW.toISOString().slice(0, 10);

let total = 0;
const fails = [];
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, typeof detail === "string" ? detail : JSON.stringify(detail));
};

async function open(browser, { rm = false, pet = undefined, lang = "en" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    screen: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    locale: { en: "en-US", uk: "uk-UA", ru: "ru-RU" }[lang],
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: rm ? "reduce" : "no-preference",
    serviceWorkers: "block",
  });
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript(
    ({ pet, lang }) => {
      // Только при первом заходе в контекст: перезагрузка должна видеть то, что записало приложение.
      if (sessionStorage.getItem("pd297-init")) return;
      sessionStorage.setItem("pd297-init", "1");
      localStorage.setItem("pundoku.locale", lang);
      if (pet !== undefined) localStorage.setItem("pundoku.pet", pet);
    },
    { pet, lang },
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${BASE}/#/today`);
  await p.waitForSelector(`${P} .board button.cell`, { timeout: 40000 });
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}

async function solveDay(p) {
  const empties = [...MISSION].flatMap((g, i) => (g === "0" ? [i] : []));
  for (const i of empties) {
    await p.locator(`${P} .board button.cell[data-i="${i}"]`).click();
    await p.keyboard.press(SOLUTION[i]);
  }
  await p.locator(`${P} [data-testid="result-card"]`).waitFor({ timeout: 15000 });
}

/** Состояние каждой кляксы под селектором: атрибуты, computed стиль .breath, анимации Web Animations. */
const pets = (p, sel) =>
  p.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const br = el.querySelector(".breath");
      const cs = getComputedStyle(br);
      const anims = el.getAnimations({ subtree: true }).map((a) => ({
        name: a.animationName,
        cls: a.effect.target.className,
        state: a.playState,
        iterations: a.effect.getTiming().iterations,
      }));
      const breath = anims.find((a) => a.cls === "breath") ?? null;
      const r = el.getBoundingClientRect();
      return {
        idle: el.hasAttribute("data-idle"),
        paused: el.hasAttribute("data-paused"),
        still: el.hasAttribute("data-still"),
        act: el.getAttribute("data-act"),
        css: { name: cs.animationName, count: cs.animationIterationCount, play: cs.animationPlayState },
        breath: breath && { ...breath, iterations: breath.iterations === Infinity ? "Infinity" : breath.iterations },
        n: anims.length,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
      };
    });
  }, sel);
const breathesForever = (x) =>
  x && x.idle && !x.paused && !x.still && x.css.count === "infinite" && x.css.play === "running" && x.breath && x.breath.iterations === "Infinity" && x.breath.state === "running";
const isPaused = (x) => x && x.paused && x.css.play === "paused" && x.breath && x.breath.state === "paused";
const noMotion = (x) => x && !x.idle && x.n === 0;

const CARD = `${P} [data-testid="pet-card"] .pet`;
const YEAR = '[data-testid="pet-year"] .pet';
const PREVIEW = '[data-testid="pet-moods"] .pet';

async function openSettings(p) {
  await p.locator('[data-testid="open-settings"]:visible').first().click();
  await p.locator('[data-testid="settings-screen"]').waitFor();
  await p.waitForTimeout(700);
}
async function openYearDay(p) {
  await p.goto(`${BASE}/#/year`);
  await p.locator(".year-month").first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(500);
  await p.locator(`.year-month[data-month="${Number(DATE.slice(5, 7)) - 1}"]`).click();
  await p.locator('[data-testid="month-page"]').waitFor();
  await p.waitForTimeout(400);
  await p.locator(`.ycell[data-date="${DATE}"]`).click();
  await p.locator(YEAR).waitFor({ timeout: 10000 });
  await p.waitForTimeout(1300); // «проснуться»/покой
}
/** Прокручиваемая панель вокруг элемента. */
const scrollPaneOf = (p, sel, to) =>
  p.evaluate(
    ({ sel, to }) => {
      const el = document.querySelector(sel);
      let sc = el.parentElement;
      while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      if (!sc) return null;
      if (to === "end") sc.scrollTop = sc.scrollHeight;
      else if (to === "above") sc.scrollTop += el.getBoundingClientRect().bottom - sc.getBoundingClientRect().top + 40; // за верхний край
      else if (to === "start") sc.scrollTop = 0;
      else el.scrollIntoView({ block: "center" });
      return { st: Math.round(sc.scrollTop), max: Math.round(sc.scrollHeight - sc.clientHeight) };
    },
    { sel, to },
  );

async function run(brn) {
  const b = await pw[brn].launch();
  const B = SHORT[brn];
  try {
    // ---------------------------------------------------------------- 1–3: чистый профиль
    {
      const { ctx, p, errs } = await open(b);
      try {
        check(`${B} 1: чистый профиль — ключа pundoku.pet нет`, (await p.evaluate(() => localStorage.getItem("pundoku.pet"))) === null);
        await solveDay(p);
        await p.locator(`${CARD}[data-act="arrive"]`).waitFor({ timeout: 10000 });
        const t0 = Date.now();
        // После решения панель докручивает к Grid ∞ — карточку могло увести из вида (тогда клякса на паузе): вернуть к ней.
        await p.waitForTimeout(900);
        await p.evaluate((s) => document.querySelector(s).closest('[data-testid="result-card"]').scrollIntoView({ block: "start" }), CARD);
        await p.waitForTimeout(700);
        let [c] = await pets(p, CARD);
        check(`${B} 1: карточка — клякса по умолчанию есть, после посадки дышит бесконечно`, breathesForever(c), c);
        await p.screenshot({ path: path.join(OUT, `${B}-card-default.png`) });
        // 2: карточка из вида — пауза, тот же элемент; вернули — дышит.
        const before = await p.evaluate((s) => ((window.__pd297 = document.querySelector(s)), true), CARD);
        const sc = await scrollPaneOf(p, CARD, "end");
        await p.waitForTimeout(500);
        [c] = await pets(p, CARD);
        if (c.bottom < 0 || c.top > 852) check(`${B} 2: карточка вне экрана — пауза (data-paused, play-state paused)`, isPaused(c), { ...c, sc });
        else console.log(`INFO ${B} 2: карточка не уходит из вида прокруткой (контента мало)`, JSON.stringify({ sc, top: c.top }));
        await scrollPaneOf(p, CARD, "start");
        await p.waitForTimeout(500);
        [c] = await pets(p, CARD);
        const same = await p.evaluate((s) => window.__pd297 === document.querySelector(s), CARD);
        check(`${B} 2: карточка снова на экране — дышит, без ремаунта`, breathesForever(c) && same && before, { c, same });
        // Живьём дольше прежних «3 вдохов» (≈ 300 + 760 + 12600 мс).
        await p.waitForTimeout(Math.max(0, 14500 - (Date.now() - t0)));
        [c] = await pets(p, CARD);
        check(`${B} 1: живьём через ≈14,5 с — всё ещё дышит (не «3 вдоха и замирает»)`, breathesForever(c), c);
        // 3: фон.
        await p.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await p.waitForTimeout(300);
        [c] = await pets(p, CARD);
        check(`${B} 3: приложение в фоне — у кляксы ни одной анимации (data-still)`, c.still && c.n === 0, c);
        await p.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await p.waitForTimeout(300);
        [c] = await pets(p, CARD);
        check(`${B} 3: из фона — снова дышит бесконечно, посадка не повторяется`, breathesForever(c) && c.act === null, c);
        // Вкладка Play — клякса Today не видна → стоит.
        await p.locator("#tab-play").click();
        await p.waitForTimeout(500);
        const hidden = await pets(p, '[data-testid="pet-card"] .pet');
        const todayPet = hidden.find((x) => x.still) ?? null;
        check(`${B} 3: вкладка Today скрыта — её клякса стоит (data-still, 0 анимаций)`, todayPet && todayPet.n === 0, hidden);
        await p.locator("#tab-today").click();
        await p.waitForTimeout(400);

        // Year: лист дня.
        await openYearDay(p);
        const [y] = await pets(p, YEAR);
        check(`${B} 1: лист дня Year — дышит бесконечно`, breathesForever(y), y);
        await p.screenshot({ path: path.join(OUT, `${B}-year-default.png`) });

        // Settings: тумблер, футер, превью.
        await p.goto(`${BASE}/#/today`);
        await p.reload(); // шит Year закрывается только жестом — чистый заход на Today
        await p.waitForSelector(`${P} [data-testid="result-card"]`, { timeout: 30000 });
        await openSettings(p);
        check(`${B} 1: Settings — тумблер Питомца включён по умолчанию`, await p.locator('[data-testid="pet-toggle"]').isChecked());
        const foot = await p.locator("#settings-pet-foot").textContent();
        check(`${B} 1: футер — «On by default.»`, /On by default\./.test(foot), foot);
        // Превью — у конца Settings: за верхний край его не увести (не хватает прокрутки), за нижний — только из начала панели.
        // Если и так видно  — окно ниже на время замера (тот же приём, что поворот).
        let vh = 852;
        await scrollPaneOf(p, '[data-testid="pet-moods"]', "start");
        await p.waitForTimeout(500);
        let prev = await pets(p, PREVIEW);
        if (prev.every((x) => x.top < vh)) {
          vh = 560;
          await p.setViewportSize({ width: 393, height: vh });
          await scrollPaneOf(p, '[data-testid="pet-moods"]', "start");
          await p.waitForTimeout(600);
          prev = await pets(p, PREVIEW);
        }
        const offPrev = prev.filter((x) => x.top > vh || x.bottom < 0);
        if (offPrev.length) check(`${B} 2: превью Settings за краем экрана (окно ${vh}) — пауза (${offPrev.length}/4)`, offPrev.length === 4 && offPrev.every(isPaused), offPrev);
        else console.log(`INFO ${B} 2: превью Settings видно и без прокрутки`, JSON.stringify(prev.map((x) => x.top)));
        if (vh !== 852) await p.setViewportSize({ width: 393, height: 852 });
        await scrollPaneOf(p, '[data-testid="pet-moods"]', "center");
        await p.waitForTimeout(500);
        prev = await pets(p, PREVIEW);
        check(`${B} 1: превью Settings — 4 настроения, каждое дышит бесконечно`, prev.length === 4 && prev.every(breathesForever), prev);
        await p.locator('[data-testid="pet-moods"]').screenshot({ path: path.join(OUT, `${B}-settings-preview-on.png`) });

        // 5: выкл тумблером → «0» → перезагрузка.
        await p.locator('[data-testid="pet-toggle"]').click();
        await p.waitForTimeout(300);
        check(`${B} 5: выкл тумблером пишет «0»`, (await p.evaluate(() => localStorage.getItem("pundoku.pet"))) === "0");
        prev = await pets(p, PREVIEW);
        check(`${B} 5: выкл — превью приглушено и стоит`, (await p.locator('[data-testid="pet-moods"].off').count()) === 1 && prev.every(noMotion), prev);
        await p.goto(`${BASE}/#/today`);
        await p.reload();
        await p.waitForSelector(`${P} [data-testid="result-card"]`, { timeout: 30000 });
        await p.waitForTimeout(500);
        check(`${B} 5: после перезагрузки на карточке кляксы нет`, (await p.locator('[data-testid="pet-card"] .pet').count()) === 0);
        await openSettings(p);
        check(`${B} 5: после перезагрузки тумблер выкл`, !(await p.locator('[data-testid="pet-toggle"]').isChecked()));
        check(`${B} 5: после перезагрузки хранится «0»`, (await p.evaluate(() => localStorage.getItem("pundoku.pet"))) === "0");
        await p.locator('[data-testid="pet-toggle"]').click();
        await p.waitForTimeout(300);
        check(`${B} 5: снова вкл — ключ удалён (умолчание), превью дышит`, (await p.evaluate(() => localStorage.getItem("pundoku.pet"))) === null && (await pets(p, PREVIEW)).every((x) => x.idle));
        check(`${B} 1–5: без ошибок страницы`, errs.filter((e) => !/\/api\//.test(e)).length === 0, errs.slice(0, 3).join(" | "));
      } finally {
        await ctx.close();
      }
    }
    // ---------------------------------------------------------------- 4: Reduce Motion
    {
      const { ctx, p, errs } = await open(b, { rm: true });
      try {
        await solveDay(p);
        await p.waitForTimeout(1200);
        const [c] = await pets(p, CARD);
        check(`${B} 4: RM — карточка: клякса есть, покоя нет, ни одной идущей анимации`, c && !c.idle && c.breath === null, c);
        await openYearDay(p);
        const [y] = await pets(p, YEAR);
        check(`${B} 4: RM — лист Year: без анимаций`, noMotion(y), y);
        await p.goto(`${BASE}/#/today`);
        await p.reload(); // шит Year закрывается только жестом — чистый заход на Today
        await p.waitForSelector(`${P} [data-testid="result-card"]`, { timeout: 30000 });
        await openSettings(p);
        await scrollPaneOf(p, '[data-testid="pet-moods"]', "center");
        await p.waitForTimeout(400);
        const prev = await pets(p, PREVIEW);
        check(`${B} 4: RM — превью Settings (Питомец вкл): ни одной анимации`, prev.length === 4 && prev.every(noMotion), prev);
        check(`${B} 4: RM без ошибок страницы`, errs.filter((e) => !/\/api\//.test(e)).length === 0, errs.slice(0, 3).join(" | "));
      } finally {
        await ctx.close();
      }
    }
    // ---------------------------------------------------------------- 6: прежний формат «1»
    {
      const { ctx, p, errs } = await open(b, { pet: "1", lang: "uk" });
      try {
        await openSettings(p);
        check(`${B} 6: прежнее «1» — тумблер вкл`, await p.locator('[data-testid="pet-toggle"]').isChecked());
        const foot = await p.locator("#settings-pet-foot").textContent();
        check(`${B} 6: футер uk — «За замовчуванням увімкнено.»`, foot.includes("За замовчуванням увімкнено."), foot);
        check(`${B} 6: без ошибок страницы`, errs.filter((e) => !/\/api\//.test(e)).length === 0, errs.slice(0, 3).join(" | "));
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await b.close();
  }
}

const server = await serve(DIST, PORT);
try {
  for (const brn of BROWSERS) await run(brn);
} finally {
  server.close();
}
console.log(`\n${total - fails.length}/${total} PASS`);
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
