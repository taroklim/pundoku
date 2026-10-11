/**
 * PD-299 — живая проверка: Питомец в Year, места 4 (пустой Год) и 5 (шапка Года) по макету design/pd296-pet-places.md (+ кадры
 * design/pd296-shots/place-04-year-empty*.png, place-05-year-top*.png), плюс зона тапа у кляксы листа дня. РЕАЛЬНАЯ сборка.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd299-dist
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend DIST=/tmp/pd299-dist PORT=5841 \
 *     node design/pd299-check.mjs [chromium] [webkit]
 *
 * Условия — как pd298-check: html font-size 17 px (40 px — AX3), --sa-top/--sa-bot 59/34 (393×852) и 20/0 (320×568), isMobile +
 * hasTouch, light/dark, en/uk/ru, Reduce Motion, десктоп C 1280×800 (мышь). Время зафиксировано (2026-10-09). Сервер —
 * design/pdlow4/lib.mjs. Год с данными засевается так же, как в pd295-check: решить Today в браузере, размножить запись дня в IndexedDB
 * (2025-12-31 + 2026-09-01…накануне), снять storageState. Два засева: «today» — сегодня решён; «past» — сегодня не сыгран.
 *
 * Место 4 (пустой Год): спящая клякса 64 pt на месте знака P4 — край чернил по краю текста; дышит (RM — стоит); зона ≥ 44; блок
 *   «пустого года» той же высоты, что со знаком P4 (Питомец выкл), кнопка и полотно на тех же местах (PD-295: достижимость Oct–Dec
 *   не хуже); в шапке кляксы нет (дышит одна); тап — «Плюх» (RM — брызги мигают); открыт лист — клякса стоит, дышит только клякса
 *   листа; закрыт — снова дышит; 320 + AX3 — уходит, кнопка выше, чем со знаком; Питомец выкл — знак P4.
 * Место 5 (шапка Года): клякса сегодняшнего дня 40 pt первой в группе действий, перед шестерёнкой, на одной линии; шапка и полотно
 *   на тех же местах, что без Питомца; заголовок (с шевроном выбора года) не обрезан и не перекрыт; «past» — спит, «today» — то же
 *   настроение, что в листе дня сегодня; тап — «Плюх», лист не открывается; под открытым листом стоит, дышит одна клякса (листа);
 *   тап по кляксе листа дня — «Плюх»; закрыли — снова дышит; прошлый год в выборе — кляксы нет; 320 + AX3 — уходит или не ломает
 *   шапку; Питомец выкл — нет. Десктоп C: место 4 в области Year, место 5 в тулбаре; клик мышью — «Плюх».
 * Кадры — design/pd299-shots/ (в ветку — отобранные). ONLY=4|5|desk — только эта часть (быстро).
 */
import fs from "node:fs";
import path from "node:path";
import { pw, serve, NOW, solve } from "./pdlow4/lib.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? "/tmp/pd299-dist");
const PORT = +(process.env.PORT ?? 5841);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(HERE, "pd299-shots");
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2).filter((a) => ["chromium", "webkit"].includes(a));
const BROWSERS = args.length ? args : ["chromium", "webkit"];
const SHORT = { chromium: "cr", webkit: "wk" };
const PANE = ".tab-pane:not(.off)";
const LOCALE = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };
const EMPTY = `${PANE} [data-testid="pet-year-empty"]`;
const HEAD = `${PANE} [data-testid="pet-year-head"]`;
const SHEET_PET = '[data-testid="pet-year"]';
const ONLY = process.env.ONLY ?? "";

let total = 0;
const fails = [];
const results = [];
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) fails.push(name);
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, typeof detail === "string" ? detail : JSON.stringify(detail));
};

const PHONE = { w: 393, h: 852, top: 59, bot: 34 };
const SMALL = { w: 320, h: 568, top: 20, bot: 0 };

const ENV = ({ pet, lang, fsPx, top, bot }) => {
  if (!sessionStorage.getItem("pd299-init")) {
    sessionStorage.setItem("pd299-init", "1");
    localStorage.setItem("pundoku.locale", lang);
    if (pet !== undefined) localStorage.setItem("pundoku.pet", pet);
  }
  const add = () => {
    const st = document.createElement("style");
    st.id = "pd299-env";
    st.textContent = `html{font-size:${fsPx}px !important}:root{--sa-top:${top}px !important;--sa-bot:${bot}px !important}`;
    document.documentElement.appendChild(st);
  };
  if (document.documentElement) add();
  else document.addEventListener("DOMContentLoaded", add);
};

