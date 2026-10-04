/**
 * PD-161 — живая проверка слайда между вкладками (вариант A «Лента») на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5497 --strictPort      # свой порт, не 5492
 *   PD_PW_HOME=/tmp/pd161-pw BASE=http://localhost:5497 node design/pd161-live-check.mjs
 *
 * Playwright: как pd158-shots.mjs — от cwd, затем $PD_PW_HOME (по умолчанию /tmp/pd16-pw). Никаких pkill/killall.
 *
 * Что проверяется (печатает PASS/FAIL, в конце сводка; кадры — design/pd161-shots/):
 *   - все 6 направлений: кто едет, откуда (знак сдвига по порядку вкладок), 300 мс / --e-ring, Today↔Year без Play;
 *     после конца — у панелей computed transform none, will-change auto, нет data-slide и inline transform/opacity;
 *   - длительности кадров (rAF) в окне перехода: нет кадров > 50 мс;
 *   - прерывание посреди анимации (новые анимации стартуют от текущего положения) и серия быстрых тапов;
 *   - Reduce Motion (настоящий prefers-reduced-motion контекста): кроссфейд 200 мс, без сдвига, пилюля без анимации;
 *   - шиты: меню «⋯», шит месяца Year, action sheet «Discard?» — затемнение накрывает таб-бар, шит = вьюпорт;
 *     шит Year, открытый ПОСРЕДИ слайда, всё равно на весь экран (портал);
 *   - партия Play (поле, выбор, таймер на паузе вне Play) и ход Today переживают переключения; прокрутка Year сохраняется;
 *   - Settings поверх стопки: панель под ним не размонтируется; «‹» — вход M10; тап по другой вкладке — слайд от источника;
 *     браузерное «назад» из Settings — на вкладку-источник с сохранённым состоянием;
 *   - 320×568 / 390×844 / 430×932.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PW_HOME = process.env.PD_PW_HOME || "/tmp/pd16-pw";
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

const BASE = process.env.BASE ?? "http://localhost:5497";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd161-shots");
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY; // chromium | webkit
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const warns = [];
const warn = (name, cond, extra = "") => {
  if (!cond) warns.push(name);
  console.log(`${cond ? "PASS" : "WARN"}  ${name}${extra ? "  " + extra : ""}`);
};
const TABS = ["today", "play", "year"];
const SIZES = [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
];
const DIRS = [
  ["today", "play"],
  ["play", "year"],
  ["year", "today"],
  ["today", "year"],
  ["year", "play"],
  ["play", "today"],
];

/** Состояние стопки: активная панель, следы перехода, пилюля. */
const stackState = (page) =>
  page.evaluate(() => {
    const panes = [...document.querySelectorAll(".tab-pane")].map((p) => {
      const cs = getComputedStyle(p);
      return {
        tab: p.dataset.tab,
        off: p.classList.contains("off"),
        inert: p.inert,
        vis: cs.visibility,
        transform: cs.transform,
        willChange: cs.willChange,
        slide: p.hasAttribute("data-slide"),
        inline: (p.style.transform || "") + (p.style.opacity || ""),
        anims: p.getAnimations().length,
      };
    });
    const pill = document.querySelector(".tab-pill");
    const sel = document.querySelector('[role="tab"][aria-selected="true"]');
    return { panes, pillX: pill ? new DOMMatrixReadOnly(getComputedStyle(pill).transform).m41 : null, pillWant: sel && pill ? sel.offsetLeft - document.querySelector('[role="tab"]').offsetLeft : null, sel: sel?.id };
  });
const clean = (st, active) =>
  st.panes.every((p) => p.transform === "none" && p.willChange === "auto" && !p.slide && p.inline === "" && p.anims === 0) &&
  st.panes.filter((p) => p.vis === "visible").map((p) => p.tab).join() === active &&
  Math.abs((st.pillX ?? 0) - (st.pillWant ?? 0)) < 0.5;

