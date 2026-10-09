/**
 * PD-260 — Питомец B «Капля» на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit: живые проверки движения и кадры.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 4361 --strictPort
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend BASE=http://localhost:4361 node design/pd260-check.mjs
 *   (ONLY=cr|wk — один движок; кадры → design/pd260-shots/)
 *
 * Данные — настоящие партии движка (`design/pd260-seed.ts`) прямо в IndexedDB приложения до запуска; Питомец включён как
 * тумблером (localStorage `pundoku.pet = "1"`). «Решили сейчас» — живое решение последней клетки дня в UI.
 *
 * Проверки:
 *  - карточка: решили сейчас → `data-act="arrive"` (один раз, после входа карточки), посадка по настроению (760/900/860 мс);
 *    поза в движении не выходит за карточку (худший случай — «устал» 320 AX3); keyframes только transform/opacity;
 *    повторное открытие (решённый день из записи) — только покой; на поле кляксы нет;
 *  - покой: 3 вдоха (4,2 с) после действия, потом ни одной идущей анимации (живое ожидание ≈ 14 с в одном конфиге);
 *    вкладка скрыта → у кляксы нет анимаций; вернулись → покой заново, посадка не повторяется; фон (visibilitychange) — так же;
 *  - Reduce Motion: покоя нет, в каждой точке посадки/пробуждения transform тождественный (остаётся растворение 220/260 мс);
 *  - Year: «проснуться» (день показывался «спит», потом решён) один раз; повторный показ — покой;
 *  - 320 pt + AX3 (en/uk/ru): ни одна строка даты не заходит на кляксу; стресс — все 12 месяцев + AX5 (53 px);
 *    кадр «до фикса» (старые правила) для сравнения — информационный.
 * Никаких pkill: браузеры закрываются в finally.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PW_HOME = process.env.PD_PW_HOME || "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend";
function loadPlaywright() {
  for (const b of [process.cwd() + "/", PW_HOME + "/"]) {
    try {
      return createRequire(b)("playwright");
    } catch {
      /* следующий */
    }
  }
  console.error("Playwright не найден (cwd, " + PW_HOME + ") — задай PD_PW_HOME.");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();

const BASE = process.env.BASE ?? "http://localhost:4361";
const OUT = join(HERE, "pd260-shots");
const ONLY = process.env.ONLY;
if (ONLY && existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.startsWith(`${ONLY}-`)) rmSync(join(OUT, f));
if (!ONLY && !process.env.SMOKE) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localDate();
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
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const info = (name, extra) => console.log(`INFO  ${name}  ${extra}`);

async function open(browser, c, { days, firstUse = null, seen = null }) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
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
        if (seen) localStorage.setItem("pundoku.petSeen", JSON.stringify(seen));
      } catch {
        /* приватный режим */
      }
      if (fs) {
        const add = () => {
          const s = document.createElement("style");
          s.id = "pd260-type";
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
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::|Load failed|Could not connect/.test(m.text())) errs.push(m.text());
  });
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

// ---------------------------------------------------------------------------------------------------------- помощники в странице
/** Анимации кляксы: свойства keyframes, тайминги. */
const animsOf = (page, sel) =>
  page.evaluate((sel) => {
    const p = document.querySelector(sel);
    if (!p) return null;
    return p.getAnimations({ subtree: true }).map((a) => {
      const t = a.effect.getTiming();
      const props = new Set();
      for (const k of a.effect.getKeyframes()) for (const key of Object.keys(k)) props.add(key);
      return {
        name: a.animationName,
        state: a.playState,
        cls: a.effect.target.className,
        iterations: t.iterations,
        duration: t.duration,
        delay: t.delay,
        end: a.effect.getComputedTiming().endTime,
        props: [...props],
        ct: a.currentTime,
      };
    });
  }, sel);
/** Пауза всех анимаций кляксы в момент t (мс от начала, с задержками). */
const freeze = (page, sel, t) =>
  page.evaluate(
    ({ sel, t }) => {
      for (const a of document.querySelector(sel).getAnimations({ subtree: true })) {
        a.pause();
        a.currentTime = t;
      }
    },
    { sel, t },
  );