async function open(browser, { dev = PHONE, scheme = "light", lang = "en", rm = false, ax3 = false, pet, state, route = "year" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h },
    screen: { width: dev.w, height: dev.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: LOCALE[lang],
    timezoneId: "UTC",
    colorScheme: scheme,
    reducedMotion: rm ? "reduce" : "no-preference",
    serviceWorkers: "block",
    ...(state ? { storageState: state } : {}),
  });
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript(ENV, { pet, lang, fsPx: ax3 ? 40 : 17, top: dev.top, bot: dev.bot });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => {
    if (!/api\/devices|access control/.test(e.message)) errs.push(e.message);
  });
  await p.goto(`${BASE}/#/${route}`);
  await p.waitForSelector(`${PANE} [data-testid="year-canvas"]`, { timeout: 60000 });
  // Год загружен: засев — выбор года (2025 + 2026), без засева — пустое состояние. Иначе сравнение «с Питомцем / без» ловит загрузку.
  await p.waitForSelector(state ? `${PANE} .titlebtn` : `${PANE} [data-testid="year-empty"]`, { timeout: 60000 });
  await p.waitForTimeout(1300); // загрузка года + AX3 (атрибут после первой раскладки) + ResizeObserver шапки
  return { ctx, p, errs };
}

// ---------------------------------------------------------------------------------------------------------- засев
async function fillToday(p) {
  const g = await p.evaluate(() => {
    const out = Array(81).fill("0");
    for (const c of document.querySelectorAll('.tab-pane[data-tab="today"] .board button.cell[data-i]')) {
      const d = c.querySelector(".d.given, .d.player");
      if (d) out[+c.dataset.i] = d.textContent.trim();
    }
    return out.join("");
  });
  const sol = solve(g);
  for (let i = 0; i < 81; i++) {
    if (g[i] !== "0") continue;
    await p.locator(`.tab-pane[data-tab="today"] .board .cell[data-i="${i}"]`).click();
    await p.keyboard.press(sol[i]);
  }
}
/** Засев года: `today` — сегодня решён; `past` — сегодняшней записи нет. Дни 2026-09-01…накануне (метки по кругу) и 2025-12-31. */
async function seed(browser, keepToday) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: "block", timezoneId: "UTC", locale: "en-US" });
  await ctx.clock.setFixedTime(NOW);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/#/today`);
  await p.waitForSelector('.tab-pane[data-tab="today"] .board button.cell', { timeout: 60000 });
  await p.waitForTimeout(400);
  await fillToday(p);
  await p.locator('.tab-pane[data-tab="today"] [data-testid="result-card"]').waitFor({ timeout: 20000 });
  await p.waitForTimeout(1500);
  const n = await p.evaluate(
    (keepToday) =>
      new Promise((ok, no) => {
        const r = indexedDB.open("pundoku");
        r.onerror = () => no(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction("days", "readwrite");
          const st = tx.objectStore("days");
          const all = st.getAll();
          all.onsuccess = () => {
            const base = all.result[0];
            let n = 0;
            const put = (ds, k) => {
              if (k !== 6) st.put({ ...base, date: ds, solvedAt: `${ds}T10:00:00.000Z`, late: k === 3, assisted: k === 2 || k === 5, hints: k === 2 ? 1 : 0, solved: k !== 4 });
              n++;
            };
            put("2025-12-31", 0);
            const d = new Date("2026-09-01T00:00:00Z");
            while (d.toISOString().slice(0, 10) < base.date) {
              put(d.toISOString().slice(0, 10), n % 7);
              d.setUTCDate(d.getUTCDate() + 1);
            }
            if (!keepToday) st.delete(base.date);
            tx.oncomplete = () => ok(n);
          };
        };
      }),
    keepToday,
  );
  const state = await ctx.storageState({ indexedDB: true });
  await ctx.close();
  return { state, n };
}

