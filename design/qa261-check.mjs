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

// ---------------------------------------------------------------- помощники в странице
/** Все анимации документа: где (внутри кляксы sel или нет), свойства keyframes, конечность. */
const allAnims = (page, sel) =>
  page.evaluate((sel) => {
    const pet = sel ? document.querySelector(sel) : null;
    return document.getAnimations().map((a) => {
      const tg = a.effect?.target;
      const props = new Set();
      for (const k of a.effect?.getKeyframes?.() ?? []) for (const key of Object.keys(k)) props.add(key);
      const t = a.effect?.getTiming?.() ?? {};
      return {
        name: a.animationName ?? a.id ?? "",
        state: a.playState,
        inPet: !!(pet && tg && pet.contains(tg)),
        isPet: !!(tg && tg.closest && tg.closest(".pet")),
        connected: !!(tg && tg.isConnected),
        cls: tg ? String(tg.className?.baseVal ?? tg.className ?? tg.tagName) : "",
        iterations: t.iterations,
        duration: t.duration,
        delay: t.delay,
        props: [...props],
      };
    });
  }, sel);
const petAnims = async (page, sel) => (await allAnims(page, sel)).filter((a) => a.inPet);
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
/** Чернила (тело + капельки) с учётом transform; transform всех слоёв; рамки текста, на который нельзя заезжать. */
const geo = (page, sel, boxSel, textSels) =>
  page.evaluate(
    ({ sel, boxSel, textSels }) => {
      const p = document.querySelector(sel);
      const box = p.closest(boxSel).getBoundingClientRect();
      const ink = [...p.querySelectorAll(".pose, .drop")]
        .filter((e) => Number(getComputedStyle(e).opacity) > 0.01)
        .map((e) => (e.classList.contains("pose") ? e.querySelector("path.pet-ink") : e).getBoundingClientRect());
      const tf = [p, ...p.querySelectorAll(".breath, .pose, .drop")].map((e) => getComputedStyle(e).transform);
      const lines = [];
      for (const s of textSels) {
        const el = document.querySelector(s);
        if (!el) continue;
        const r = document.createRange();
        r.selectNodeContents(el);
        for (const q of r.getClientRects()) if (q.width > 0.5) lines.push(q);
      }
      const hit = ink.some((k) => lines.some((l) => l.right > k.left + 0.5 && l.left < k.right - 0.5 && l.bottom > k.top + 0.5 && l.top < k.bottom - 0.5));
      const out = ink.some((k) => k.left < box.left - 0.5 || k.right > box.right + 0.5 || k.top < box.top - 0.5 || k.bottom > box.bottom + 0.5);
      return { hit, out, tf, n: ink.length };
    },
    { sel, boxSel, textSels },
  );
const isIdentity = (m) => {
  if (!m || m === "none") return true;
  const v = (m.slice(m.indexOf("(")).match(/-?\d*\.?\d+(e-?\d+)?/g) || []).map(Number);
  if (m.startsWith("matrix3d")) return Math.abs(v[0] - 1) < 1e-3 && Math.abs(v[5] - 1) < 1e-3 && Math.abs(v[1]) < 1e-3 && Math.abs(v[4]) < 1e-3 && Math.abs(v[12]) < 0.01 && Math.abs(v[13]) < 0.01;
  return Math.abs(v[0] - 1) < 1e-3 && Math.abs(v[1]) < 1e-3 && Math.abs(v[2]) < 1e-3 && Math.abs(v[3] - 1) < 1e-3 && Math.abs(v[4]) < 0.01 && Math.abs(v[5]) < 0.01;
};
const ONLY_TO = (props) => props.every((p) => ["offset", "computedOffset", "easing", "composite", "transform", "opacity"].includes(p));

async function solveLast(page, last) {
  await page.locator(".board button.cell").first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(500);
  await page.locator(`.board button.cell[data-i="${last.cell}"]`).click();
  await page.locator(".pad .key").nth(last.digit - 1).click();
}
const tagOf = (bn, c, extra = "") => `${bn}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}${extra}`;
const CARD = '[data-testid="pet-card"] .pet';
const YEAR = '[data-testid="pet-year"] .pet';

