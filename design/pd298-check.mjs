/**
 * PD-298 — живая проверка: реакция Питомца на тап A «Плюх» и новые места 1, 3, 6, 7, 8 (макет design/pd296-pet-places.md/.html,
 * кадры design/pd296-shots/). РЕАЛЬНАЯ сборка.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd298-dist
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend DIST=/tmp/pd298-dist PORT=5811 \
 *     node design/pd298-check.mjs [chromium] [webkit]
 *   ONLY=share — только лист «Поделиться» (карточка, место 8, Share на 393/430/320/AX3).
 *
 * Условия — как pd285-check: html font-size 17 px (40 px — AX3), --sa-top/--sa-bot 59/34 (393×852) и 20/0 (320×568), isMobile +
 * hasTouch, light/dark, en/uk/ru, Reduce Motion. Сервер — design/pdlow4/lib.mjs (статическая раздача + мок /api/daily), время
 * зафиксировано. Ошибки и ожидание делаются без сети: /api/daily → 503 (page.route), генератор — подменённый Worker (init script):
 * `fail` — отвечает ошибкой (Today «не загрузилось»), `stall` — молчит (Play «Preparing a puzzle…»).
 *
 * Тап: 1 — реакция (data-poke, анимация petPokeA на .poke, 440 мс; RM — 200 мс и тождественный transform, брызги мигают до .25);
 *   2 — серия быстрых тапов (во время реакции проглатываются: одна реакция), серия по одному после конца — амплитуды 1,1,1,½,½,½,0;
 *   3 — палец ушёл (прокрутка Settings, начатая на превью): прокрутка идёт, реакции нет (chromium — настоящие касания CDP; webkit —
 *   синтетические PointerEvent: логика без preventDefault); жест «назад» с края Settings (standalone) работает и с кляксами на экране.
 * Места: 1 — шапка Today до решения; 3 — ожидание генерации Play (+ RM-мерцание, ошибка); 6 — Settings: превью стоят, тап оживляет
 *   одно; 7 — Today «не загрузилось» и архив «день недоступен»; 8 — лист экспорта: «Show Blot», печать в PNG (пиксели), выкл — без;
 *   Share на 393×852 с Питомцем виден без прокрутки там же, где без него (430×932 — тоже; 320×568 и AX3 — достижим прокруткой).
 *   Плюс карточка результата: во время посадки тап игнорируется, после — «Плюх». Везде: Питомец выкл → кляксы нет; на экране
 *   дышит не больше одной кляксы; зона ≥ 44, не перекрывает текст/кнопки (elementFromPoint); 320 + AX3 — клякса уходит или не
 *   ломает раскладку (ряд действий над таб-баром). Кадры — design/pd298-shots/ (не коммитятся, кроме ключевых).
 */
import fs from "node:fs";
import path from "node:path";
import { pw, serve, MISSION, SOLUTION, NOW } from "./pdlow4/lib.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? "/tmp/pd298-dist");
const PORT = +(process.env.PORT ?? 5811);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(HERE, "pd298-shots");
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2).filter((a) => ["chromium", "webkit"].includes(a));
const BROWSERS = args.length ? args : ["chromium", "webkit"];
const SHORT = { chromium: "cr", webkit: "wk" };
const PANE = ".tab-pane:not(.off)";
const LOCALE = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };

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
const TALL = { w: 430, h: 932, top: 59, bot: 34 };

async function open(browser, { dev = PHONE, scheme = "light", lang = "en", rm = false, ax3 = false, pet, worker = "real", apiDown = false, route = "today", standalone = false } = {}) {
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
  });
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript(
    ({ pet, lang, worker, fsPx, top, bot, standalone }) => {
      if (!sessionStorage.getItem("pd298-init")) {
        sessionStorage.setItem("pd298-init", "1");
        localStorage.setItem("pundoku.locale", lang);
        if (pet !== undefined) localStorage.setItem("pundoku.pet", pet);
      }
      if (standalone) Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });
      if (worker !== "real") {
        // Генератор без сети и без ответа: `fail` — ошибка (фолбэк дня не получился), `stall` — молчит (ожидание).
        window.Worker = class {
          constructor() {
            this.onmessage = null;
            this.onerror = null;
          }
          postMessage(req) {
            if (worker === "fail") setTimeout(() => this.onmessage?.({ data: { id: req.id, ok: false, error: "pd298" } }), 30);
          }
          terminate() {}
          addEventListener() {}
          removeEventListener() {}
        };
      }
      let x = 0x9e3779b9;
      crypto.getRandomValues = (a) => {
        for (let i = 0; i < a.length; i++) {
          x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
          a[i] = x & (a.BYTES_PER_ELEMENT === 1 ? 0xff : a.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffffffff);
        }
        return a;
      };
      const add = () => {
        const st = document.createElement("style");
        st.id = "pd298-env";
        st.textContent = `html{font-size:${fsPx}px !important}:root{--sa-top:${top}px !important;--sa-bot:${bot}px !important}`;
        document.documentElement.appendChild(st);
      };
      if (document.documentElement) add();
      else document.addEventListener("DOMContentLoaded", add);
    },
    { pet, lang, worker, fsPx: ax3 ? 40 : 17, top: dev.top, bot: dev.bot, standalone },
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  if (apiDown) await p.route("**/api/daily/**", (r) => r.fulfill({ status: 503, body: "" }));
  await p.goto(`${BASE}/#/${route}`);
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}

// ---------------------------------------------------------------------------------------------------------- замеры
/** Клякса и её зона: рамки, атрибуты, анимации. */
const petInfo = (p, zoneSel) =>
  p.evaluate((zoneSel) => {
    const z = document.querySelector(zoneSel);
    if (!z) return null;
    const pet = z.querySelector(".pet");
    const zr = z.getBoundingClientRect();
    const pr = pet?.getBoundingClientRect();
    const anims = pet ? pet.getAnimations({ subtree: true }).map((a) => ({ name: a.animationName, cls: a.effect.target.className, state: a.playState, dur: a.effect.getTiming().duration })) : [];
    const cs = getComputedStyle(z);
    return {
      hidden: z.hidden || cs.display === "none",
      zone: { x: zr.left, y: zr.top, w: zr.width, h: zr.height, r: zr.right, b: zr.bottom },
      pet: pr && { x: pr.left, y: pr.top, w: pr.width, h: pr.height },
      mood: pet?.getAttribute("data-mood"),
      label: pet?.getAttribute("aria-label"),
      idle: pet?.hasAttribute("data-idle"),
      poke: pet?.getAttribute("data-poke"),
      amp: pet?.style.getPropertyValue("--amp"),
      anims,
      role: z.getAttribute("role"),
      tabindex: z.getAttribute("tabindex"),
      touchAction: cs.touchAction,
      pointer: cs.pointerEvents,
    };
  }, zoneSel);