/** rAF-монитор: метки кадров с момента установки. */
const startFrames = (page) =>
  page.evaluate(() => {
    window.__frames = [];
    window.__framesOn = true;
    const loop = (t) => {
      if (!window.__framesOn) return;
      window.__frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return performance.now();
  });
const stopFrames = (page) =>
  page.evaluate(() => {
    window.__framesOn = false;
    const f = window.__frames;
    const d = [];
    for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    return { n: f.length, max: d.length ? Math.max(...d) : 0, over50: d.filter((x) => x > 50).length, over34: d.filter((x) => x > 34).length, deltas: d.map((x) => Math.round(x)) };
  });

/** Ключевые кадры анимаций панелей (кто едет и откуда). */
const paneKeyframes = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".tab-pane")]
        .map((p) => {
          const a = p.getAnimations()[0];
          if (!a) return null;
          const k = a.effect.getKeyframes();
          const x = (t) => (t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0);
          const timing = a.effect.getTiming();
          return [p.dataset.tab, { x0: x(k[0].transform), x1: x(k[k.length - 1].transform), o0: Number(k[0].opacity), o1: Number(k[k.length - 1].opacity), dur: timing.duration, easing: timing.easing }];
        })
        .filter(Boolean),
    ),
  );
const pillAnimated = (page) => page.evaluate(() => document.querySelector(".tab-pill").getAnimations().length > 0);

/** Заморозить переход на доле времени `f` (все анимации панелей и пилюли), снять кадр, отпустить. */
async function shotAt(page, f, path) {
  await page.evaluate((f) => {
    for (const a of document.getAnimations()) {
      const el = a.effect?.target;
      if (!el || !(el.classList.contains("tab-pane") || el.classList.contains("tab-pill"))) continue;
      const d = a.effect.getTiming().duration;
      a.pause();
      a.currentTime = d * f;
    }
  }, f);
  await page.screenshot({ path });
  await page.evaluate(() => {
    for (const a of document.getAnimations()) if (a.playState === "paused") a.play();
  });
}

// Шестерёнка — кликом из DOM: locator.click() сам прокрутил бы панель к шапке и сбросил проверяемую прокрутку Year.
const gear = (page, tab) => page.evaluate((tab) => document.querySelector(`.tab-pane[data-tab="${tab}"] [data-testid="open-settings"]`).click(), tab);
const tapTab = (page, id) => page.evaluate((id) => document.getElementById(`tab-${id}`).click(), id);
const settle = (page) => page.waitForTimeout(450);
const goRest = async (page, id) => {
  if ((await page.getAttribute(`#tab-${id}`, "aria-selected")) !== "true") await tapTab(page, id);
  await settle(page);
};

async function makeMove(page) {
  const pane = page.locator(".tab-pane:not(.off)");
  await pane.locator('.board button.cell[aria-label$="empty"]').first().click();
  await pane.locator(".pad button").first().click();
  await page.waitForTimeout(150);
}
const boardSig = (page, tab) =>
  page.evaluate((tab) => {
    const p = document.querySelector(`.tab-pane[data-tab="${tab}"]`);
    const cells = [...p.querySelectorAll(".board button.cell")];
    return { labels: cells.map((c) => c.getAttribute("aria-label")).join("|"), sel: cells.findIndex((c) => c.classList.contains("sel") || c.getAttribute("aria-selected") === "true" || c.getAttribute("aria-pressed") === "true"), clock: p.querySelector(".clock")?.textContent ?? "" };
  }, tab);
const secs = (clock) => {
  const m = /(\d+):(\d+)/.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

async function open(browser, { w, h, rm = false, scheme = "light" }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: scheme, reducedMotion: rm ? "reduce" : "no-preference" });
  // Журнал element.animate() панелей/пилюли — без отладочных глобалов в коде приложения.
  await ctx.addInitScript(() => {
    const orig = Element.prototype.animate;
    window.__anims = [];
    Element.prototype.animate = function (frames, opts) {
      const a = orig.call(this, frames, opts);
      const who = this.dataset?.tab ?? (this.classList?.contains("tab-pill") ? "pill" : null);
      if (who) {
        a.__id = window.__anims.length;
        window.__anims.push({ who, t: performance.now(), dur: typeof opts === "object" ? opts.duration : opts, frames: JSON.stringify(frames) });
      }
      return a;
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|IndexedDB/.test(m.text())) errs.push(m.text());
  });
  await page.goto(`${BASE}/#/today`);
  await page.waitForSelector('.tab-pane[data-tab="today"] .board:not(.idle)', { timeout: 30000 });
  return { ctx, page, errs };
}