// ---------------------------------------------------------------------------------------------------------- замеры
const petInfo = (p, zoneSel) =>
  p.evaluate((zoneSel) => {
    const z = document.querySelector(zoneSel);
    if (!z) return null;
    const pet = z.querySelector(".pet");
    const zr = z.getBoundingClientRect();
    const pr = pet?.getBoundingClientRect();
    const anims = pet ? pet.getAnimations({ subtree: true }).map((a) => ({ name: a.animationName, cls: a.effect.target.className, state: a.playState, dur: a.effect.getTiming().duration })) : [];
    const cs = getComputedStyle(z);
    const ink = [...z.querySelectorAll(".pose.to .pet-ink, .drops.to .dot")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    return {
      hidden: z.hidden || cs.display === "none",
      zone: { x: zr.left, y: zr.top, w: zr.width, h: zr.height, r: zr.right, b: zr.bottom },
      pet: pr && { x: pr.left, y: pr.top, w: pr.width, h: pr.height },
      ink: ink.length ? { l: Math.min(...ink.map((r) => r.left)), r: Math.max(...ink.map((r) => r.right)), t: Math.min(...ink.map((r) => r.top)), b: Math.max(...ink.map((r) => r.bottom)) } : null,
      mood: pet?.getAttribute("data-mood"),
      label: pet?.getAttribute("aria-label"),
      idle: pet?.hasAttribute("data-idle"),
      poke: pet?.getAttribute("data-poke"),
      breathRunning: anims.some((a) => a.cls === "breath" && a.state === "running"),
      anims,
      role: z.getAttribute("role"),
      tabindex: z.getAttribute("tabindex"),
      touchAction: cs.touchAction,
      pointer: cs.pointerEvents,
    };
  }, zoneSel);
/** Сколько клякс на экране дышат (видимы во вьюпорте, покой идёт) и чьи они (testid зоны). */
const breathing = (p) =>
  p.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    return [...document.querySelectorAll(".pet")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
        if (el.closest(".tab-pane.off, [hidden]")) return false;
        return el.getAnimations({ subtree: true }).some((a) => a.effect.target.classList.contains("breath") && a.playState === "running");
      })
      .map((el) => el.parentElement.closest("[data-testid]")?.getAttribute("data-testid"));
  });
const rect = (p, sel) =>
  p.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }, sel);
/** Текстовые прямоугольники элементов (строки), пересекающие рамку чернил/зоны. */
const overlaps = (p, zoneSel, sels, { ink = false } = {}) =>
  p.evaluate(
    ({ zoneSel, sels, ink }) => {
      const zone = document.querySelector(zoneSel);
      const box = (els) => {
        const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
        if (!rs.length) return null;
        return { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)), width: 1 };
      };
      const z = ink ? box([...(zone?.querySelectorAll(".pose.to .pet-ink, .drops.to .dot") ?? [])]) : zone?.getBoundingClientRect();
      if (!z || z.width === 0) return [];
      const out = [];
      for (const s of sels)
        for (const el of document.querySelectorAll(s)) {
          if (el.closest(zoneSel)) continue;
          const rects = el.matches("p, h1, span")
            ? (() => {
                const r = document.createRange();
                r.selectNodeContents(el);
                return [...r.getClientRects()];
              })()
            : [el.getBoundingClientRect()];
          for (const t of rects) if (t.width > 0 && t.right > z.left + 0.5 && t.left < z.right - 0.5 && t.bottom > z.top + 0.5 && t.top < z.bottom - 0.5) out.push(`${s}:${Math.round(t.left)},${Math.round(t.top)}`);
        }
      return out;
    },
    { zoneSel, sels, ink },
  );
const hitSelf = (p, sel) =>
  p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, sel);