/** Рамки поз с учётом transform; рамка контейнера; transform всех слоёв кляксы. */
const poseGeo = (page, sel, boxSel) =>
  page.evaluate(
    ({ sel, boxSel }) => {
      const p = document.querySelector(sel);
      const box = p.closest(boxSel).getBoundingClientRect();
      // Чернила (тело позы и капельки) с учётом transform — не пустой квадрат слоя позы.
      const poses = [...p.querySelectorAll(".pose, .drop")]
        .filter((e) => Number(getComputedStyle(e).opacity) > 0.01)
        .map((e) => (e.classList.contains("pose") ? e.querySelector("path.pet-ink") : e).getBoundingClientRect())
        .map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }));
      const tf = [p, ...p.querySelectorAll(".breath, .pose, .drop")].map((e) => getComputedStyle(e).transform);
      return { box: { l: box.left, r: box.right, t: box.top, b: box.bottom }, poses, tf };
    },
    { sel, boxSel },
  );
const isIdentity = (m) => {
  if (!m || m === "none") return true;
  const v = (m.slice(m.indexOf("(")).match(/-?\d*\.?\d+(e-?\d+)?/g) || []).map(Number);
  if (m.startsWith("matrix3d"))
    return Math.abs(v[0] - 1) < 1e-3 && Math.abs(v[5] - 1) < 1e-3 && Math.abs(v[1]) < 1e-3 && Math.abs(v[4]) < 1e-3 && Math.abs(v[12]) < 0.01 && Math.abs(v[13]) < 0.01;
  return Math.abs(v[0] - 1) < 1e-3 && Math.abs(v[1]) < 1e-3 && Math.abs(v[2]) < 1e-3 && Math.abs(v[3] - 1) < 1e-3 && Math.abs(v[4]) < 0.01 && Math.abs(v[5]) < 0.01;
};
const inside = (g) => g.poses.every((r) => r.l >= g.box.l - 0.5 && r.r <= g.box.r + 0.5 && r.t >= g.box.t - 0.5);
const ONLY_TO = (props) => props.every((p) => ["offset", "computedOffset", "easing", "composite", "transform", "opacity"].includes(p));

/** Решить последнюю клетку дня в UI → «решили сейчас». */
async function solveLast(page, last) {
  await page.locator(".board button.cell").first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(500);
  await page.locator(`.board button.cell[data-i="${last.cell}"]`).click();
  await page.locator(".pad .key").nth(last.digit - 1).click();
}
/** Карточку — к верху экрана (кадр). */
const cardTop = (page) => page.evaluate(() => document.querySelector('[data-testid="result-card"]').scrollIntoView({ block: "start" }));
const clipCard = async (page) => {
  const b = await page.locator('[data-testid="result-card"]').boundingBox();
  return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(b.width + 16, page.viewportSize().width), height: 150 };
};
const PCT = (f) => String(Math.round(f * 100)).padStart(3, "0");