// ---------------------------------------------------------------- card
const CARD_CFG = [
  { w: 320, h: 568, scheme: "light", lang: "en", ax3: true, mood: "tired" },
  { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true, mood: "surprised" },
  { w: 360, h: 780, scheme: "light", lang: "ru", mood: "happy" },
  { w: 375, h: 667, scheme: "dark", lang: "en", ax3: true, mood: "happy" },
  { w: 393, h: 852, scheme: "light", lang: "uk", mood: "tired" },
  { w: 414, h: 896, scheme: "dark", lang: "ru", mood: "surprised" },
  { w: 430, h: 932, scheme: "light", lang: "en", mood: "happy" },
  { w: 393, h: 852, scheme: "light", lang: "en", rm: true, mood: "tired" },
  { w: 320, h: 568, scheme: "dark", lang: "ru", ax3: true, rm: true, mood: "surprised" },
];
async function cardCase(browser, bn, c) {
  const tag = tagOf(bn, c, `-${c.mood}`);
  const P = SEED.pending[c.mood];
  const { ctx, page, errs } = await open(browser, c, { days: P.days });
  try {
    await page.goto(`${BASE}/#/today`);
    await solveLast(page, P.last);
    await page.locator(`${CARD}[data-act="arrive"]`).waitFor({ timeout: 15000 });
    // Всё, что анимируется в документе в момент посадки.
    const all = await allAnims(page, CARD);
    await freeze(page, CARD, 0);
    const pet = all.filter((a) => a.inPet);
    const strayPet = all.filter((a) => a.isPet && !a.inPet);
    ok(`${tag}: посадка, настроение ${c.mood}`, (await page.locator(CARD).getAttribute("data-mood")) === c.mood);
    ok(`${tag}: одна клякса на экране, на поле нет`, (await page.locator(".pet").count()) === 1 && (await page.locator(".board .pet").count()) === 0);
    ok(`${tag}: анимации кляксы только у кляксы карточки (нет «чужих» .pet)`, strayPet.length === 0, strayPet.map((a) => a.name).join(" "));
    ok(`${tag}: keyframes кляксы — только transform/opacity`, pet.length > 0 && pet.every((a) => ONLY_TO(a.props)), pet.map((a) => `${a.name}:${a.props.join("/")}`).join(" "));
    ok(`${tag}: все анимации кляксы конечные`, pet.every((a) => Number.isFinite(a.iterations) && a.iterations <= 3), pet.map((a) => `${a.name}×${a.iterations}`).join(" "));
    const other = all.filter((a) => !a.isPet && a.state === "running");
    info(`${tag}: прочие анимации документа в момент посадки`, other.map((a) => `${a.cls.split(" ")[0]}:${a.name}×${a.iterations}`).join(" ") || "нет");
    ok(`${tag}: вне кляксы нет бесконечных анимаций`, other.every((a) => Number.isFinite(a.iterations)), other.filter((a) => !Number.isFinite(a.iterations)).map((a) => a.cls + ":" + a.name).join(" "));
    const D = c.rm ? DUR_RM.arrive : DUR.arrive[c.mood];
    const breath = pet.find((a) => a.cls === "breath");
    if (c.rm) ok(`${tag}: RM — без покоя, посадка ${D} мс`, !breath && pet.some((a) => a.cls.includes("pose to") && Math.round(a.duration) === D));
    else ok(`${tag}: покой 3×4200 после посадки ${D}`, breath && breath.iterations === 3 && Math.round(breath.duration) === 4200 && Math.round(breath.delay) === DELAY + D, breath && `${breath.iterations}×${breath.duration}+${breath.delay}`);
    await page.evaluate((s) => document.querySelector(s).closest(".card").scrollIntoView({ block: "start" }), CARD);
    let out = 0,
      hit = 0,
      moved = 0;
    const T = [];
    for (let f = 0; f <= 1.0001; f += 0.05) T.push(DELAY + f * D);
    if (!c.rm) for (let t = DELAY + D; t <= DELAY + D + 12600; t += 525) T.push(t);
    for (const t of T) {
      await freeze(page, CARD, t);
      const g = await geo(page, CARD, ".card", ["#result-title", '[data-testid="result-card"] > .sub']);
      if (g.out) out++;
      if (g.hit) hit++;
      if (!g.tf.every(isIdentity)) moved++;
    }
    ok(`${tag}: чернила внутри карточки во всех ${T.length} точках`, out === 0, `${out} вне`);
    ok(`${tag}: чернила не на заголовке/подписи во всех точках`, hit === 0, `${hit} наложений`);
    if (c.rm) ok(`${tag}: RM — transform тождественный во всех точках`, moved === 0, `${moved}`);
    else ok(`${tag}: без RM — движение есть`, moved > 10, `${moved}`);
    await freeze(page, CARD, DELAY + D + (c.rm ? 0 : 12600) + 20);
    const end = await geo(page, CARD, ".card", []);
    ok(`${tag}: после покоя — тождественный transform`, end.tf.every(isIdentity), end.tf.filter((x) => !isIdentity(x)).join(" "));
    await page.screenshot({ path: join(OUT, `${tag}-card.png`) });
    ok(`${tag}: без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- live
async function liveCase(browser, bn, c) {
  const tag = tagOf(bn, c, "-live");
  const P = SEED.pending.happy;
  const { ctx, page, errs } = await open(browser, c, { days: P.days });
  try {
    await page.goto(`${BASE}/#/today`);
    await solveLast(page, P.last);
    await page.locator(`${CARD}[data-act="arrive"]`).waitFor({ timeout: 15000 });
    const t0 = Date.now();
    let cdp = null;
    if (bn === "cr") {
      cdp = await ctx.newCDPSession(page);
      await cdp.send("Performance.enable");
    }
    const metrics = async () => {
      if (!cdp) return null;
      const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
      return { style: m.RecalcStyleCount, layout: m.LayoutCount, task: m.TaskDuration };
    };
    await page.waitForTimeout(3000);
    const m1 = await metrics();
    await page.waitForTimeout(2000);
    const m2 = await metrics();
    await page.waitForTimeout(Math.max(0, DELAY + DUR.arrive.happy + 12600 + 900 - (Date.now() - t0)));
    const after = await petAnims(page, CARD);
    ok(`${tag}: через ${((Date.now() - t0) / 1000).toFixed(1)} с живьём — у кляксы ни одной идущей анимации`, after.every((a) => a.state !== "running"), after.map((a) => `${a.name}:${a.state}`).join(" "));
    const allRun = (await allAnims(page, CARD)).filter((a) => a.state === "running");
    ok(`${tag}: во всём документе Today после замирания — ни одной идущей анимации`, allRun.length === 0, allRun.map((a) => `${a.cls.split(" ")[0]}:${a.name}`).join(" "));
    if (cdp) {
      const m3 = await metrics();
      await page.waitForTimeout(3000);
      const m4 = await metrics();
      const d = (a, b) => ({ style: b.style - a.style, layout: b.layout - a.layout, taskMs: Math.round((b.task - a.task) * 1000) });
      info(`${tag}: CDP за 2 с вдохов`, d(m1, m2));
      const still = d(m3, m4);
      info(`${tag}: CDP за 3 с после замирания`, still);
      ok(`${tag}: после замирания главный поток не работает на кляксу (стили ≤ 2, layout ≤ 2, задачи < 30 мс за 3 с)`, still.style <= 2 && still.layout <= 2 && still.taskMs < 30, still);
    }
    // RM переключили на лету посреди покоя: амплитуда через --mo → тождественный transform.
    await page.locator("#tab-play").click();
    await page.waitForTimeout(400);
    await page.locator("#tab-today").click();
    await page.waitForTimeout(800);
    const again = await petAnims(page, CARD);
    ok(`${tag}: вернулись на Today — покой заново (1 вдох-анимация, ×3), посадки нет`, again.length === 1 && again[0].cls === "breath" && again[0].iterations === 3 && (await page.locator(`${CARD}[data-act]`).count()) === 0, again.map((a) => `${a.cls}:${a.name}`).join(" "));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(300);
    let moved = 0;
    for (const t of [500, 1100, 2100, 3200, 5000, 9000]) {
      await freeze(page, CARD, t);
      const g = await geo(page, CARD, ".card", []);
      if (!g.tf.every(isIdentity)) moved++;
    }
    ok(`${tag}: RM включили на лету — покой тождественный (клякса стоит)`, moved === 0, `${moved}`);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // 8 быстрых переключений вкладок — анимации не копятся, посадка не повторяется.
    for (let i = 0; i < 8; i++) {
      await page.locator(i % 2 ? "#tab-today" : "#tab-year").click();
      await page.waitForTimeout(120);
    }
    await page.locator("#tab-today").click();
    await page.waitForTimeout(700);
    const burst = await allAnims(page, CARD);
    const petRun = burst.filter((a) => a.isPet);
    ok(`${tag}: после 8 быстрых переключений — у кляксы ≤ 1 анимации (вдох), ничего на отсоединённых`, petRun.length <= 1 && petRun.every((a) => a.cls === "breath") && burst.every((a) => a.connected), petRun.map((a) => `${a.cls}:${a.state}`).join(" "));
    ok(`${tag}: посадка не повторилась`, (await page.locator(`${CARD}[data-act]`).count()) === 0);
    ok(`${tag}: без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- leak
async function gotoDay(page, date) {
  const month = Number(date.slice(5, 7)) - 1;
  if ((await page.locator('[data-testid="year-sheet"]').count()) === 0 && (await page.locator('[data-testid="month-page"]').count()) === 0) await page.locator(`.year-month[data-month="${month}"]`).click();
  else if ((await page.locator('[data-testid="year-sheet"][data-page="day"]').count()) > 0) await page.locator(".ysheet .back").click();
  await page.locator('[data-testid="month-page"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator(`.ycell[data-date="${date}"]`).click();
  await page.locator(YEAR).waitFor({ timeout: 10000 });
  await page.waitForTimeout(350);
}
async function leakCase(browser, bn, c) {
  const tag = tagOf(bn, c, "-leak");
  const first = SEED.year.map((d) => d.date).sort()[0];
  const { ctx, page, errs } = await open(browser, c, { days: [...SEED.solved.happy, ...SEED.year], firstUse: first });
  try {
    await page.goto(`${BASE}/#/today`);
    await page.locator(CARD).waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    ok(`${tag}: Today решён из записи — без посадки, покой`, (await page.locator(`${CARD}[data-act]`).count()) === 0 && (await petAnims(page, CARD)).length === 1);
    // Settings поверх Today.
    await page.locator('[data-testid="open-settings"]').first().click();
    await page.locator('[data-testid="settings-screen"]').waitFor();
    await page.waitForTimeout(700);
    const A = await allAnims(page, null);
    const cardPet = A.filter((a) => a.isPet && a.cls && a.connected).filter(() => true);
    const underCard = await page.evaluate((s) => {
      const p = document.querySelector(s);
      return p ? { still: p.hasAttribute("data-still"), n: p.getAnimations({ subtree: true }).length } : null;
    }, CARD);
    info(`${tag}: Settings поверх Today — клякса карточки`, underCard);
    ok(`${tag}: Settings поверх Today — клякса карточки без анимаций`, !underCard || underCard.n === 0, underCard);
    const prev = await page.evaluate(() => [...document.querySelectorAll('[data-testid="pet-moods"] .pet')].map((p) => p.getAnimations({ subtree: true }).map((a) => `${a.animationName}×${a.effect.getTiming().iterations}`)));
    info(`${tag}: превью в Настройках — анимации`, prev);
    ok(`${tag}: превью в Настройках — анимации конечные (без бесконечного дыхания)`, prev.flat().every((s) => !/Infinity/.test(s)), prev.flat().join(" "));
    await page.screenshot({ path: join(OUT, `${tag}-settings.png`) });
    await page.locator('[data-testid="settings-back"]').click();
    await page.waitForTimeout(700);
    void cardPet;
    // Year: открыть лист дня, закрыть — ничего не висит на отсоединённых элементах.
    await page.locator("#tab-year").click();
    await page.locator(".year-month").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const todayHidden = await page.evaluate((s) => document.querySelector(s)?.getAnimations({ subtree: true }).length ?? 0, CARD);
    ok(`${tag}: Today ушёл под Year — у кляксы карточки 0 анимаций`, todayHidden === 0, String(todayHidden));
    await gotoDay(page, SEED.dates.happy);
    const yA = await petAnims(page, YEAR);
    ok(`${tag}: лист дня — один покой ×3`, yA.length === 1 && yA[0].iterations === 3, yA.map((a) => `${a.cls}:${a.name}×${a.iterations}`).join(" "));
    await page.locator(".ysheet .done").click();
    await page.waitForTimeout(900);
    const rest = await allAnims(page, null);
    ok(`${tag}: лист закрыт — кляксы Year нет, анимаций на отсоединённых нет`, (await page.locator('[data-testid="pet-year"]').count()) === 0 && rest.every((a) => a.connected), rest.filter((a) => !a.connected).map((a) => a.name).join(" "));
    // Year → Play с открытым листом дня.
    await gotoDay(page, SEED.dates.tired);
    // Лист модальный и перекрывает таб-бар (z-index 50) — тапом не уйти; уход на Play через роут (хэш), как жест «назад»/ссылка.
    await page.evaluate(() => { location.hash = "#/play"; });
    await page.waitForTimeout(700);
    const yHidden = await page.evaluate((s) => [...document.querySelectorAll(s)].map((p) => p.getAnimations({ subtree: true }).length), YEAR);
    ok(`${tag}: Year с листом ушёл под Play — у кляксы листа 0 анимаций`, yHidden.every((n) => n === 0), JSON.stringify(yHidden));
    const run = (await allAnims(page, null)).filter((a) => a.isPet && a.state === "running");
    ok(`${tag}: на Play ни одной идущей анимации кляксы`, run.length === 0, run.map((a) => a.name).join(" "));
    ok(`${tag}: без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- wake (сквозной, без подложенной памяти)
async function wakeCase(browser, bn, c) {
  const tag = tagOf(bn, c, "-wake");
  const wakeDate = SEED.dates.wake;
  const solvedRec = SEED.year.find((d) => d.date === wakeDate);
  const others = SEED.year.filter((d) => d.date !== wakeDate);
  const first = SEED.year.map((d) => d.date).sort()[0];
  const { ctx, page, errs } = await open(browser, c, { days: others, firstUse: first });
  try {
    await page.goto(`${BASE}/#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await gotoDay(page, wakeDate);
    const m0 = await page.locator(YEAR).getAttribute("data-mood");
    ok(`${tag}: день ещё не решён — клякса «спит», без перехода`, m0 === "asleep" && (await page.locator(`${YEAR}[data-act]`).count()) === 0, m0);
    const seen = await page.evaluate(() => localStorage.getItem("pundoku.petSeen"));
    ok(`${tag}: показанное «спит» запомнено`, JSON.parse(seen ?? "{}")[wakeDate] === "asleep", seen);
    // День решён (как из архива) — запись в IDB, перезапуск приложения.
    await putDays(page, [solvedRec]);
    await page.goto(`${BASE}/?r=1#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await gotoDay(page, wakeDate).catch(() => {});
    const act = await page.locator(YEAR).getAttribute("data-act");
    const mood = await page.locator(YEAR).getAttribute("data-mood");
    await freeze(page, YEAR, 0);
    ok(`${tag}: решённый «спавший» день → «проснуться» (${mood})`, act === "wake" && mood !== "asleep", `${act} ${mood}`);
    const A = await petAnims(page, YEAR);
    const D = c.rm ? DUR_RM.wake : DUR.wake;
    ok(`${tag}: пробуждение ${D} мс, только transform/opacity, конечное`, A.some((a) => a.cls.includes("pose to") && Math.round(a.duration) === D) && A.every((a) => ONLY_TO(a.props) && Number.isFinite(a.iterations)), A.map((a) => `${a.cls}:${a.name}:${a.duration}`).join(" "));
    let moved = 0,
      out = 0,
      hit = 0;
    for (let f = 0; f <= 1.0001; f += 0.1) {
      await freeze(page, YEAR, f * D);
      const g = await geo(page, YEAR, ".ysheet", ['[data-testid="day-card"] .dc-head h3']);
      if (!g.tf.every(isIdentity)) moved++;
      if (g.out) out++;
      if (g.hit) hit++;
      if (bn === "wk" && [0.3, 0.6].some((x) => Math.abs(x - f) < 1e-6)) await page.screenshot({ path: join(OUT, `${tag}-${Math.round(f * 100)}.png`) });
    }
    ok(`${tag}: пробуждение внутри шита, не на дате`, out === 0 && hit === 0, `out=${out} hit=${hit}`);
    if (c.rm) ok(`${tag}: RM — без сдвигов/масштаба`, moved === 0, `${moved}`);
    else ok(`${tag}: пробуждение движется`, moved >= 4, `${moved}`);
    const seen2 = JSON.parse((await page.evaluate(() => localStorage.getItem("pundoku.petSeen"))) ?? "{}");
    ok(`${tag}: память обновлена на новое настроение`, seen2[wakeDate] === mood, JSON.stringify(seen2));
    // Повторный показ (назад → тот же день) и после перезагрузки — только покой.
    await gotoDay(page, SEED.dates.happy);
    await gotoDay(page, wakeDate);
    ok(`${tag}: повторный показ — без перехода`, (await page.locator(`${YEAR}[data-act]`).count()) === 0);
    await page.goto(`${BASE}/?r=2#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await gotoDay(page, wakeDate);
    ok(`${tag}: после перезагрузки — без перехода`, (await page.locator(`${YEAR}[data-act]`).count()) === 0);
    ok(`${tag}: без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- year (дата vs клякса)
async function yearCase(browser, bn, c) {
  const tag = tagOf(bn, c, "-year");
  const first = SEED.year.map((d) => d.date).sort()[0];
  const { ctx, page, errs } = await open(browser, c, { days: SEED.year, firstUse: first });
  try {
    await page.goto(`${BASE}/#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    for (const mood of ["asleep", "happy", "tired", "surprised"]) {
      await gotoDay(page, SEED.dates[mood]);
      const got = await page.locator(YEAR).getAttribute("data-mood");
      let hit = 0,
        out = 0;
      const pts = c.rm ? [0] : [0, 700, 1400, 2100, 2800, 3500, 4200, 6000, 9000, 12000];
      for (const t of pts) {
        await freeze(page, YEAR, mood === "asleep" ? t * (6500 / 4200) : t);
        const g = await geo(page, YEAR, ".ysheet", ['[data-testid="day-card"] .dc-head h3']);
        if (g.hit) hit++;
        if (g.out) out++;
      }
      const lines = await page.evaluate(() => {
        const h = document.querySelector('[data-testid="day-card"] .dc-head h3');
        const r = document.createRange();
        r.selectNodeContents(h);
        const p = document.querySelector('[data-testid="pet-year"] .pet').getBoundingClientRect();
        const L = [...r.getClientRects()].filter((q) => q.width > 0.5);
        return { n: L.length, gap: Math.round((p.left - Math.max(...L.map((q) => q.right))) * 10) / 10, text: h.textContent, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      ok(`${tag}: ${mood} (${got}) — чернила не на строках даты ни в одной из ${pts.length} точек покоя, внутри шита`, got === mood && hit === 0 && out === 0, { hit, out, ...lines });
      ok(`${tag}: ${mood} — нет горизонтального переполнения`, lines.docOverflow <= 0, String(lines.docOverflow));
      if (mood === "asleep" || (mood === "happy" && c.lang !== "en")) await page.screenshot({ path: join(OUT, `${tag}-${mood}.png`) });
    }
    ok(`${tag}: без ошибок консоли`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}
const YEAR_CFG = [
  { w: 320, h: 568, scheme: "light", lang: "en", ax3: true },
  { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true },
  { w: 320, h: 568, scheme: "light", lang: "ru", ax3: true },
  { w: 360, h: 780, scheme: "dark", lang: "uk", ax3: true },
  { w: 375, h: 667, scheme: "light", lang: "ru", ax3: true },
  { w: 430, h: 932, scheme: "dark", lang: "en" },
];

// ---------------------------------------------------------------- run
const safe = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name}: сценарий целиком`, false, String(e?.message ?? e).split("\n")[0]);
  }
};
for (const engine of ENGINES) {
  const bn = engine === "webkit" ? "wk" : "cr";
  const browser = await pw[engine].launch();
  try {
    if (FILTER.includes("card")) for (const c of CARD_CFG) await safe(tagOf(bn, c, "-card"), () => cardCase(browser, bn, c));
    if (FILTER.includes("live")) {
      await safe(`${bn}-live-393`, () => liveCase(browser, bn, { w: 393, h: 852, scheme: "light", lang: "en" }));
      if (bn === "wk") await safe(`${bn}-live-320`, () => liveCase(browser, bn, { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true }));
    }
    if (FILTER.includes("leak")) await safe(`${bn}-leak`, () => leakCase(browser, bn, { w: 393, h: 852, scheme: "dark", lang: "en" }));
    if (FILTER.includes("wake")) {
      await safe(`${bn}-wake`, () => wakeCase(browser, bn, { w: 320, h: 568, scheme: "light", lang: "uk", ax3: true }));
      await safe(`${bn}-wake-rm`, () => wakeCase(browser, bn, { w: 393, h: 852, scheme: "dark", lang: "en", rm: true }));
    }
    if (FILTER.includes("year")) for (const c of YEAR_CFG) await safe(tagOf(bn, c, "-year"), () => yearCase(browser, bn, c));
  } finally {
    await browser.close();
  }
}
const fails = results.filter((r) => !r.cond);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
for (const f of fails) console.log("  FAIL " + f.name);
process.exit(fails.length ? 1 : 0);