async function tapZone(p, sel) {
  const b = await p.locator(sel).boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  if (p.context()._mouse) return p.mouse.click(x, y);
  await p.touchscreen.tap(x, y);
}
async function pokeOnce(p, sel, tag, { rm = false } = {}) {
  // Журнал реакции (до тапа): data-poke на кляксе и события анимаций «Плюха». Под нагрузкой (параллельные прогоны) клик/тап WebKit
  // возвращается позже, чем длится реакция (замерено: до ~1 с) — поэтому проверяем по журналу, а не опросом после тапа.
  await p.evaluate((sel) => {
    const pet = document.querySelector(sel).querySelector(".pet");
    const log = (window.__pd299poke = { attr: [], ev: [] });
    log.mo = new MutationObserver((ms) => {
      for (const m of ms) log.attr.push(m.target.getAttribute("data-poke"));
    });
    log.mo.observe(pet, { attributes: true, attributeFilter: ["data-poke"] });
    for (const t of ["animationstart", "animationend"])
      pet.addEventListener(t, (e) => {
        if (e.animationName === "petPokeA") log.ev.push({ t, at: performance.now(), dur: getComputedStyle(e.target).animationDuration });
      });
  }, sel);
  await tapZone(p, sel);
  const t0 = Date.now();
  let log;
  do {
    await p.waitForTimeout(60);
    log = await p.evaluate(() => ({ attr: window.__pd299poke.attr, ev: window.__pd299poke.ev }));
  } while (!log.ev.some((x) => x.t === "animationend") && Date.now() - t0 < 2000);
  await p.waitForTimeout(150);
  log = await p.evaluate(() => ({ attr: window.__pd299poke.attr, ev: window.__pd299poke.ev }));
  const a = await petInfo(p, sel);
  const st = log.ev.find((x) => x.t === "animationstart");
  const en = log.ev.find((x) => x.t === "animationend");
  const D = rm ? 200 : 440;
  check(
    `${tag}: тап → «Плюх» (data-poke=A, petPokeA ${D} мс от начала до конца), настроение и имя те же`,
    log.attr[0] === "A" && st && en && st.dur === `${D / 1000}s` && en.at - st.at >= D - 20 && a.mood && a.label,
    { attr: log.attr, ms: st && en ? Math.round(en.at - st.at) : null, dur: st?.dur, mood: a.mood },
  );
  check(`${tag}: реакция закончилась — data-poke снят, petPokeA нет`, !a.poke && !a.anims.some((x) => x.name === "petPokeA"), { poke: a.poke, attr: log.attr });
}
/** Reduce Motion: тело стоит (transform .poke тождественный), брызги мигают до .25. */
async function rmProbe(p, sel, tag) {
  // Реакция при RM длится 200 мс — короче, чем возвращается тап WebKit под нагрузкой: анимации «Плюха» ставятся на паузу прямо в
  // animationstart (журнал до тапа), потом замер по кадрам.
  await p.evaluate((sel) => {
    const pet = document.querySelector(sel).querySelector(".pet");
    window.__pd299rm = false;
    pet.addEventListener("animationstart", (e) => {
      if (!e.animationName.startsWith("petPoke")) return;
      for (const a of pet.getAnimations({ subtree: true })) if (a.animationName.startsWith("petPoke")) a.pause();
      window.__pd299rm = true;
    });
  }, sel);
  await tapZone(p, sel);
  await p.waitForFunction(() => window.__pd299rm, null, { timeout: 3000 }).catch(() => {});
  const r = await p.evaluate((sel) => {
    const pet = document.querySelector(sel).querySelector(".pet");
    const out = { poke: [], drop: null };
    const anims = pet.getAnimations({ subtree: true });
    const body = anims.find((a) => a.animationName === "petPokeA");
    const drop = anims.find((a) => a.animationName === "petPokeDropA");
    if (!body) return null;
    for (const t of [0, 50, 100, 150]) {
      for (const a of anims) (a.pause(), (a.currentTime = t));
      out.poke.push(getComputedStyle(pet.querySelector(".poke")).transform);
    }
    if (drop) {
      drop.currentTime = 56;
      out.drop = +getComputedStyle(drop.effect.target).opacity;
    }
    for (const a of anims) a.finish?.();
    return out;
  }, sel);
  const ident = (t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
  check(`${tag}: RM — тело стоит при тапе, брызги мигают до ≈ .25`, r && r.poke.every(ident) && r.drop !== null && Math.abs(r.drop - 0.25) < 0.03, r);
  await p.waitForTimeout(300);
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const tagOf = (B, n, c) => `${B} место ${n} ${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;
const fileOf = (B, n, c, extra = "") => `${B}-p${n}${extra}-${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;

/** Геометрия экрана Year, общая для «с Питомцем» и «без» (для сравнения: шапка, заголовок, блок пустого года, кнопка, полотно, Dec). */
const yearGeo = (p) =>
  p.evaluate((P) => {
    const r = (s) => {
      const e = document.querySelector(`${P} ${s}`);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return [+b.left.toFixed(1), +b.top.toFixed(1), +b.width.toFixed(1), +b.height.toFixed(1)];
    };
    const pane = document.querySelector(`${P}`);
    return {
      toolbar: r(".toolbar"),
      title: r('[data-testid="year-title"]'),
      gear: r('[data-testid="open-settings"]'),
      empty: r('[data-testid="year-empty"]'),
      line: r(".year-empty p"),
      cta: r(".year-empty .cta"),
      canvas: r('[data-testid="year-canvas"]'),
      dec: r('.year-month[data-month="11"]'),
      scrollH: pane.scrollHeight,
      tabTop: document.querySelector(".tabbar")?.getBoundingClientRect().top ?? innerHeight,
    };
  }, PANE);
const same = (a, b, eps = 0.6) => JSON.stringify(a) === JSON.stringify(b) || (Array.isArray(a) && Array.isArray(b) && a.every((v, i) => Math.abs(v - b[i]) <= eps));

async function openSheetMonth(p, m) {
  await p.locator(`${PANE} .year-month[data-month="${m}"]`).tap();
  await p.locator('[data-testid="month-page"]').waitFor();
  await p.waitForTimeout(600);
}
async function closeSheet(p) {
  await p.locator(".ysheet .done").tap();
  await p.waitForTimeout(900);
}

// ---------------------------------------------------------------------------------------------------------- место 4
async function place4(b, B, c) {
  const tag = tagOf(B, 4, c);
  const off = await open(b, { ...c, pet: "0" });
  const g0 = await yearGeo(off.p);
  await off.ctx.close();
  const { ctx, p, errs } = await open(b, c);
  try {
    const a = await petInfo(p, EMPTY);
    const g1 = await yearGeo(p);
    if (!a) return check(`${tag}: клякса пустого года есть`, false, "нет зоны");
    const narrowAx3 = c.ax3 && c.dev.w < 360;
    if (narrowAx3) {
      check(`${tag}: 320 + AX3 — клякса ушла (текст важнее), строка и кнопка выше, чем со знаком P4; полотно не ниже`, a.hidden && g1.cta[1] <= g0.cta[1] && g1.canvas[1] <= g0.canvas[1], { cta: [g0.cta, g1.cta] });
    } else {
      check(
        `${tag}: спящая клякса 64 pt в зоне 64 (≥ 44)${c.rm ? ", RM — стоит" : ", дышит"}; украшение (без role/tabindex у зоны), touch-action manipulation`,
        !a.hidden && a.mood === "asleep" && Math.round(a.pet.w) === 64 && a.zone.w >= 44 && a.zone.h >= 44 && (c.rm ? !a.idle && !a.breathRunning : a.idle && a.breathRunning) && !a.role && !a.tabindex && a.touchAction === "manipulation" && a.pointer === "auto",
        { mood: a.mood, pet: a.pet, zone: a.zone, idle: a.idle, run: a.breathRunning },
      );
      check(`${tag}: геометрия как со знаком P4 — блок, строка, кнопка, полотно, Dec, высота прокрутки (PD-295)`, same(g1.empty, g0.empty) && same(g1.line, g0.line) && same(g1.cta, g0.cta) && same(g1.canvas, g0.canvas) && same(g1.dec, g0.dec) && Math.abs(g1.scrollH - g0.scrollH) <= 1, { on: g1, off: g0 });
      const line = await rect(p, `${PANE} .year-empty p`);
      check(`${tag}: край чернил по краю текста (±2 px)`, a.ink && Math.abs(a.ink.l - line.l) <= 2, { ink: a.ink, line });
      const ov = await overlaps(p, EMPTY, [`${PANE} .year-empty p`, `${PANE} .year-empty .cta`, `${PANE} .toolbar`]);
      check(`${tag}: зона не наезжает на строку, кнопку, шапку; кнопка нажимается`, ov.length === 0 && (await hitSelf(p, `${PANE} .year-empty .cta`)), ov);
    }
    check(`${tag}: в шапке пустого года кляксы нет; дышит не больше одной`, (await p.locator(HEAD).count()) === 0 && (await breathing(p)).length <= 1);
    check(`${tag}: кнопка «Open today's puzzle» видна над таб-баром${narrowAx3 ? " (или достижима прокруткой — как со знаком)" : ""}`, narrowAx3 ? g1.cta[1] <= g0.cta[1] : g1.cta[1] + g1.cta[3] <= g1.tabTop, { cta: g1.cta, tabTop: g1.tabTop });
    await shot(p, fileOf(B, 4, c));
    if (!a.hidden && c.full) {
      await pokeOnce(p, EMPTY, tag);
      // Лист: месяц → сегодня. Клякса пустого года стоит, дышит только клякса листа дня.
      await openSheetMonth(p, 9);
      const s1 = await petInfo(p, EMPTY);
      check(`${tag}: открыт лист месяца — клякса пустого года стоит`, !s1.idle && !s1.breathRunning, { idle: s1.idle, run: s1.breathRunning });
      await p.locator('.ycell[data-date="2026-10-09"]').tap();
      await p.waitForTimeout(800);
      const br = await breathing(p);
      check(`${tag}: лист дня сегодня — дышит одна клякса (листа)`, br.length === 1 && br[0] === "pet-year", br);
      await closeSheet(p);
      const s2 = await petInfo(p, EMPTY);
      check(`${tag}: лист закрыт — клякса пустого года снова дышит`, s2.idle && s2.breathRunning, { idle: s2.idle, run: s2.breathRunning });
    }
    if (!a.hidden && c.rm) await rmProbe(p, EMPTY, tag);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}
async function place4Off(b, B) {
  const { ctx, p } = await open(b, { pet: "0" });
  try {
    const mark = await p.locator(`${PANE} [data-testid="year-empty"] svg.year-empty-mark`).count();
    check(`${B} место 4: Питомец выкл — знак P4 на месте, кляксы нет`, mark === 1 && (await p.locator(`${PANE} .pet`).count()) === 0);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------------------- место 5
async function place5(b, B, c, states) {
  const tag = `${tagOf(B, 5, c)}-${c.seed}`;
  const state = states[c.seed];
  const off = await open(b, { ...c, pet: "0", state });
  const g0 = await yearGeo(off.p);
  await off.ctx.close();
  const { ctx, p, errs } = await open(b, { ...c, state });
  try {
    const a = await petInfo(p, HEAD);
    const g1 = await yearGeo(p);
    const title = await p.evaluate((P) => {
      const t = document.querySelector(`${P} .toolbar .title`);
      return { clipped: t.scrollWidth > t.clientWidth + 1, text: t.textContent };
    }, PANE);
    if (!a) return check(`${tag}: клякса в шапке есть`, false, "нет зоны");
    check(`${tag}: шапка, заголовок, шестерёнка, полотно — на тех же местах, что без Питомца`, same(g1.toolbar, g0.toolbar) && same(g1.title, g0.title) && same(g1.gear, g0.gear) && same(g1.canvas, g0.canvas), { on: g1, off: g0 });
    if (a.hidden) {
      check(`${tag}: клякса ушла (мало места) — только на узком + AX3; заголовок не обрезан`, c.ax3 && !title.clipped, { title });
    } else {
      check(
        `${tag}: клякса 40 pt в зоне 44 первой в группе действий (перед шестерёнкой)${c.rm ? ", RM — стоит" : ", дышит"}; украшение`,
        Math.round(a.pet.w) === 40 && a.zone.w >= 44 && a.zone.h >= 44 && (c.rm ? !a.breathRunning : a.idle && a.breathRunning) && !a.role && !a.tabindex && a.touchAction === "manipulation" &&
          (await p.evaluate((sel) => document.querySelector(sel).nextElementSibling?.getAttribute("data-testid"), HEAD)) === "open-settings",
        { pet: a.pet, zone: a.zone, idle: a.idle, run: a.breathRunning },
      );
      const gear = await rect(p, `${PANE} [data-testid="open-settings"]`);
      check(`${tag}: на одной линии с шестерёнкой`, Math.abs(a.zone.y - gear.t) <= 0.6 && Math.abs(a.zone.h - gear.h) <= 0.6, { zone: a.zone, gear });
      const ov = await overlaps(p, HEAD, [`${PANE} [data-testid="year-title"]`, `${PANE} [data-testid="open-settings"]`, `${PANE} .toolbar .title`]);
      const ovInk = await overlaps(p, HEAD, [`${PANE} .year-totals`], { ink: true });
      check(`${tag}: зона не наезжает на заголовок/шестерёнку, чернила — на итоги; заголовок не обрезан; шестерёнка и заголовок нажимаются`, ov.length === 0 && ovInk.length === 0 && !title.clipped && (await hitSelf(p, `${PANE} [data-testid="open-settings"]`)) && (await hitSelf(p, `${PANE} [data-testid="year-title"]`)), { ov, ovInk, title });
      if (c.seed === "past") check(`${tag}: сегодня не сыгран — спит`, a.mood === "asleep", a.mood);
      else check(`${tag}: сегодня решён — не спит (настроение дня)`, a.mood && a.mood !== "asleep", a.mood);
    }
    check(`${tag}: дышит не больше одной кляксы`, (await breathing(p)).length <= 1);
    await shot(p, fileOf(B, 5, c, `-${c.seed}`));
    if (!a.hidden && c.full) {
      await pokeOnce(p, HEAD, tag);
      check(`${tag}: тап по кляксе лист не открывает, меню года не открывает`, (await p.locator('[data-testid="year-sheet"]').count()) === 0 && (await p.locator(".year-menu").count()) === 0);
      // Кадр «Плюха» на 25 % — шапка, для сверки с tap-A-squash-1.
      await tapZone(p, HEAD);
      await p.evaluate((sel) => {
        for (const x of document.querySelector(sel).querySelector(".pet").getAnimations({ subtree: true })) if (x.animationName.startsWith("petPoke")) (x.pause(), (x.currentTime = 110));
      }, HEAD);
      await p.locator(`${PANE} .toolbar`).screenshot({ path: path.join(OUT, `${B}-p5-tap-squash-header-${c.seed}.png`) });
      await p.evaluate((sel) => {
        for (const x of document.querySelector(sel).querySelector(".pet").getAnimations({ subtree: true })) if (x.animationName.startsWith("petPoke")) x.finish();
      }, HEAD);
      await p.waitForTimeout(300);
      // Лист: месяц → день. Шапка стоит; дышит одна клякса — в листе дня; тап по ней — «Плюх».
      await openSheetMonth(p, 9);
      const s1 = await petInfo(p, HEAD);
      check(`${tag}: открыт лист — клякса шапки стоит`, !s1.idle && !s1.breathRunning, { idle: s1.idle, run: s1.breathRunning });
      await p.locator('.ycell[data-date="2026-10-09"]').tap();
      await p.waitForTimeout(1500); // «проснуться» листа (если сегодня решён) доигрывает
      const sheetPet = await petInfo(p, SHEET_PET);
      const br = await breathing(p);
      check(`${tag}: лист дня сегодня — дышит одна клякса (листа), настроение = шапки`, br.length === 1 && br[0] === "pet-year" && sheetPet.mood === a.mood, { br, sheet: sheetPet.mood, head: a.mood });
      check(`${tag}: клякса листа — зона 44 (pet-hit), украшение`, sheetPet.zone.w >= 44 && sheetPet.zone.h >= 44 && !sheetPet.role && !sheetPet.tabindex && sheetPet.touchAction === "manipulation");
      await pokeOnce(p, SHEET_PET, `${tag} лист дня`);
      await shot(p, fileOf(B, 5, c, `-sheet-${c.seed}`));
      await closeSheet(p);
      const s2 = await petInfo(p, HEAD);
      check(`${tag}: лист закрыт — клякса шапки снова дышит`, s2.idle && s2.breathRunning, { idle: s2.idle, run: s2.breathRunning });
      // Прошлый год — «сегодня» там ничего не значит: кляксы нет; вернулись — есть.
      await p.locator(`${PANE} [data-testid="year-title"]`).tap();
      await p.locator('.year-menu [role="menuitemradio"]', { hasText: "2025" }).tap();
      await p.waitForTimeout(500);
      const past = await p.locator(HEAD).count();
      await p.locator(`${PANE} [data-testid="year-title"]`).tap();
      await p.locator('.year-menu [role="menuitemradio"]', { hasText: "2026" }).tap();
      await p.waitForTimeout(500);
      check(`${tag}: 2025 в выборе года — кляксы нет; 2026 — снова есть`, past === 0 && (await p.locator(HEAD).count()) === 1, { past });
    }
    if (!a.hidden && c.rm) await rmProbe(p, HEAD, tag);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}
async function place5Off(b, B, states) {
  const { ctx, p } = await open(b, { pet: "0", state: states.today });
  try {
    check(`${B} место 5: Питомец выкл — в шапке кляксы нет, на экране ни одной`, (await p.locator(HEAD).count()) === 0 && (await p.locator(`${PANE} .pet`).count()) === 0);
  } finally {
    await ctx.close();
  }
}

/** Прокрутка пустого года до конца: Dec целиком над таб-баром (как PD-295), с кляксой. */
async function scrollEnd(b, B, c) {
  const tag = tagOf(B, "4-прокрутка", c);
  const { ctx, p } = await open(b, c);
  try {
    const m = await p.evaluate(async (P) => {
      const pane = document.querySelector(P);
      pane.scrollTop = pane.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const dec = document.querySelector(`${P} .year-month[data-month="11"]`).getBoundingClientRect();
      const tab = document.querySelector(".tabbar")?.getBoundingClientRect().top ?? innerHeight;
      const hit = document.elementFromPoint((dec.left + dec.right) / 2, (dec.top + dec.bottom) / 2);
      return { decBottom: Math.round(dec.bottom), tab: Math.round(tab), hit: !!hit?.closest('.year-month[data-month="11"]'), ov: getComputedStyle(pane).overflowY };
    }, PANE);
    check(`${tag}: в конце прокрутки Dec над таб-баром с запасом ≥ 16 и нажимается`, m.decBottom <= m.tab - 16 + 0.5 && m.hit && m.ov !== "hidden", m);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------------------- десктоп C
async function desk(b, B, states) {
  const geo = async (pet, state) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", locale: "en-US", timezoneId: "UTC", ...(state ? { storageState: state } : {}) });
    await ctx.clock.setFixedTime(NOW);
    await ctx.addInitScript((pet) => localStorage.setItem("pundoku.pet", pet), pet);
    ctx._mouse = true;
    const p = await ctx.newPage();
    await p.goto(`${BASE}/#/year`);
    await p.waitForSelector(state ? ".tab-pane:not(.off) .titlebtn" : '.tab-pane:not(.off) [data-testid="year-empty"]', { timeout: 60000 });
    await p.waitForTimeout(1500);
    const g = await p.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s);
        if (!e || e.hidden || getComputedStyle(e).display === "none") return null;
        const b = e.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
      };
      return {
        desk: !!document.querySelector(".shell.desk"),
        tb: r('.tab-pane:not(.off) .toolbar'),
        title: r('.tab-pane:not(.off) [data-testid="year-title"]'),
        gear: r('.tab-pane:not(.off) [data-testid="open-settings"]'),
        head: r('.tab-pane:not(.off) [data-testid="pet-year-head"]'),
        empty: r('.tab-pane:not(.off) [data-testid="pet-year-empty"]'),
        emptyBlock: r('.tab-pane:not(.off) [data-testid="year-empty"]'),
        line: r(".tab-pane:not(.off) .year-empty p"),
        canvas: r('.tab-pane:not(.off) [data-testid="year-canvas"]'),
      };
    });
    if (pet === "1") await p.screenshot({ path: path.join(OUT, `${B}-desk-${state ? "data" : "empty"}.png`) });
    if (pet === "1" && g.head) await pokeOnce(p, '.tab-pane:not(.off) [data-testid="pet-year-head"]', `${B} десктоп C место 5 (клик мышью)`);
    if (pet === "1" && g.empty) await pokeOnce(p, '.tab-pane:not(.off) [data-testid="pet-year-empty"]', `${B} десктоп C место 4 (клик мышью)`);
    await ctx.close();
    return g;
  };
  const e1 = await geo("1", null);
  const e0 = await geo("0", null);
  check(`${B} десктоп C место 4: клякса в области Year над строкой, блок и полотно — как со знаком P4`, e1.desk && e1.empty && e1.empty[1] < e1.line[1] && JSON.stringify(e1.emptyBlock) === JSON.stringify(e0.emptyBlock) && JSON.stringify(e1.canvas) === JSON.stringify(e0.canvas) && !e1.head, { e1, e0 });
  const d1 = await geo("1", states.past);
  const d0 = await geo("0", states.past);
  check(`${B} десктоп C место 5: клякса в тулбаре перед шестерёнкой, на одной линии; тулбар, заголовок, полотно — как без Питомца`, d1.head && d1.head[1] === d1.gear[1] && d1.head[0] < d1.gear[0] && JSON.stringify(d1.tb) === JSON.stringify(d0.tb) && JSON.stringify(d1.title) === JSON.stringify(d0.title) && JSON.stringify(d1.canvas) === JSON.stringify(d0.canvas), { d1, d0 });
}

// ---------------------------------------------------------------------------------------------------------- прогон
async function run(brn) {
  const b = await pw[brn].launch();
  const B = SHORT[brn];
  try {
    const states = ONLY === "4" ? {} : { today: (await seed(b, true)).state, past: (await seed(b, false)).state };
    if (ONLY === "desk") return await desk(b, B, states);
    // Место 4 — пустой Год.
    await place4(b, B, { dev: PHONE, scheme: "light", lang: "en", full: true });
    await place4(b, B, { dev: PHONE, scheme: "dark", lang: "en" });
    await place4(b, B, { dev: PHONE, scheme: "dark", lang: "uk" });
    await place4(b, B, { dev: PHONE, scheme: "light", lang: "ru", rm: true });
    await place4(b, B, { dev: SMALL, scheme: "light", lang: "en" });
    await place4(b, B, { dev: SMALL, scheme: "dark", lang: "ru" });
    await place4(b, B, { dev: PHONE, scheme: "light", lang: "uk", ax3: true });
    await place4(b, B, { dev: SMALL, scheme: "light", lang: "en", ax3: true });
    await place4Off(b, B);
    await scrollEnd(b, B, { dev: PHONE, scheme: "dark", lang: "en" });
    await scrollEnd(b, B, { dev: SMALL, scheme: "light", lang: "ru", ax3: true });
    if (ONLY === "4") return;
    // Место 5 — шапка Года.
    await place5(b, B, { dev: PHONE, scheme: "light", lang: "en", seed: "past", full: true }, states);
    await place5(b, B, { dev: PHONE, scheme: "dark", lang: "en", seed: "today", full: true }, states);
    await place5(b, B, { dev: PHONE, scheme: "light", lang: "uk", seed: "today" }, states);
    await place5(b, B, { dev: PHONE, scheme: "dark", lang: "ru", rm: true, seed: "past" }, states);
    await place5(b, B, { dev: SMALL, scheme: "light", lang: "en", seed: "past" }, states);
    await place5(b, B, { dev: SMALL, scheme: "dark", lang: "ru", seed: "today" }, states);
    await place5(b, B, { dev: PHONE, scheme: "light", lang: "uk", ax3: true, seed: "past" }, states);
    await place5(b, B, { dev: SMALL, scheme: "light", lang: "en", ax3: true, seed: "past" }, states);
    await place5(b, B, { dev: SMALL, scheme: "light", lang: "ru", ax3: true, seed: "today" }, states);
    await place5Off(b, B, states);
    await desk(b, B, states);
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
fs.writeFileSync(path.join(OUT, `results-${BROWSERS.join("-")}.json`), JSON.stringify(results, null, 1));
console.log(`\n${total - fails.length}/${total} PASS`);
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