async function runSize(eng, name, size) {
  const b = await eng.launch();
  const tag = `${name}-${size.w}`;
  const { ctx, page, errs } = await open(b, size);
  const mid = size.w === 390; // кадры посреди перехода — на 390 (iPhone 16)

  // ---------- Подготовка: ход на Today, партия в Play с ходом ----------
  await makeMove(page);
  const today0 = await boardSig(page, "today");
  await tapTab(page, "play");
  await settle(page);
  await page.locator('[data-testid="setup-start"]').click();
  await page.waitForSelector('.tab-pane[data-tab="play"] .board:not(.idle)', { timeout: 30000 });
  await makeMove(page);
  await page.waitForTimeout(1200);
  const play0 = await boardSig(page, "play");

  // ---------- Фон: кадры БЕЗ перехода (та же страница, 1 с покоя) — эталон для оценки окружения ----------
  await startFrames(page);
  await page.waitForTimeout(1000);
  const idle = await stopFrames(page);
  console.log(`  ${tag}: кадры в покое — max ${idle.max.toFixed(1)} мс, >50 мс: ${idle.over50} из ${idle.n}`);
  baselines.push({ tag, max: idle.max, over50: idle.over50, n: idle.n });

  // ---------- Шесть направлений ----------
  for (const [from, to] of DIRS) {
    await goRest(page, from);
    await startFrames(page);
    await page.waitForTimeout(60);
    await tapTab(page, to);
    const kf = await paneKeyframes(page);
    const pill = await pillAnimated(page);
    await page.waitForTimeout(400);
    const fr = await stopFrames(page);
    const st = await stackState(page);
    const fi = TABS.indexOf(from);
    const ti = TABS.indexOf(to);
    const sign = Math.sign(ti - fi);
    const W = size.w;
    const movers = Object.keys(kf).sort().join();
    const want = [from, to].sort().join();
    ok(`${tag} ${from}→${to}: едут ровно два экрана (${movers})`, movers === want);
    ok(
      `${tag} ${from}→${to}: входящий из ${sign > 0 ? "справа" : "слева"}, уходящий в обратную сторону, 300 мс, --e-ring`,
      kf[to]?.x0 === sign * W && kf[to]?.x1 === 0 && kf[from]?.x0 === 0 && kf[from]?.x1 === -sign * W && kf[to]?.dur === 300 && /0\.32, ?0\.72, ?0, ?1/.test(kf[to]?.easing ?? ""),
      JSON.stringify(kf),
    );
    ok(`${tag} ${from}→${to}: пилюля едет`, pill);
    ok(`${tag} ${from}→${to}: после конца — чисто (transform none, will-change auto, нет data-slide/inline), пилюля на месте`, clean(st, to), JSON.stringify(st.panes));
    // Кадры — WARN, не FAIL: headless webkit на нагруженной машине агентов даёт редкие длинные кадры и на main (кроссфейд M10);
    // сравнение в равных условиях — design/pd161-frames-ab.mjs. Истина — только iPhone (md PD-158 §10 п.5).
    warn(`${tag} ${from}→${to}: кадры ≤ 50 мс`, fr.over50 === 0, `max ${fr.max.toFixed(1)} мс, кадров ${fr.n}, >34 мс: ${fr.over34}; кадры: ${fr.deltas.join(",")}`);
    frameRuns.push({ tag: `${tag} ${from}→${to}`, max: fr.max, over50: fr.over50 });
  }

  // Кадры посреди перехода — отдельным проходом: снимок экрана сам по себе даёт длинный кадр и не должен попадать в замер.
  // На 320 и 430 — один кадр (Today → Year), на 390 — все шесть направлений.
  for (const [from, to] of mid ? DIRS : [["today", "year"]]) {
    await goRest(page, from);
    await tapTab(page, to);
    await shotAt(page, 0.5, join(OUT, `${tag}-${from}-${to}-050.png`));
    await settle(page);
  }

  // ---------- Прерывание ----------
  await goRest(page, "today");
  await tapTab(page, "play");
  // Ждём, пока лента реально поедет (под нагрузкой первый кадр может задержаться), и прерываем на ~10–60 % хода.
  await page.waitForFunction(() => {
    const p = document.querySelector('.tab-pane[data-tab="play"]');
    const x = new DOMMatrixReadOnly(getComputedStyle(p).transform).m41;
    return x < p.clientWidth * 0.9;
  }, null, { polling: "raf" });
  // Снимок положения и тап — в ОДНОЙ задаче: между ними не проходит время, сравнение честное.
  const before = await page.evaluate(() => {
    const pos = Object.fromEntries([...document.querySelectorAll(".tab-pane")].map((p) => [p.dataset.tab, new DOMMatrixReadOnly(getComputedStyle(p).transform).m41]));
    document.getElementById("tab-year").click();
    return pos;
  });
  const kfi = await paneKeyframes(page);
  if (mid) await shotAt(page, 0.3, join(OUT, `${tag}-interrupt-play40-year30.png`));
  ok(
    `${tag} прерывание Today→Play→Year: подхват с текущего места (без рывка)`,
    Math.abs(kfi.today.x0 - before.today) < 1 && Math.abs(kfi.play.x0 - before.play) < 1 && before.play > 2 && before.play < size.w - 2 && kfi.year.x0 === size.w && kfi.year.x1 === 0,
    JSON.stringify({ before, kfi }),
  );
  await page.waitForTimeout(450);
  ok(`${tag} прерывание: итог Year, чисто`, clean(await stackState(page), "year"));
  // Серия быстрых тапов
  for (const id of ["play", "today", "year", "play", "today"]) {
    await tapTab(page, id);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(450);
  ok(`${tag} серия тапов: итог Today, чисто`, clean(await stackState(page), "today"));
  // Тап по вкладке, к которой уже едем, — игнор (анимация не перезапускается)
  const n0 = await page.evaluate(() => window.__anims.length);
  await tapTab(page, "year");
  const id1 = await page.evaluate(() => document.querySelector('.tab-pane[data-tab="year"]').getAnimations()[0]?.__id ?? -1);
  await tapTab(page, "year");
  const id2 = await page.evaluate(() => document.querySelector('.tab-pane[data-tab="year"]').getAnimations()[0]?.__id ?? -1);
  const n1 = await page.evaluate(() => window.__anims.length);
  ok(`${tag} повторный тап по цели не перезапускает переход`, id1 >= 0 && id1 === id2 && n1 - n0 === 3, `anim ${id1}/${id2}, новых анимаций ${n1 - n0} (2 панели + пилюля)`);
  await settle(page);

  // ---------- Состояние: партия Play, ход Today, таймер на паузе вне Play ----------
  await goRest(page, "play");
  const p1 = await boardSig(page, "play");
  ok(`${tag} партия Play пережила переключения (поле и выбор)`, p1.labels === play0.labels && p1.sel === play0.sel, `sel ${play0.sel}/${p1.sel}`);
  await goRest(page, "today");
  const t1s = await boardSig(page, "today");
  ok(`${tag} ход Today на месте`, t1s.labels === today0.labels);
  const clockLeave = secs((await boardSig(page, "play")).clock);
  await page.waitForTimeout(3000);
  await goRest(page, "play");
  const clockBack = secs((await boardSig(page, "play")).clock);
  ok(`${tag} таймер Play стоит, пока Play не на экране`, clockBack - clockLeave <= 1, `${clockLeave}s → ${clockBack}s после 3 с на Today`);
  await page.waitForTimeout(2200);
  ok(`${tag} таймер Play идёт на Play`, secs((await boardSig(page, "play")).clock) - clockBack >= 1);

  // ---------- Прокрутка Year ----------
  await goRest(page, "year");
  // Пустой год почти не прокручивается (на 320×568 — 8 px): удлиняем содержимое, чтобы проверка прокрутки была содержательной.
  await page.addStyleTag({ content: '.tab-pane[data-tab="year"] .year{padding-bottom:600px}' });
  const sc = await page.evaluate(() => {
    const p = document.querySelector('.tab-pane[data-tab="year"]');
    p.scrollTop = 9999;
    return { top: p.scrollTop, max: p.scrollHeight - p.clientHeight };
  });
  await goRest(page, "today");
  await goRest(page, "play");
  await goRest(page, "year");
  const sc2 = await page.evaluate(() => document.querySelector('.tab-pane[data-tab="year"]').scrollTop);
  if (sc.max > 0) {
    ok(`${tag} прокрутка Year сохраняется`, sc2 === sc.top && sc.top > 0, `${sc.top} → ${sc2}`);
    if (mid) await page.screenshot({ path: join(OUT, `${tag}-year-scroll-kept.png`) });
  } else console.log(`  (${tag}: Year не прокручивается на этом размере — проверка прокрутки пропущена)`);

  // ---------- Шиты ----------
  const covered = () =>
    page.evaluate(() => {
      const t = document.getElementById("tab-today").getBoundingClientRect();
      const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
      return !hit?.closest(".tabbar");
    });
  const fullRect = (sel) =>
    page.evaluate((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? Math.round(r.left) === 0 && Math.round(r.top) === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight : false;
    }, sel);
  // Шит месяца Year
  await goRest(page, "year");
  await page.evaluate(() => document.querySelector('.tab-pane[data-tab="year"] [data-month="0"]').click());
  await page.waitForTimeout(500);
  ok(`${tag} шит Year: на весь экран, таб-бар закрыт`, (await fullRect(".ysheet-root")) && (await covered()));
  if (mid) await page.screenshot({ path: join(OUT, `${tag}-sheet-year.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  // Шит Year, открытый посреди слайда (Today → Year)
  await goRest(page, "today");
  await tapTab(page, "year");
  await page.waitForTimeout(60);
  await page.evaluate(() => document.querySelector('.tab-pane[data-tab="year"] [data-month="1"]').click());
  const midRect = await fullRect(".ysheet-root");
  if (mid) await page.screenshot({ path: join(OUT, `${tag}-sheet-year-during-slide.png`) });
  await page.waitForTimeout(500);
  ok(`${tag} шит Year, открытый посреди слайда: на весь экран (портал), после — тоже`, midRect && (await fullRect(".ysheet-root")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  ok(`${tag} после шита — стопка чистая`, clean(await stackState(page), "year"));
  // Меню «⋯» на партии Play
  await goRest(page, "play");
  await page.locator('.tab-pane[data-tab="play"] [data-testid="more-button"]').click();
  await page.waitForTimeout(300);
  ok(`${tag} меню «⋯»: затемнение на весь экран, таб-бар закрыт`, (await fullRect(".menu-scrim")) && (await covered()));
  if (mid) await page.screenshot({ path: join(OUT, `${tag}-sheet-more.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // Action sheet «Discard current puzzle?» (хаб → Start при идущей своей сетке)
  await tapTab(page, "play"); // повторный тап — хаб
  await page.waitForTimeout(400);
  await page.locator('[data-testid="setup-start"]').click();
  await page.waitForTimeout(400);
  const asParent = await page.evaluate(() => document.querySelector(".st-scrim")?.parentElement?.tagName ?? null);
  ok(`${tag} action sheet: порталом в body, на весь экран, таб-бар закрыт`, asParent === "BODY" && (await fullRect(".st-scrim")) && (await covered()), `parent ${asParent}`);
  if (mid) await page.screenshot({ path: join(OUT, `${tag}-sheet-action.png`) });
  await page.locator('[data-testid="action-sheet-cancel"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="continue-own"]').click();
  await page.waitForTimeout(400);

  // ---------- Settings поверх стопки ----------
  await gear(page, "play");
  await page.waitForTimeout(400);
  const cov = await page.evaluate(() => ({ covered: document.querySelector(".stack").classList.contains("covered"), inert: document.querySelector(".stack").inert, panes: document.querySelectorAll(".tab-pane").length, layer: !!document.querySelector(".push-layer") }));
  ok(`${tag} Settings поверх стопки, панели смонтированы и inert`, cov.covered && cov.inert && cov.panes === 3 && cov.layer, JSON.stringify(cov));
  const nb = await page.evaluate(() => window.__anims.length);
  await page.locator('[data-testid="settings-back"]').click();
  await page.waitForSelector(".push-layer", { state: "detached" });
  await page.waitForTimeout(400);
  const riseLog = await page.evaluate((nb) => window.__anims.slice(nb), nb);
  const rise = riseLog.filter((a) => a.who === "play" && /translateY/.test(a.frames)).length;
  const p2 = await boardSig(page, "play");
  ok(`${tag} «‹» из Settings: вход M10 на Play (без слайда), партия на месте, чисто`, rise === 1 && riseLog.length === 1 && p2.labels === play0.labels && clean(await stackState(page), "play"), JSON.stringify(riseLog));
  await gear(page, "play");
  await page.waitForTimeout(400);
  const ns = await page.evaluate(() => window.__anims.length);
  await tapTab(page, "year");
  const sl = await page.evaluate((ns) => window.__anims.slice(ns).map((a) => a.who).sort().join(), ns);
  const kfs = await paneKeyframes(page);
  if (mid) await shotAt(page, 0.5, join(OUT, `${tag}-settings-to-year-050.png`));
  await page.waitForTimeout(450);
  ok(`${tag} Settings (с Play) → тап Year: слайд Play→Year`, sl === "pill,play,year" && kfs.play?.x1 === -size.w && kfs.year?.x0 === size.w && clean(await stackState(page), "year"), sl);
  // Браузерное «назад» из Settings — на вкладку-источник
  await gear(page, "year");
  await page.waitForTimeout(400);
  await page.goBack();
  await page.waitForTimeout(500);
  const back = { sel: await page.getAttribute("#tab-year", "aria-selected"), layer: !!(await page.$(".push-layer")), top: await page.evaluate(() => document.querySelector('.tab-pane[data-tab="year"]').scrollTop), want: sc.top };
  ok(`${tag} «назад» браузера из Settings → Year, прокрутка на месте`, back.sel === "true" && !back.layer && (sc.max === 0 || back.top === sc.top), JSON.stringify(back));

  ok(`${tag} без ошибок в консоли`, errs.length === 0, errs.join(" | "));
  await ctx.close();

  // ---------- Reduce Motion: настоящий prefers-reduced-motion ----------
  {
    const { ctx: c2, page: p, errs: e2 } = await open(b, { ...size, rm: true });
    await tapTab(p, "play");
    const k = await paneKeyframes(p);
    const pa = await pillAnimated(p);
    if (mid) await shotAt(p, 0.5, join(OUT, `${tag}-rm-today-play-050.png`));
    await p.waitForTimeout(400);
    ok(
      `${tag} Reduce Motion: кроссфейд 200 мс без сдвига, пилюля без анимации, чисто`,
      k.play?.dur === 200 && k.play.x0 === 0 && k.play.x1 === 0 && k.play.o0 === 0 && k.play.o1 === 1 && k.today?.o1 === 0 && k.today.x1 === 0 && !pa && clean(await stackState(p), "play"),
      JSON.stringify(k),
    );
    ok(`${tag} Reduce Motion: без ошибок`, e2.length === 0, e2.join(" | "));
    await c2.close();
  }

  // ---------- Тёмная тема + эмуляция Reduce Transparency (непрозрачный таб-бар) посреди перехода ----------
  if (mid) {
    const { ctx: c3, page: p } = await open(b, { ...size, scheme: "dark" });
    await tapTab(p, "year");
    await shotAt(p, 0.5, join(OUT, `${tag}-dark-today-year-050.png`));
    await p.waitForTimeout(450);
    await p.addStyleTag({ content: ".tabbar{background:var(--glass-solid)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}" });
    await tapTab(p, "play");
    await shotAt(p, 0.5, join(OUT, `${tag}-rt-dark-year-play-050.png`));
    await p.waitForTimeout(450);
    ok(`${tag} тёмная/RT: чисто после перехода`, clean(await stackState(p), "play"));
    await c3.close();
  }
  await b.close();
}
const baselines = [];
const frameRuns = [];

for (const [name, eng] of Object.entries({ chromium, webkit })) {
  if (ONLY && ONLY !== name) continue;
  for (const size of SIZES) {
    try {
      await runSize(eng, name, size);
    } catch (e) {
      ok(`${name}-${size.w}: сценарий упал`, false, String(e?.stack ?? e).split("\n").slice(0, 4).join(" / "));
    }
  }
}
console.log("\nКадры: покой (эталон окружения) vs переходы");
for (const b of baselines) console.log(`  ${b.tag}: покой max ${b.max.toFixed(0)} мс (>50: ${b.over50}/${b.n}); переходы max ${Math.max(...frameRuns.filter((r) => r.tag.startsWith(b.tag + " ")).map((r) => r.max)).toFixed(0)} мс`);
const failed = results.filter((r) => !r.cond);
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} PASS${failed.length ? "\nFAIL:\n  " + failed.map((f) => f.name).join("\n  ") : ""}`);
console.log(`WARN (кадры > 50 мс): ${warns.length}${warns.length ? "\n  " + warns.join("\n  ") : ""}`);
process.exit(failed.length ? 1 : 0);