// ---------------------------------------------------------------------------------------------------------- карточка результата
async function cardRun(browser, name, c, mood, { frames = [], final = true } = {}) {
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}`;
  const P = SEED.pending[mood];
  const { ctx, page, errs } = await open(browser, c, { days: P.days });
  const sel = '[data-testid="pet-card"] .pet';
  try {
    await page.goto(`${BASE}/#/today`);
    await solveLast(page, P.last);
    await page.locator(`${sel}[data-act="arrive"]`).waitFor({ timeout: 15000 });
    await freeze(page, sel, 0); // ловим посадку до начала (задержка 300 мс)
    const got = await page.locator(sel).getAttribute("data-mood");
    ok(`${tag}: решили сейчас → посадка (${mood})`, got === mood, got ?? "");
    ok(`${tag}: на поле кляксы нет`, (await page.locator(".board .pet, .mini .pet, [data-testid='grid-inf-section'] .pet").count()) === 0);
    const box = await page.locator(sel).boundingBox();
    ok(`${tag}: размер 44 pt`, Math.round(box.width) === 44, String(box.width));
    const A = await animsOf(page, sel);
    const D = c.rm ? DUR_RM.arrive : DUR.arrive[mood];
    const pose = A.find((a) => a.cls.includes("pose to"));
    ok(`${tag}: посадка ${D} мс после задержки 300`, pose && Math.round(pose.duration) === D && Math.round(pose.delay) === DELAY, pose ? `${pose.name} ${pose.duration}/${pose.delay}` : "нет");
    ok(`${tag}: keyframes — только transform/opacity`, A.every((a) => ONLY_TO(a.props)), A.map((a) => `${a.name}:${a.props}`).join(" "));
    const breath = A.find((a) => a.cls === "breath");
    if (c.rm) ok(`${tag}: RM — покоя нет`, !breath, breath ? breath.name : "");
    else
      ok(
        `${tag}: покой — 3 вдоха 4,2 с после посадки`,
        breath && breath.iterations === 3 && Math.round(breath.duration) === 4200 && Math.round(breath.delay) === DELAY + D,
        breath ? `${breath.iterations}×${breath.duration} delay ${breath.delay}` : "нет",
      );
    // Все точки посадки: поза внутри карточки; при RM — тождественный transform.
    await cardTop(page);
    let out = 0;
    let moved = 0;
    for (const f of [...new Set([0, 0.1, 0.26, 0.35, 0.44, 0.55, 0.68, 0.8, 0.9, 1, ...frames])].sort((a, b) => a - b)) {
      await freeze(page, sel, DELAY + f * D);
      const g = await poseGeo(page, sel, ".card");
      if (!inside(g)) out++;
      if (!g.tf.every(isIdentity)) moved++;
      if (frames.includes(f)) await page.screenshot({ path: join(OUT, `${tag}-arrive-${mood}-${PCT(f)}.png`), clip: await clipCard(page) });
    }
    ok(`${tag}: поза в движении внутри карточки`, out === 0, `${out} точек вне`);
    if (c.rm) ok(`${tag}: RM — в каждой точке transform тождественный`, moved === 0, `${moved} точек со сдвигом`);
    else ok(`${tag}: без RM — капля движется`, moved > 5, `${moved} точек`);
    // Конец: 3 вдоха прошли → стоит.
    const endT = c.rm ? DELAY + D + 10 : DELAY + D + 3 * 4200 + 10;
    await freeze(page, sel, endT);
    const g = await poseGeo(page, sel, ".card");
    ok(`${tag}: после покоя стоит (тождественный transform)`, g.tf.every(isIdentity), g.tf.filter((t) => !isIdentity(t)).join(" "));
    // Заголовок не под кляксой.
    const overlap = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="pet-card"] .pet').getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("#result-title"));
      return [...r.getClientRects()].some((t) => t.right > p.left + 1 && t.top < p.bottom - 1 && t.bottom > p.top + 1);
    });
    ok(`${tag}: заголовок не под кляксой`, !overlap);
    if (final) await page.screenshot({ path: join(OUT, `${tag}-card-${mood}.png`) });

    ok(`${tag}: карточка ${mood} без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

/** Живое время (без пауз и перемоток): посадка → 3 вдоха → ни одной идущей анимации. */
async function cardLive(browser, name, c, mood) {
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}`;
  const P = SEED.pending[mood];
  const { ctx, page, errs } = await open(browser, c, { days: P.days });
  const sel = '[data-testid="pet-card"] .pet';
  const D = DUR.arrive[mood];
  try {
    await page.goto(`${BASE}/#/today`);
    await solveLast(page, P.last);
    await page.locator(`${sel}[data-act="arrive"]`).waitFor({ timeout: 15000 });
    const t0 = Date.now();
    await page.waitForTimeout(1600);
    const mid = await animsOf(page, sel);
    ok(
      `${tag}: живьём через 1,6 с — посадка закончилась, идут вдохи`,
      mid.some((a) => a.cls === "breath" && a.state === "running") && mid.every((a) => a.cls === "breath" || a.state === "finished"),
      mid.map((a) => `${a.name}:${a.state}`).join(" "),
    );
    await page.waitForTimeout(Math.max(0, DELAY + D + 3 * 4200 + 1000 - (Date.now() - t0)));
    const after = await animsOf(page, sel);
    ok(`${tag}: живьём через ≈${((DELAY + D + 13600) / 1000).toFixed(1)} с — ни одной идущей анимации (3 вдоха и стоит)`, after.every((a) => a.state !== "running"), after.map((a) => `${a.name}:${a.state}`).join(" "));
    ok(`${tag}: живьём без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

/** Скрытая вкладка посреди посадки → ни одной анимации; вернулись → покой заново, посадка не повторяется; фон — так же. */
async function cardTab(browser, name, c) {
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}`;
  const P = SEED.pending.happy;
  const { ctx, page, errs } = await open(browser, c, { days: P.days });
  const sel = '[data-testid="pet-card"] .pet';
  try {
    await page.goto(`${BASE}/#/today`);
    await solveLast(page, P.last);
    await page.locator(`${sel}[data-act="arrive"]`).waitFor({ timeout: 15000 });
    await page.waitForTimeout(450); // посреди посадки
    await page.locator("#tab-play").click();
    await page.waitForTimeout(500);
    const hidden = await animsOf(page, sel);
    ok(`${tag}: вкладка скрыта посреди посадки — у кляксы нет анимаций`, hidden.length === 0, hidden.map((a) => `${a.name}:${a.state}`).join(" "));
    ok(`${tag}: вкладка скрыта — data-still, без действия`, (await page.locator(`${sel}[data-still]:not([data-act])`).count()) === 1);
    await page.locator("#tab-today").click();
    await page.waitForTimeout(400);
    const back = await animsOf(page, sel);
    const act = await page.locator(sel).getAttribute("data-act");
    ok(
      `${tag}: вернулись — покой заново, посадка не повторяется`,
      act === null && back.length === 1 && back[0].cls === "breath" && back[0].state === "running" && back[0].ct < 1500 && back[0].iterations === 3,
      back.map((a) => `${a.name}@${Math.round(a.ct)}`).join(" "),
    );
    // Приложение в фоне (эмуляция visibilitychange — WebKit на iPhone и сам гасит анимации фона): стоит; вернулось — покой заново.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(200);
    const bg = await animsOf(page, sel);
    ok(`${tag}: фон — у кляксы нет анимаций`, bg.length === 0, bg.map((a) => a.name).join(" "));
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    const fg = await animsOf(page, sel);
    ok(`${tag}: из фона — покой заново`, fg.length === 1 && fg[0].cls === "breath" && fg[0].state === "running", fg.map((a) => `${a.name}:${a.state}`).join(" "));
    ok(`${tag}: вкладки/фон без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

/** Повторное открытие решённого дня: только покой. */
async function cardReopen(browser, name, c) {
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;
  const { ctx, page, errs } = await open(browser, c, { days: SEED.solved.tired });
  const sel = '[data-testid="pet-card"] .pet';
  try {
    await page.goto(`${BASE}/#/today`);
    await page.locator(sel).waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    ok(`${tag}: решённый день из записи — без посадки`, (await page.locator(sel).getAttribute("data-act")) === null);
    const A = await animsOf(page, sel);
    ok(`${tag}: решённый день — ${c.rm ? "RM: без анимаций" : "только покой (3 вдоха)"}`, c.rm ? A.length === 0 : A.length === 1 && A[0].iterations === 3, A.map((a) => `${a.name}×${a.iterations}`).join(" "));
    ok(`${tag}: повторное открытие без ошибок`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------------------- Year
async function gotoDay(page, date) {
  const month = Number(date.slice(5, 7)) - 1;
  if ((await page.locator('[data-testid="year-sheet"]').count()) === 0) await page.locator(`.year-month[data-month="${month}"]`).click();
  else if ((await page.locator('[data-testid="year-sheet"][data-page="day"]').count()) > 0) await page.locator(".ysheet .back").click();
  await page.locator('[data-testid="month-page"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator(`.ycell[data-date="${date}"]`).click();
  await page.locator('[data-testid="pet-year"] .pet').waitFor({ timeout: 10000 });
}
/** Строки даты против кляксы: ни одна строка не заходит на рамку кляксы (40 pt). */
const dateVsPet = (page) =>
  page.evaluate(() => {
    const h = document.querySelector('[data-testid="day-card"] .dc-head h3');
    const p = document.querySelector('[data-testid="pet-year"] .pet').getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(h);
    const lines = [...r.getClientRects()];
    const hit = lines.some((t) => t.right > p.left - 0.5 && t.top < p.bottom && t.bottom > p.top);
    const right = Math.max(...lines.map((t) => t.right));
    return { hit, gap: p.left - right, lines: lines.length, text: h.textContent };
  });

async function yearRun(browser, name, c, { moods = ["asleep", "happy"], wake = false, stress = false, before = false } = {}) {
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}`;
  const first = SEED.year.map((d) => d.date).sort()[0];
  const { ctx, page, errs } = await open(browser, c, { days: SEED.year, firstUse: first, seen: { [SEED.dates.wake]: "asleep" } });
  const sel = '[data-testid="pet-year"] .pet';
  try {
    await page.goto(`${BASE}/#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    ok(`${tag}: полотно Year без клякс`, (await page.locator(".pet").count()) === 0);
    for (const mood of moods) {
      await gotoDay(page, SEED.dates[mood]);
      await page.waitForTimeout(450);
      const got = await page.locator(sel).getAttribute("data-mood");
      ok(`${tag}: Year — ${mood}`, got === mood, got ?? "");
      ok(`${tag}: Year ${mood} — без перехода`, (await page.locator(sel).getAttribute("data-act")) === null);
      const g = await dateVsPet(page);
      ok(`${tag}: Year ${mood} — дата не наезжает на кляксу`, !g.hit && g.gap >= 0, `gap=${g.gap.toFixed(1)} lines=${g.lines} «${g.text}»`);
      // Поза внутри шита (покой во всех точках).
      await freeze(page, sel, 2100);
      ok(`${tag}: Year ${mood} — покой внутри шита`, inside(await poseGeo(page, sel, ".ysheet")));
      await page.screenshot({ path: join(OUT, `${tag}-year-${mood}.png`) });
    }
    if (wake) {
      await gotoDay(page, SEED.dates.wake);
      const act = await page.locator(sel).getAttribute("data-act");
      await freeze(page, sel, 0);
      ok(`${tag}: Year — день показывался «спит», решён → «проснуться»`, act === "wake", act ?? "");
      const A = await animsOf(page, sel);
      const D = c.rm ? DUR_RM.wake : DUR.wake;
      const to = A.find((a) => a.cls.includes("pose to"));
      ok(`${tag}: пробуждение ${D} мс; только transform/opacity`, to && Math.round(to.duration) === D && A.every((a) => ONLY_TO(a.props)), to ? `${to.name} ${to.duration}` : "нет");
      let out = 0;
      let moved = 0;
      for (const f of [0, 0.2, 0.35, 0.5, 0.58, 0.66, 0.8, 0.9, 1]) {
        await freeze(page, sel, f * D);
        const g = await poseGeo(page, sel, ".ysheet");
        if (!inside(g)) out++;
        if (!g.tf.every(isIdentity)) moved++;
        if ([0, 0.35, 0.58, 0.8, 1].includes(f)) await page.screenshot({ path: join(OUT, `${tag}-wake-${PCT(f)}.png`) });
      }
      ok(`${tag}: пробуждение внутри шита`, out === 0, `${out} вне`);
      if (c.rm) ok(`${tag}: RM — пробуждение без сдвигов (растворение)`, moved === 0, `${moved}`);
      else ok(`${tag}: пробуждение движется`, moved > 4, `${moved}/9`);
      await page.locator(".ysheet .back").click();
      await page.locator('[data-testid="month-page"]').waitFor();
      await page.waitForTimeout(350);
      await page.locator(`.ycell[data-date="${SEED.dates.wake}"]`).click();
      await page.locator(sel).waitFor();
      ok(`${tag}: повторный показ — только покой`, (await page.locator(sel).getAttribute("data-act")) === null);
    }
    if (stress) {
      // Самые длинные даты: все 12 месяцев (формат dayLong — короткий день недели, число, полный месяц), AX3 и AX5.
      await gotoDay(page, SEED.dates.asleep);
      for (const fs of [40, 53]) {
        await page.evaluate((fs) => (document.getElementById("pd260-type").textContent = `html{font-size:${fs}px !important}`), fs);
        await page.waitForTimeout(250);
        const bad = await page.evaluate((lang) => {
          const h = document.querySelector('[data-testid="day-card"] .dc-head h3');
          const p = document.querySelector('[data-testid="pet-year"] .pet').getBoundingClientRect();
          const out = [];
          for (let m = 0; m < 12; m++)
            for (const day of [3, 30]) {
              const d = new Date(2026, m, Math.min(day, 28 + (m === 1 ? 0 : 2)));
              const parts = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "long" }).formatToParts(d);
              const pick = (t) => parts.find((x) => x.type === t)?.value ?? "";
              h.textContent = [pick("weekday"), pick("day"), pick("month")].filter(Boolean).join(" ");
              const r = document.createRange();
              r.selectNodeContents(h);
              const pp = document.querySelector('[data-testid="pet-year"] .pet').getBoundingClientRect();
              if ([...r.getClientRects()].some((t) => t.right > pp.left - 0.5 && t.top < pp.bottom && t.bottom > pp.top)) out.push(h.textContent);
            }
          void p;
          return out;
        }, c.lang);
        ok(`${tag}: стресс ${fs === 40 ? "AX3" : "AX5"} — ни одна дата года не заходит на кляксу`, bad.length === 0, bad.join(", "));
      }
      // Кадр самой длинной даты на AX3 (uk «листопада», en «September»): после фикса.
      const longest = { uk: new Date(2026, 10, 30), ru: new Date(2026, 8, 30), en: new Date(2026, 8, 30) }[c.lang];
      await page.evaluate(
        ({ lang, t }) => {
          document.getElementById("pd260-type").textContent = "html{font-size:40px !important}";
          const parts = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "long" }).formatToParts(new Date(t));
          const pick = (x) => parts.find((p) => p.type === x)?.value ?? "";
          document.querySelector('[data-testid="day-card"] .dc-head h3').textContent = [pick("weekday"), pick("day"), pick("month")].join(" ");
        },
        { lang: c.lang, t: longest.getTime() },
      );
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `${tag}-year-longest.png`) });
      if (before) {
        // AX5 (53 px): самое длинное слово даты шире колонки. После фикса — переносится и не заходит на кляксу; «до фикса»
        // (старые правила: зазор 12, без переноса слова) — для сравнения, не проверка.
        await page.evaluate(() => (document.getElementById("pd260-type").textContent = "html{font-size:53px !important}"));
        await page.waitForTimeout(250);
        const after = await dateVsPet(page);
        ok(`${tag}: AX5 самая длинная дата — не заходит на кляксу`, !after.hit, `gap=${after.gap.toFixed(1)} lines=${after.lines}`);
        await page.screenshot({ path: join(OUT, `${tag}-year-longest-ax5.png`) });
        await page.addStyleTag({ content: ".daycard .dc-head{gap:12px !important}.daycard .dc-head h3{overflow-wrap:normal !important}" });
        await page.waitForTimeout(200);
        const g = await dateVsPet(page);
        info(`${tag}: до фикса, AX5 — самая длинная дата`, `наезд=${g.hit} gap=${g.gap.toFixed(1)} «${g.text}»`);
        await page.screenshot({ path: join(OUT, `${tag}-year-longest-ax5-before.png`) });
      }
    }
    ok(`${tag}: Year без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------------------- матрица
const H = { 320: 568, 393: 852, 430: 932 };
const cfg = (w, scheme, extra = {}) => ({ w, h: H[w], scheme, lang: "en", ...extra });

async function runEngine(name, type) {
  const browser = await type.launch();
  const guard = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      ok(`${name} ${label}: прогон без исключений`, false, String(e).split("\n")[0]);
    }
  };
  try {
    if (process.env.SMOKE) {
      // Быстрый прогон одного движка: посадка + Year с пробуждением + AX3 uk (без матрицы кадров).
      await guard("smoke card", () => cardRun(browser, name, cfg(393, "light"), "tired", { frames: [0.46] }));
      await guard("smoke tab", () => cardTab(browser, name, cfg(393, "light")));
      if (process.env.SMOKE === "live") await guard("smoke live", () => cardLive(browser, name, cfg(393, "light"), "tired"));
      await guard("smoke year", () => yearRun(browser, name, cfg(393, "light"), { wake: true }));
      await guard("smoke ax3", () => yearRun(browser, name, cfg(320, "light", { lang: "uk", ax3: true }), { moods: ["asleep"], stress: true, before: true }));
      return;
    }
    // 1. Ширины × темы: посадка «доволен» + кадр карточки; Year «спит»/«доволен».
    for (const w of [320, 393, 430])
      for (const scheme of ["light", "dark"]) {
        const c = cfg(w, scheme);
        await guard(`card ${w} ${scheme}`, () => cardRun(browser, name, c, "happy", { frames: w === 393 && scheme === "light" ? [0, 0.26, 0.44, 0.68, 1] : [] }));
        await guard(`year ${w} ${scheme}`, () => yearRun(browser, name, c, { wake: w === 393 }));
      }
    // 2. Посадка «устал» / «удивлён» (раскадровка), живое время покоя, скрытая вкладка/фон; повторное открытие.
    await guard("card tired", () => cardRun(browser, name, cfg(393, "light"), "tired", { frames: [0, 0.26, 0.46, 0.76, 1] }));
    await guard("card live", () => cardLive(browser, name, cfg(393, "light"), "tired"));
    await guard("card tab", () => cardTab(browser, name, cfg(393, "light")));
    await guard("card surprised", () => cardRun(browser, name, cfg(393, "dark"), "surprised", { frames: [0, 0.26, 0.42, 0.62, 0.8, 1] }));
    await guard("reopen", () => cardReopen(browser, name, cfg(393, "light")));
    await guard("year all moods", () => yearRun(browser, name, cfg(393, "light", { lang: "ru" }), { moods: ["happy", "asleep", "tired", "surprised"] }));
    // 3. Reduce Motion.
    await guard("rm card", () => cardRun(browser, name, cfg(393, "light", { rm: true }), "tired", { frames: [0, 0.5, 1] }));
    await guard("rm reopen", () => cardReopen(browser, name, cfg(393, "light", { rm: true })));
    await guard("rm year", () => yearRun(browser, name, cfg(320, "dark", { rm: true }), { wake: true }));
    // 4. 320 pt + AX3: Year «спит» en/uk/ru (+ стресс и «до фикса» для uk), худшая посадка карточки.
    for (const lang of ["en", "uk", "ru"]) await guard(`ax3 year ${lang}`, () => yearRun(browser, name, cfg(320, "light", { lang, ax3: true }), { moods: ["asleep", "happy"], stress: true, before: lang === "uk" }));
    await guard("ax3 year dark", () => yearRun(browser, name, cfg(320, "dark", { ax3: true }), { moods: ["asleep"] }));
    await guard("ax3 card tired", () => cardRun(browser, name, cfg(320, "light", { ax3: true }), "tired", { frames: [0.46] }));
  } finally {
    await browser.close();
  }
}

for (const [name, type] of [
  ["cr", chromium],
  ["wk", webkit],
]) {
  if (ONLY && ONLY !== name) continue;
  await runEngine(name, type);
}

const fails = results.filter((r) => !r.cond);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
for (const f of fails) console.log("  FAIL " + f.name);
process.exit(fails.length ? 1 : 0);