/** Сколько клякс на экране дышат (видимы во вьюпорте, покой идёт). */
const breathing = (p) =>
  p.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    return [...document.querySelectorAll(".pet")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
      if (el.closest(".tab-pane.off, [hidden]")) return false;
      return el.getAnimations({ subtree: true }).some((a) => a.effect.target.classList.contains("breath") && a.playState === "running");
    }).length;
  });
/** Пересечение рамки зоны с элементами (текст/кнопки) по селекторам. */
const overlaps = (p, zoneSel, sels, { ink = false } = {}) =>
  p.evaluate(
    ({ zoneSel, sels, ink }) => {
      const zone = document.querySelector(zoneSel);
      // ink — рамка самих чернил (тело + капельки), а не зоны нажатия: зона 44 с полями −8 (как у кнопок шапки) может заходить
      // на строку подписи — это касание, а не наезд рисунка на текст.
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
          const rects = el.matches("p, h1, h2, span, small, figcaption")
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
/** elementFromPoint в центре элемента — он сам (или его потомок). */
const hitSelf = (p, sel) =>
  p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, sel);

/**
 * Лист «Поделиться»: геометрия без прокрутки — тело листа (видимая область), Share, ряд «Show Blot», превью; низ видимого —
 * min(низ тела листа, вьюпорт − нижний inset). QA PD-298: на 393×852 с Питомцем Share уходил под низ (848–894 при ≈ 808).
 */
const shareGeo = (p) =>
  p.evaluate(() => {
    const body = document.querySelector('[data-testid="export-sheet"] .tl-body');
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: b.width, h: b.height };
    };
    const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sa-bot")) || 0;
    const bd = r(body);
    return {
      scrollTop: body.scrollTop,
      body: bd,
      visBottom: Math.min(bd.bottom, innerHeight - sab),
      share: r(document.querySelector('[data-testid="fp-share"]')),
      row: r(document.querySelector('[data-testid="fp-pet-toggle"]')?.closest("label")),
      sw: r(document.querySelector('[data-testid="fp-pet-toggle"]')),
      img: r(document.querySelector('[data-testid="fp-image"]')),
      sheet: r(document.querySelector('[data-testid="export-sheet"] .tl-sheet')),
    };
  });
/** Share виден целиком без прокрутки: под верхом тела листа, над низом видимого (и нижним inset). */
const shareVisible = (g) => g.scrollTop === 0 && g.share.top >= g.body.top && g.share.bottom <= g.visBottom;
/** Ряд «Show Blot» не обрезан: целиком в видимой области тела и внутри листа по горизонтали (переключатель тоже). */
const rowVisible = (g) => !!g.row && g.row.top >= g.body.top && g.row.bottom <= g.visBottom && g.sw.left >= g.sheet.left && g.sw.right <= g.sheet.right;
/** Положение Share без Питомца (main-вид) на 393×852 — для сравнения с Питомцем (заполняет shareOff/cardAndShare). */
const SHARE_AT = {};

/** Записывать каждый старт реакции (data-poke появился) с --amp. */
const watchPokes = (p) =>
  p.evaluate(() => {
    window.__pokes = [];
    new MutationObserver((ms) => {
      for (const m of ms) if (m.attributeName === "data-poke" && m.target.getAttribute("data-poke")) window.__pokes.push(m.target.style.getPropertyValue("--amp"));
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-poke"] });
  });
const pokes = (p) => p.evaluate(() => window.__pokes.slice());

/** Тап пальцем по центру зоны (Playwright touchscreen: touch → pointer события браузера). */
async function tapZone(p, sel) {
  const b = await p.locator(sel).boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  // Десктоп C (без касаний) — клик мышью: те же pointer-события.
  if (p.context()._pd298Mouse) return p.mouse.click(x, y);
  await p.touchscreen.tap(x, y);
}

/**
 * Конец реакции: data-poke снят и petPokeA нет — ждём опросом до `limit` мс (а не фиксированный порог: в webkit data-poke
 * снимается по animationend через 480–570 мс после тапа при длительности 440, фиксированные 650 мс флакали 1 из 3).
 */
async function pokeEnd(p, sel, limit = 1000, step = 40) {
  const t0 = Date.now();
  for (;;) {
    const b = await petInfo(p, sel);
    const done = !b.poke && !b.anims.some((x) => x.name === "petPokeA");
    if (done || Date.now() - t0 >= limit) return { ...b, done, waited: Date.now() - t0 };
    await p.waitForTimeout(step);
  }
}

/** Реакция на тап: появилась, анимация «Плюха» идёт; снята не позже чем за 1000 мс (опрос, см. pokeEnd). */
async function pokeOnce(p, sel, tag, { rm = false } = {}) {
  await tapZone(p, sel);
  await p.waitForTimeout(40);
  const a = await petInfo(p, sel);
  const anim = a.anims.find((x) => x.name === "petPokeA");
  check(`${tag}: тап → «Плюх» (data-poke=A, petPokeA ${rm ? "200" : "440"} мс)`, a.poke === "A" && anim && Math.round(anim.dur) === (rm ? 200 : 440), { poke: a.poke, anim, amp: a.amp });
  check(`${tag}: настроение тапом не меняется${a.label ? ", имя то же" : " (превью — украшение без имени)"}`, a.mood && (a.label || sel.includes("pet-preview")), { mood: a.mood, label: a.label });
  await p.waitForTimeout(rm ? 150 : 380); // реакция ещё идёт (200/440 мс) — опрос начинается ближе к её концу
  const b = await pokeEnd(p, sel);
  check(`${tag}: реакция закончилась (≤ 1000 мс опроса) — data-poke снят, petPokeA нет`, b.done, { poke: b.poke, anims: b.anims.map((x) => x.name), waited: b.waited });
}

/**
 * Анти-спам: серия быстрых тапов — каждая реакция начинается не раньше конца предыдущей (440 мс; при RM 200), тапы между ними
 * проглочены (без перезапуска и очереди); затем по одному после конца — амплитуды по окну 5 с: 1–3 → 1, 4–6 → ½, 7+ → 0.
 */
async function antiSpam(p, sel, tag, { rm = false } = {}) {
  await p.waitForTimeout(5200); // окно усталости от прошлых тапов прошло
  await p.evaluate(() => {
    window.__pokeT = [];
    window.__tapT = [];
    new MutationObserver((ms) => {
      for (const m of ms) if (m.attributeName === "data-poke" && m.target.getAttribute("data-poke")) window.__pokeT.push(performance.now());
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-poke"] });
    document.addEventListener("pointerup", () => window.__tapT.push(performance.now()), true);
  });
  await watchPokes(p);
  const b = await p.locator(sel).boundingBox();
  for (let i = 0; i < 8; i++) await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await p.waitForTimeout(600);
  const t = await p.evaluate(() => ({ pokes: window.__pokeT.slice(), taps: window.__tapT.slice() }));
  const D = rm ? 200 : 440;
  const gaps = t.pokes.slice(1).map((x, i) => Math.round(x - t.pokes[i]));
  const fast = await pokes(p);
  check(
    `${tag}: ${t.taps.length} быстрых тапов за ${Math.round(t.taps[t.taps.length - 1] - t.taps[0])} мс — ${fast.length} реакц.; каждая не раньше конца предыдущей (≥ ${D} мс), остальные проглочены`,
    t.taps.length === 8 && fast.length >= 1 && fast.length < 8 && gaps.every((g) => g >= D - 5),
    { gaps, fast },
  );
  const before = fast.length;
  for (let i = 0; i < 7; i++) {
    await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    // Следующий тап — сразу после конца реакции (раньше D она кончиться не может; дальше опрос): фиксированные D + 120 мс в webkit
    // попадали в ещё идущую реакцию (data-poke снимается через 480–570 мс) — тап проглатывался, серия сдвигалась. Шаг 15 мс —
    // чтобы 7 тапов уложились в окно 5 с, как с фиксированной паузой.
    await p.waitForTimeout(D);
    await pokeEnd(p, sel, 1000, 15);
    await p.waitForTimeout(20);
  }
  const series = (await pokes(p)).slice(before);
  const amp = (n) => (n <= 3 ? "1" : n <= 6 ? "0.5" : "0");
  const expected = Array.from({ length: 7 }, (_, i) => amp(before + i + 1));
  check(`${tag}: серия по одному в окне 5 с — амплитуды ${expected.join(",")} (1–3 полная, 4–6 ½, с 7-го только брызги)`, series.join(",") === expected.join(","), series);
}

/** Reduce Motion: тело стоит (transform .poke тождественный), брызги мигают до .25. */
async function rmProbe(p, sel, tag) {
  await tapZone(p, sel);
  await p.waitForTimeout(20);
  const r = await p.evaluate((sel) => {
    const pet = document.querySelector(sel).querySelector(".pet");
    const out = { poke: [], drop: null };
    const anims = pet.getAnimations({ subtree: true });
    const body = anims.find((a) => a.animationName === "petPokeA");
    const drop = anims.find((a) => a.animationName === "petPokeDropA");
    if (!body) return null;
    for (const t of [0, 50, 100, 150]) {
      for (const a of anims) {
        a.pause();
        a.currentTime = t;
      }
      out.poke.push(getComputedStyle(pet.querySelector(".poke")).transform);
    }
    if (drop) {
      drop.currentTime = 56; // 28 % от 200 мс
      out.drop = +getComputedStyle(drop.effect.target).opacity;
    }
    for (const a of anims) a.finish?.();
    return out;
  }, sel);
  const ident = (t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
  check(`${tag}: RM — тело стоит (transform .poke тождественный в 4 точках)`, r && r.poke.every(ident), r);
  check(`${tag}: RM — брызги мигают прозрачностью до ≈ .25`, r && r.drop !== null && Math.abs(r.drop - 0.25) < 0.03, r?.drop);
  await p.waitForTimeout(300);
}

async function solveToday(p) {
  const empties = [...MISSION].flatMap((g, i) => (g === "0" ? [i] : []));
  for (const i of empties) {
    await p.locator(`${PANE} .board button.cell[data-i="${i}"]`).click();
    await p.keyboard.press(SOLUTION[i]);
  }
  await p.locator(`${PANE} [data-testid="result-card"]`).waitFor({ timeout: 15000 });
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const noErrs = (errs) => errs.filter((e) => !/\/api\//.test(e));

// ---------------------------------------------------------------------------------------------------------- места
const HEAD = `${PANE} [data-testid="pet-today"]`;

async function place1(b, B, c) {
  const tag = `${B} место 1 ${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;
  const { ctx, p, errs } = await open(b, c);
  try {
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    await p.waitForTimeout(1300); // AX3 включается атрибутом после первой раскладки — клякса могла уйти чуть позже
    const a = await petInfo(p, HEAD);
    const title = await p.evaluate((P) => {
      const t = document.querySelector(`${P} .toolbar > .title`);
      return { clipped: t.scrollWidth > t.clientWidth + 1, text: t.textContent };
    }, PANE);
    const hint = await p.evaluate((P) => {
      const r = document.querySelector(`${P} .toolbar`).getBoundingClientRect();
      return { w: r.width };
    }, PANE);
    if (!a) {
      check(`${tag}: клякса в шапке есть`, false, "нет зоны");
      return;
    }
    if (a.hidden) {
      // Уйти можно только когда места нет: на 320 + AX3 (или крупный текст uk/ru) — и тогда заголовок цел.
      check(`${tag}: клякса ушла (мало места) — только на узком+AX3; заголовок не обрезан`, c.ax3 && !title.clipped, { title, hint });
    } else {
      check(`${tag}: спящая клякса 40 pt в зоне ≥ 44, дышит${c.rm ? " (RM — стоит)" : ""}`, a.mood === "asleep" && a.zone.w >= 44 && a.zone.h >= 44 && Math.round(a.pet.w) === 40 && (c.rm ? !a.idle : a.idle && a.anims.some((x) => x.cls === "breath" && x.state === "running")), a);
      const ov = await overlaps(p, HEAD, [`${PANE} .toolbar > .title`, `${PANE} [data-testid="hint-button"]`, `${PANE} [data-testid="open-settings"]`]);
      const ovInk = await overlaps(p, HEAD, [`${PANE} .toolbar > .title`, `${PANE} .subline > *`], { ink: true });
      check(`${tag}: зона не наезжает на заголовок, лампочку, шестерёнку; чернила — на подпись; заголовок не обрезан`, ov.length === 0 && ovInk.length === 0 && !title.clipped, { ov, ovInk, title });
      check(`${tag}: лампочка и шестерёнка нажимаются (elementFromPoint)`, (await hitSelf(p, `${PANE} [data-testid="hint-button"]`)) && (await hitSelf(p, `${PANE} [data-testid="open-settings"]`)));
      const line = await p.evaluate((P) => {
        const hint = document.querySelector(`${P} [data-testid="hint-button"]`).getBoundingClientRect();
        const z = document.querySelector(`${P} [data-testid="pet-today"]`).getBoundingClientRect();
        const end = document.querySelector(`${P} .toolbar-end`).getBoundingClientRect();
        return { zTop: Math.round(z.top), hintTop: Math.round(hint.top), endH: Math.round(end.height) };
      }, PANE);
      check(`${tag}: зона на одной линии с лампочкой, шапка не выше прежнего (поля −8 как у кнопок)`, line.zTop === line.hintTop && line.endH <= 29, line);
      check(`${tag}: зона — украшение (без role/tabindex), touch-action manipulation, ловит касания`, !a.role && !a.tabindex && a.touchAction === "manipulation" && a.pointer === "auto", a);
    }
    check(`${tag}: на экране дышит не больше одной кляксы`, (await breathing(p)) <= 1);
    check(`${tag}: на поле кляксы нет`, (await p.locator(`${PANE} .board .pet`).count()) === 0);
    // Ряд действий над таб-баром (раскладка Today не сломана).
    const fit = await p.evaluate((P) => {
      const pad = document.querySelector(`${P} .pad, ${P} .pad-wrap`)?.getBoundingClientRect();
      const tb = document.querySelector(".tabbar")?.getBoundingClientRect();
      return pad && tb ? { padBottom: Math.round(pad.bottom), tabTop: Math.round(tb.top) } : null;
    }, PANE);
    if (!c.ax3) check(`${tag}: панель цифр над таб-баром`, fit && fit.padBottom <= fit.tabTop + 1, fit);
    await shot(p, `${B}-p1-today-${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`);
    if (c.full && !a.hidden) {
      await pokeOnce(p, HEAD, tag);
      // Кадр «Плюха» на 25 % (сплющен) — для сверки с tap-A-squash-1.
      await tapZone(p, HEAD);
      await p.evaluate((sel) => {
        for (const x of document.querySelector(sel).querySelector(".pet").getAnimations({ subtree: true })) if (x.animationName.startsWith("petPoke")) (x.pause(), (x.currentTime = 110));
      }, HEAD);
      await p.locator(`${PANE} .toolbar`).screenshot({ path: path.join(OUT, `${B}-tap-A-squash-header.png`) });
      await p.evaluate((sel) => {
        for (const x of document.querySelector(sel).querySelector(".pet").getAnimations({ subtree: true })) if (x.animationName.startsWith("petPoke")) x.finish();
      }, HEAD);
      await p.waitForTimeout(300);
      await antiSpam(p, HEAD, tag);
    }
    if (c.rm && !a.hidden) await rmProbe(p, HEAD, tag);
    check(`${tag}: без ошибок страницы`, noErrs(errs).length === 0, noErrs(errs).slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

async function place1Off(b, B) {
  const { ctx, p } = await open(b, { pet: "0" });
  try {
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    check(`${B} место 1: Питомец выкл — в шапке кляксы нет`, (await p.locator(HEAD).count()) === 0);
  } finally {
    await ctx.close();
  }
}

/** Карточка результата: во время посадки тап игнорируется, после — «Плюх»; шапочной кляксы после решения нет. Плюс место 8. */
async function cardAndShare(b, B, c) {
  const tag = `${B} карточка/место 8 ${c.scheme}`;
  const { ctx, p, errs } = await open(b, c);
  const CARD = `${PANE} [data-testid="pet-card"]`;
  try {
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    await solveToday(p);
    await p.locator(`${CARD} .pet[data-act="arrive"]`).waitFor({ timeout: 10000 });
    check(`${tag}: день решён — кляксы в шапке нет`, (await p.locator(HEAD).count()) === 0);
    // После решения панель докручивает к Grid ∞ (≈300 мс после карточки) — вне экрана посадка на паузе; вернуть карточку в вид.
    await p.waitForTimeout(900);
    await p.evaluate(() => document.querySelector('.tab-pane:not(.off) [data-testid="result-card"]').scrollIntoView({ block: "start" }));
    await p.waitForTimeout(150);
    await watchPokes(p);
    await tapZone(p, CARD);
    await p.waitForTimeout(60);
    const during = await petInfo(p, CARD);
    check(`${tag}: во время посадки тап игнорируется`, during.poke === null || during.poke === "" || during.poke === undefined, { poke: during.poke, anims: during.anims.map((x) => x.name) });
    await p.waitForTimeout(1500);
    const after = await petInfo(p, CARD);
    check(`${tag}: посадка доиграла (finished, без перемонтажа) — дышит`, after.idle && after.anims.filter((x) => x.name.startsWith("petArrive")).every((x) => x.state === "finished") && after.anims.some((x) => x.cls === "breath" && x.state === "running"), after.anims);
    await pokeOnce(p, CARD, `${tag} карточка`);
    check(`${tag}: на экране дышит не больше одной кляксы`, (await breathing(p)) <= 1);

    // Место 8: лист экспорта.
    await p.locator(`${PANE} [data-testid="share"]`).first().click();
    await p.locator('[data-testid="export-sheet"]').waitFor();
    await p.locator('[data-testid="fp-image"]').waitFor({ timeout: 10000 });
    await p.waitForTimeout(400);
    const sw = p.locator('[data-testid="fp-pet-toggle"]');
    check(`${tag}: «Show Blot» есть, вкл по умолчанию`, (await sw.count()) === 1 && (await sw.isChecked()));
    if (c.dev === PHONE && !c.ax3) {
      const g = await shareGeo(p);
      (SHARE_AT[B] ??= {}).on = g.share;
      check(`${tag}: 393×852 с Питомцем — Share виден без прокрутки (${g.share.top}–${g.share.bottom} ≤ ${g.visBottom})`, shareVisible(g), g);
      check(`${tag}: ряд «Show Blot» не обрезан (${g.row?.top}–${g.row?.bottom}), ≥ 44 pt`, rowVisible(g) && g.row.h >= 44, { row: g.row, sw: g.sw, visBottom: g.visBottom });
      check(`${tag}: превью PNG в пропорции 1080×1350 (${Math.round(g.img.w)}×${Math.round(g.img.h)})`, Math.abs(g.img.w / g.img.h - 0.8) < 0.01, g.img);
    }
    const label = await p.evaluate(() => document.querySelector('[data-testid="fp-pet-toggle"]').closest("label").textContent);
    check(`${tag}: подпись «${label}»`, label === { en: "Show Blot", uk: "Показувати ляпку", ru: "Показывать кляксу" }[c.lang], label);
    /** Пиксели PNG: центр тела печати (ink?) и угол полосы (бумага). */
    const px = () =>
      p.evaluate(async () => {
        const img = document.querySelector('[data-testid="fp-image"]');
        await img.decode().catch(() => {});
        const cv = document.createElement("canvas");
        cv.width = 1080;
        cv.height = 1350;
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0, 1080, 1350);
        const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
        // Тело «довольна»: центр (24, ≈28.3) поля 48 → печать 112 px в (892, 19).
        let ink = 0;
        for (let y = 60; y < 110; y += 4) for (let x = 900; x < 1000; x += 4) {
          const [r, gg, bb] = at(x, y);
          if (Math.abs(r - 0x3b) < 24 && Math.abs(gg - 0x48) < 24 && Math.abs(bb - 0xb0) < 24) ink++;
        }
        return { ink, paper: at(40, 40), src: img.src.slice(0, 5) };
      });
    const on = await px();
    check(`${tag}: PNG с печатью — чернила в верхней полосе справа (светлый PNG, бумага белая)`, on.ink > 30 && on.paper.every((v) => v > 250), on);
    await p.locator('[data-testid="export-sheet"]').screenshot({ path: path.join(OUT, `${B}-p8-share-${c.scheme}-${c.lang}-on.png`) });
    await sw.click();
    await p.waitForTimeout(600);
    const off = await px();
    check(`${tag}: выкл «Show Blot» — PNG перерисован без печати; выбор запомнен`, off.ink === 0 && (await p.evaluate(() => localStorage.getItem("pundoku.sharePet"))) === "0", off);
    await p.locator('[data-testid="export-sheet"]').screenshot({ path: path.join(OUT, `${B}-p8-share-${c.scheme}-${c.lang}-off.png`) });
    await sw.click();
    await p.waitForTimeout(300);
    check(`${tag}: без ошибок страницы`, noErrs(errs).length === 0, noErrs(errs).slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

async function shareOff(b, B) {
  const { ctx, p } = await open(b, { pet: "0" });
  try {
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    await solveToday(p);
    await p.waitForTimeout(1200);
    await p.locator(`${PANE} [data-testid="share"]`).first().click();
    await p.locator('[data-testid="fp-image"]').waitFor({ timeout: 10000 });
    check(`${B} место 8: Питомец выкл — «Show Blot» нет`, (await p.locator('[data-testid="fp-pet-toggle"]').count()) === 0);
    await p.waitForTimeout(400);
    const g = await shareGeo(p);
    const on = SHARE_AT[B]?.on;
    check(`${B} место 8: Питомец выкл (main-вид) — Share виден без прокрутки (${g.share.top}–${g.share.bottom}); с Питомцем Share там же (±2: ${on?.top}–${on?.bottom})`, shareVisible(g) && !!on && Math.abs(on.top - g.share.top) <= 2, { off: g.share, on, img: g.img });
  } finally {
    await ctx.close();
  }
}

/** Лист «Поделиться» с Питомцем на других экранах: 430×932 — Share виден без прокрутки; 320×568 и AX3 — прокрутка тела допустима, но Share достижим (elementFromPoint), «Show Blot» не обрезан по ширине. */
async function shareFit(b, B, c) {
  const tag = `${B} место 8 Share ${c.dev.w}×${c.dev.h}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}`;
  const { ctx, p, errs } = await open(b, c);
  try {
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    await solveToday(p);
    await p.waitForTimeout(1200);
    await p.locator(`${PANE} [data-testid="share"]`).first().click();
    await p.locator('[data-testid="fp-image"]').waitFor({ timeout: 10000 });
    await p.waitForTimeout(400);
    const g = await shareGeo(p);
    if (c.fits) check(`${tag}: Share виден без прокрутки (${g.share.top}–${g.share.bottom} ≤ ${g.visBottom}), «Show Blot» не обрезан`, shareVisible(g) && rowVisible(g), g);
    await p.evaluate(() => document.querySelector('[data-testid="fp-share"]').scrollIntoView({ block: "nearest" }));
    await p.waitForTimeout(200);
    const g2 = await shareGeo(p);
    check(
      `${tag}: Share достижим${g.scrollTop === g2.scrollTop ? "" : ` (прокрутка тела ${g2.scrollTop})`} — целиком в видимой области, нажимается; переключатель внутри листа`,
      g2.share.bottom <= g2.visBottom && g2.share.top >= g2.body.top && (await hitSelf(p, '[data-testid="fp-share"]')) && g2.sw.left >= g2.sheet.left && g2.sw.right <= g2.sheet.right,
      { share: g2.share, visBottom: g2.visBottom, sw: g2.sw },
    );
    check(`${tag}: превью PNG в пропорции 1080×1350 (${Math.round(g.img.w)}×${Math.round(g.img.h)})`, Math.abs(g.img.w / g.img.h - 0.8) < 0.01, g.img);
    await p.locator('[data-testid="export-sheet"]').screenshot({ path: path.join(OUT, `${B}-p8-fit-${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}.png`) });
    check(`${tag}: без ошибок страницы`, noErrs(errs).length === 0, noErrs(errs).slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

async function place7(b, B, c) {
  const tag = `${B} место 7 ${c.archive ? "архив " : ""}${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}`;
  const { ctx, p, errs } = await open(b, { ...c, apiDown: !c.archive, worker: c.archive ? "real" : "fail", route: c.archive ? "day/2026-09-01" : "today" });
  try {
    if (c.archive) await p.route("**/api/daily/2026-09-01", (r) => r.fulfill({ status: 404, body: "" }));
    if (c.archive) await p.reload();
    await p.locator('[data-testid="status-pet"]').first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(500);
    const Z = '[data-testid="pet-error"]';
    const a = await petInfo(p, Z);
    check(`${tag}: в шапке кляксы нет (одна на экране)`, (await p.locator(HEAD).count()) === 0);
    if (c.dev.w < 360 && c.ax3) {
      check(`${tag}: 320 + AX3 — клякса ушла, текст на месте`, a.hidden, a);
    } else {
      check(`${tag}: спящая клякса 40 pt в зоне ≥ 44, дышит`, !a.hidden && a.mood === "asleep" && a.zone.w >= 44 && a.zone.h >= 44 && Math.round(a.pet.w) === 40 && a.idle, a);
      const ov = await overlaps(p, Z, ['[data-testid="status-pet"] .status', '[data-testid="status-pet"] .status .link']);
      check(`${tag}: зона не наезжает на текст и «Try again»`, ov.length === 0, ov);
      if (!c.archive) check(`${tag}: «Try again» нажимается (elementFromPoint)`, await hitSelf(p, '[data-testid="status-pet"] .status .link'));
      if (c.ax3) {
        const col = await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="status-pet"]')).flexDirection);
        check(`${tag}: AX3 — клякса над текстом`, col === "column", col);
      }
      if (c.full) await pokeOnce(p, Z, tag);
    }
    if (!c.ax3 && !c.archive) {
      const fit = await p.evaluate((P) => {
        const pad = document.querySelector(`${P} .pad, ${P} .pad-wrap`)?.getBoundingClientRect();
        const tb = document.querySelector(".tabbar")?.getBoundingClientRect();
        return pad && tb ? { padBottom: Math.round(pad.bottom), tabTop: Math.round(tb.top) } : null;
      }, PANE);
      check(`${tag}: зазор не вырос — панель цифр над таб-баром`, fit && fit.padBottom <= fit.tabTop + 1, fit);
    }
    check(`${tag}: на экране дышит не больше одной кляксы`, (await breathing(p)) <= 1);
    await shot(p, `${B}-p7-${c.archive ? "archive" : "today"}-${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}`);
    check(`${tag}: без ошибок страницы`, noErrs(errs).length === 0, noErrs(errs).slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

async function place7Off(b, B) {
  const { ctx, p } = await open(b, { pet: "0", apiDown: true, worker: "fail" });
  try {
    await p.locator(`${PANE} .gap .status[role="alert"]`).waitFor({ timeout: 30000 });
    check(`${B} место 7: Питомец выкл — кляксы у ошибки нет`, (await p.locator('[data-testid="status-pet"]').count()) === 0);
  } finally {
    await ctx.close();
  }
}

async function place3(b, B, c) {
  const tag = `${B} место 3 ${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}${c.pet === "0" ? "-off" : ""}`;
  const { ctx, p, errs } = await open(b, { ...c, worker: "stall", route: "play" });
  try {
    await p.locator(`${PANE} [data-testid="mode-classic"]`).first().waitFor({ timeout: 60000 });
    await p.locator(`${PANE} [data-testid="mode-classic"]`).tap();
    await p.locator('[data-testid="sheet-start"]').waitFor();
    await p.waitForTimeout(400);
    const easy = p.locator('[data-testid="difficulty-easy"]');
    if (await easy.count()) await easy.tap();
    await p.locator('[data-testid="sheet-start"]').tap();
    await p.locator('[data-testid="wait-panel"]').waitFor({ timeout: 5000 });
    await p.waitForTimeout(500);
    const Z = '[data-testid="pet-wait"]';
    if (c.pet === "0") {
      check(`${tag}: Питомец выкл — знак P4, кляксы нет`, (await p.locator(Z).count()) === 0 && (await p.locator(".wait-mark").count()) === 1);
      return;
    }
    const a = await petInfo(p, Z);
    const small = c.dev.w < 360 && c.ax3;
    check(`${tag}: вместо P4 — спящая клякса ${small ? 44 : 56} pt${c.rm ? " (RM — стоит)" : ", дышит"}`, a && (await p.locator(".wait-mark").count()) === 0 && a.mood === "asleep" && Math.round(a.zone.w) === (small ? 44 : 56) && (c.rm ? !a.idle : a.idle), a);
    const pulse = await p.evaluate((Z) => document.querySelector(Z).getAnimations().map((x) => x.animationName), Z);
    check(`${tag}: ожидание видно и при RM — мерцание прозрачностью зоны (waitPulse)`, pulse.includes("waitPulse"), pulse);
    const ov = await overlaps(p, Z, [".wait-text", ".wait-btn"]);
    check(`${tag}: клякса не наезжает на текст`, ov.length === 0, ov);
    check(`${tag}: на экране дышит не больше одной кляксы`, (await breathing(p)) <= 1);
    await shot(p, `${B}-p3-wait-${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`);
    if (c.full) await pokeOnce(p, Z, tag, { rm: c.rm });
    if (c.rm) await rmProbe(p, Z, tag);
    if (c.error) {
      await p.locator('[data-testid="wait-retry"]').waitFor({ timeout: 20000 });
      const e = await petInfo(p, Z);
      const still = await p.evaluate((Z) => document.querySelector(Z).getAnimations().length, Z);
      check(`${tag}: ошибка генерации — клякса осталась, без мерцания; «Try again» нажимается`, e && e.mood === "asleep" && still === 0 && (await hitSelf(p, '[data-testid="wait-retry"]')), { still });
      await shot(p, `${B}-p3-wait-error-${c.dev.w}-${c.scheme}-${c.lang}`);
    }
    check(`${tag}: без ошибок страницы`, noErrs(errs).length === 0, noErrs(errs).slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

/** Палец: chromium — настоящие касания CDP (браузер сам решает прокрутку), webkit — синтетические PointerEvent. */
function finger(p, real) {
  if (real) {
    let cdp = null;
    let ts = 0;
    const send = async (type, x, y, dt) => {
      cdp ??= await p.context().newCDPSession(p);
      ts = type === "touchStart" ? Math.max(Date.now(), ts + 16) : ts + dt;
      await cdp.send("Input.dispatchTouchEvent", { type, timestamp: ts / 1000, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    };
    return { down: (x, y) => send("touchStart", x, y, 0), move: (x, y) => send("touchMove", x, y, 16), up: () => send("touchEnd", 0, 0, 16) };
  }
  let last = [0, 0];
  const fire = (type, x, y) =>
    p.evaluate(
      ([type, x, y]) => {
        const target = type === "pointerdown" ? document.elementFromPoint(x, y) : (window.__pdTarget ?? document);
        if (type === "pointerdown") window.__pdTarget = target;
        const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
        target.dispatchEvent(ev);
        return ev.defaultPrevented;
      },
      [type, x, y],
    );
  return {
    down: (x, y) => ((last = [x, y]), fire("pointerdown", x, y)),
    move: (x, y) => ((last = [x, y]), fire("pointermove", x, y)),
    up: () => fire("pointerup", ...last),
  };
}

async function place6(b, B, c) {
  const tag = `${B} место 6 ${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;
  const { ctx, p, errs } = await open(b, { ...c, route: "settings" });
  try {
    await p.locator('[data-testid="settings-screen"]').waitFor({ timeout: 30000 });
    await p.evaluate(() => document.querySelector('[data-testid="pet-moods"]').scrollIntoView({ block: "center" }));
    await p.waitForTimeout(600);
    const zones = ["happy", "tired", "surprised", "asleep"].map((m) => `[data-testid="pet-preview-${m}"]`);
    const all = [];
    for (const z of zones) all.push(await petInfo(p, z));
    check(`${tag}: 4 превью стоят (ни одного дыхания), зона ≥ 44`, all.every((a) => a && !a.idle && a.anims.length === 0 && a.zone.w >= 44 && a.zone.h >= 44), all.map((a) => a && { idle: a.idle, n: a.anims.length, w: a.zone.w, h: a.zone.h }));
    const foot = await p.locator('[data-testid="pet-tap-foot"]').textContent();
    check(`${tag}: сноска «${foot}»`, foot === { en: "Tap a blot to see how it reacts.", uk: "Торкніться ляпки — побачите, як вона відгукується.", ru: "Коснитесь кляксы — увидите, как она отзывается." }[c.lang], foot);
    const ov = [];
    for (const z of zones) ov.push(...(await overlaps(p, z, ['[data-testid="pet-moods"] figcaption'])));
    check(`${tag}: зоны не наезжают на подписи`, ov.length === 0, ov);
    check(`${tag}: на экране дышит не больше одной кляксы (ноль)`, (await breathing(p)) === 0);
    await p.locator('[data-testid="pet-moods"]').screenshot({ path: path.join(OUT, `${B}-p6-settings-${c.dev.w}${c.ax3 ? "-ax3" : ""}-${c.scheme}-${c.lang}.png`) });
    if (c.full) {
      await pokeOnce(p, zones[1], `${tag} превью «устала»`, { rm: c.rm });
      // Тап по одному не оживляет соседей.
      await tapZone(p, zones[0]);
      await p.waitForTimeout(40);
      const others = [];
      for (const z of zones.slice(1)) others.push((await petInfo(p, z)).anims.length);
      check(`${tag}: тап по одному превью — остальные стоят`, others.every((n) => n === 0), others);
      await p.waitForTimeout(600);
      await antiSpam(p, zones[2], tag, { rm: c.rm });
      // Прокрутка, начатая на превью: страница едет, реакции нет.
      await p.waitForTimeout(5200);
      await watchPokes(p);
      const box = await p.locator(zones[3]).boundingBox();
      const real = b.browserType().name() === "chromium";
      const f = finger(p, real);
      const sc0 = await p.evaluate(() => {
        const l = document.querySelector(".push-layer");
        return { st: l.scrollTop, max: l.scrollHeight - l.clientHeight };
      });
      const st0 = sc0.st;
      const dir = st0 > sc0.max / 2 ? 1 : -1; // палец вниз — прокрутка вверх, и наоборот
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const pd = [];
      pd.push(await f.down(cx, cy));
      for (let i = 1; i <= 10; i++) pd.push(await f.move(cx, cy + dir * i * 14));
      pd.push(await f.up());
      await p.waitForTimeout(400);
      const st1 = await p.evaluate(() => document.querySelector(".push-layer").scrollTop);
      const got = await pokes(p);
      if (real) check(`${tag}: прокрутка, начатая на превью, идёт (scrollTop ${Math.round(st0)}→${Math.round(st1)}), реакции нет`, Math.abs(st1 - st0) > 20 && got.length === 0, { st0, st1, got });
      else check(`${tag}: палец ушёл на 140 px (синтетические события) — реакции нет, preventDefault нет`, got.length === 0 && pd.every((x) => !x), { got, pd });
    }
    check(`${tag}: без ошибок страницы`, noErrs(errs).length === 0, noErrs(errs).slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

/** Жест «назад» от левого края Settings (установленное приложение) — с кляксами на экране работает как раньше (chromium, CDP). */
async function edgeBack(b, B) {
  if (b.browserType().name() !== "chromium") {
    console.log(`INFO ${B}: жест «назад» — только chromium (настоящие касания CDP); webkit — логика в pd253-check`);
    return;
  }
  const { ctx, p } = await open(b, { standalone: true, route: "today" });
  try {
    await p.waitForSelector(`${PANE} .board button.cell`, { timeout: 40000 });
    await p.locator(`${PANE} [data-testid="open-settings"]`).tap();
    await p.locator('[data-testid="settings-screen"]').waitFor();
    await p.evaluate(() => document.querySelector('[data-testid="pet-moods"]').scrollIntoView({ block: "center" }));
    await p.waitForTimeout(800);
    const box = await p.locator('[data-testid="pet-preview-happy"]').boundingBox();
    const y = box.y + box.height / 2; // по высоте превью — палец идёт рядом с кляксой
    const f = finger(p, true);
    await f.down(4, y);
    for (let i = 1; i <= 14; i++) await f.move(4 + i * 22, y + i);
    await p.waitForTimeout(200);
    await f.up();
    await p.waitForTimeout(900);
    const hash = await p.evaluate(() => location.hash);
    check(`${B}: жест «назад» с края Settings (кляксы на экране) — вернулись на Today`, !/settings/.test(hash) && (await p.locator('[data-testid="settings-screen"]').count()) === 0, hash);
  } finally {
    await ctx.close();
  }
}

/** Десктоп C 1280×800: место 1 — клякса в тулбаре партии перед лампочкой, геометрия поля = без Питомца; место 7 — в инспекторе. */
async function desk(b, B) {
  const geo = async (pet, mode) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", locale: "en-US", timezoneId: "UTC" });
    await ctx.clock.setFixedTime(NOW);
    await ctx.addInitScript((pet) => localStorage.setItem("pundoku.pet", pet), pet);
    if (mode === "error")
      await ctx.addInitScript(() => {
        window.Worker = class {
          postMessage(r) {
            setTimeout(() => this.onmessage?.({ data: { id: r.id, ok: false, error: "pd298" } }), 30);
          }
          terminate() {}
          addEventListener() {}
          removeEventListener() {}
        };
      });
    ctx._pd298Mouse = true;
    const p = await ctx.newPage();
    if (mode === "error") await p.route("**/api/daily/**", (r) => r.fulfill({ status: 503, body: "" }));
    await p.goto(`${BASE}/#/today`);
    await p.waitForTimeout(2500);
    const g = await p.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s);
        if (!e || e.hidden) return null;
        const b = e.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
      };
      return { tb: r(".desk-tb"), pet: r('[data-testid="pet-today"]'), err: r('[data-testid="pet-error"]'), insp: r(".desk-insp"), hint: r('[data-testid="hint-button"]'), board: r(".board") };
    });
    if (pet === "1") await p.screenshot({ path: path.join(OUT, `${B}-desk-${mode}.png`) });
    if (pet === "1" && mode === "play") await pokeOnce(p, '[data-testid="pet-today"]', `${B} десктоп C место 1 (клик мышью)`);
    await ctx.close();
    return g;
  };
  const on = await geo("1", "play");
  const off = await geo("0", "play");
  check(`${B} десктоп C место 1: клякса в тулбаре перед лампочкой, на одной линии; тулбар и поле — как без Питомца`, on.pet && on.pet[1] === on.hint[1] && on.pet[0] < on.hint[0] && JSON.stringify(on.tb) === JSON.stringify(off.tb) && JSON.stringify(on.board) === JSON.stringify(off.board), { on, off });
  const e = await geo("1", "error");
  check(`${B} десктоп C место 7: клякса у ошибки — в инспекторе; в тулбаре кляксы нет`, e.err && e.insp && e.err[0] >= e.insp[0] && !e.pet, e);
}

// ---------------------------------------------------------------------------------------------------------- прогон
async function run(brn) {
  const b = await pw[brn].launch();
  const B = SHORT[brn];
  try {
    // ONLY=share — только лист «Поделиться» (карточка + место 8 + Share на разных экранах): быстрая перепроверка правки QA.
    const only = process.env.ONLY === "share";
    if (!only) {
      // Место 1 — шапка Today.
      await place1(b, B, { dev: PHONE, scheme: "light", lang: "en", full: true });
      await place1(b, B, { dev: PHONE, scheme: "dark", lang: "uk" });
      await place1(b, B, { dev: PHONE, scheme: "light", lang: "ru", rm: true });
      await place1(b, B, { dev: SMALL, scheme: "light", lang: "en" });
      await place1(b, B, { dev: SMALL, scheme: "dark", lang: "ru" });
      await place1(b, B, { dev: SMALL, scheme: "light", lang: "uk", ax3: true });
      await place1(b, B, { dev: SMALL, scheme: "light", lang: "en", ax3: true });
      await place1(b, B, { dev: PHONE, scheme: "light", lang: "uk", ax3: true });
      await place1Off(b, B);
    }
    // Карточка + место 8.
    await cardAndShare(b, B, { dev: PHONE, scheme: "light", lang: "en" });
    await cardAndShare(b, B, { dev: PHONE, scheme: "dark", lang: "ru" });
    await shareOff(b, B);
    await shareFit(b, B, { dev: TALL, scheme: "dark", lang: "uk", fits: true });
    await shareFit(b, B, { dev: SMALL, scheme: "light", lang: "ru" });
    await shareFit(b, B, { dev: PHONE, scheme: "light", lang: "en", ax3: true });
    if (only) return;
    // Место 7.
    await place7(b, B, { dev: PHONE, scheme: "light", lang: "en", full: true });
    await place7(b, B, { dev: PHONE, scheme: "dark", lang: "uk" });
    await place7(b, B, { dev: SMALL, scheme: "light", lang: "en" });
    await place7(b, B, { dev: SMALL, scheme: "light", lang: "ru", ax3: true });
    await place7(b, B, { dev: PHONE, scheme: "light", lang: "en", ax3: true });
    await place7(b, B, { dev: PHONE, scheme: "light", lang: "en", archive: true });
    await place7Off(b, B);
    // Место 3.
    await place3(b, B, { dev: PHONE, scheme: "light", lang: "en", full: true, error: true });
    await place3(b, B, { dev: PHONE, scheme: "dark", lang: "uk", rm: true, full: true });
    await place3(b, B, { dev: SMALL, scheme: "light", lang: "ru", ax3: true });
    await place3(b, B, { dev: PHONE, scheme: "light", lang: "en", pet: "0" });
    // Место 6.
    await place6(b, B, { dev: PHONE, scheme: "light", lang: "en", full: true });
    await place6(b, B, { dev: PHONE, scheme: "dark", lang: "ru", rm: true, full: true });
    await place6(b, B, { dev: SMALL, scheme: "light", lang: "uk", ax3: true });
    await edgeBack(b, B);
    await desk(b, B);
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
