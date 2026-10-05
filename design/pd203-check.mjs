/**
 * PD-203 — режим «Мелодия» на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit, НАСТОЯЩАЯ генерация (воркер не подменяется).
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5203 --strictPort
 *   PD_PW_HOME=/tmp/pundoku-qa/pw BASE=http://localhost:5203 node design/pd203-check.mjs
 *
 * Звук проверяется по вызовам аудиографа: init-скрипт оборачивает `AudioContext` (счётчик контекстов, resume/close) и
 * `createOscillator().start` (частота и тип волны каждого осциллятора). Основной тон маримбы — `triangle`, его частота → цифра
 * пентатоники (C4 D4 E4 G4 A4 C5 D5 E5 G5). Приложение не знает о шпионе (никакого тестового режима).
 *
 * Сценарий: хаб (порядок строк) → Классика: ходы без единого AudioContext → Мелодия (easy/expert из шита) → строка о звуке →
 * первая цифра = жест: контекст создан и запущен, её нота прозвучала → ошибочная цифра звучит своей нотой → undo/стирание
 * молчат → закрытие юнита: арпеджио (9 нот юнита) + кольцо на 9 клетках (Reduce Motion — разом, без бега) → меню ⋯ «Звук»:
 * выкл → чип «без звука», нота не строится, настройка переживает перезагрузку → сворачивание (visibilitychange) закрывает
 * контекст → решить до конца → карточка «Сыграть мелодию» → «Остановить» (карта проявляется) → стоп → таймлапс: кнопка звука,
 * ▶ — ноты идут. Консоль чистая. Кадры: design/pd203-shots/. Никаких pkill: браузеры закрываются в finally.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PW_HOME = process.env.PD_PW_HOME || "/tmp/pundoku-qa/pw";
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
const { solve } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);

const BASE = process.env.BASE ?? "http://localhost:5203";
const OUT = join(HERE, "pd203-shots");
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^(cr|wk)-.*\.png$/.test(f)) rmSync(join(OUT, f), { force: true });

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HZ = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 783.99];
const digitOf = (f) => {
  const i = HZ.findIndex((h) => Math.abs(h - f) < 1);
  return i < 0 ? null : i + 1;
};

const CONFIGS = [
  { w: 390, h: 844, scheme: "light", lang: "en", diff: "easy", full: true, classic: true },
  { w: 390, h: 844, scheme: "dark", lang: "ru", diff: "expert", full: true },
  { w: 320, h: 568, scheme: "light", lang: "uk", diff: "easy" },
  { w: 320, h: 568, scheme: "dark", lang: "en", diff: "easy" },
  { w: 390, h: 844, scheme: "light", lang: "en", diff: "easy", rm: true },
];
const WK = [CONFIGS[0], { ...CONFIGS[3], diff: "expert" }];

/** Шпион аудиографа (init-скрипт; в странице до кода приложения). */
function spy() {
  const S = { contexts: 0, resumes: 0, closes: 0, oscs: [] };
  window.__audioSpy = S;
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const C = window[name];
    if (typeof C !== "function") continue;
    const W = class extends C {
      constructor(...a) {
        super(...a);
        S.contexts++;
        S.ctx = this;
      }
    };
    try {
      window[name] = W;
    } catch {
      /* только чтение */
    }
  }
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  const co = P.createOscillator;
  P.createOscillator = function () {
    const o = co.call(this);
    const st = o.start;
    o.start = function (...a) {
      S.oscs.push({ f: o.frequency.value, type: o.type, at: performance.now() });
      return st.apply(this, a);
    };
    return o;
  };
  const AC = window.AudioContext.prototype;
  const res = AC.resume;
  AC.resume = function (...a) {
    S.resumes++;
    return res.apply(this, a);
  };
  const cl = AC.close;
  AC.close = function (...a) {
    S.closes++;
    return cl.apply(this, a);
  };
}

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[c.lang],
    serviceWorkers: "block",
  });
  await ctx.addInitScript(spy);
  await ctx.addInitScript(
    ({ lang }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
      } catch {
        /* приватный режим */
      }
    },
    { lang: c.lang },
  );
  const page = await ctx.newPage();
  const errs = [];
  const STAND_NOISE = /access control checks/;
  page.on("pageerror", (e) => {
    if (!(STAND_NOISE.test(e.message) && /\/api\//.test(e.message))) errs.push(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::/.test(m.text()) && !STAND_NOISE.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs };
}

const S = (page) => page.evaluate(() => ({ contexts: window.__audioSpy.contexts, resumes: window.__audioSpy.resumes, closes: window.__audioSpy.closes, n: window.__audioSpy.oscs.length, state: window.__audioSpy.ctx?.state ?? null }));
/** Цифры основных тонов (маримба — `triangle`) после индекса `from`. */
const notesSince = (page, from) => page.evaluate((k) => window.__audioSpy.oscs.slice(k).filter((o) => o.type === "triangle").map((o) => o.f), from).then((fs) => fs.map(digitOf));

const BOARD = ".play:not(.today) .board";
async function toHub(page) {
  await page.goto(`${BASE}/#/play`);
  for (let k = 0; k < 3; k++) {
    if (await page.locator('[data-testid="mode-melody"]').isVisible().catch(() => false)) break;
    await page.waitForTimeout(500);
    if (!(await page.locator('[data-testid="mode-melody"]').isVisible().catch(() => false))) await page.locator("#tab-play").click();
  }
  await page.locator('[data-testid="mode-melody"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
}
async function startMode(page, mode, diff) {
  await page.locator(`[data-testid="mode-${mode}"]`).click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator(`[data-testid="difficulty-${diff}"]`).click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
}
async function grid(page) {
  return page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) {
      const d = c.querySelector(".d");
      out[Number(c.getAttribute("data-i"))] = d?.textContent?.trim() || "0";
    }
    return out.join("");
  }, BOARD);
}
/** Тап по клетке и по клавише пада — настоящий путь пальца (click), не клавиатура. */
async function tapPlace(page, i, d) {
  await page.locator(`${BOARD} .cell[data-i="${i}"]`).click();
  await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
}
const UNITS = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (3 * Math.floor(b / 3) + Math.floor(k / 3)) * 9 + 3 * (b % 3) + (k % 3))),
];

async function flow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}-${c.diff}${c.rm ? "-rm" : ""}`;
  const shot = (s) => join(OUT, `${tag}-${s}.png`);
  try {
    const { page, errs } = await open(browser, c);
    await toHub(page);
    const rows = await page.locator(".hub-row.mode").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    ok(`${tag} хаб: порядок Классика, Чернила, Лжец, Мелодия, Глифы`, JSON.stringify(rows) === JSON.stringify(["mode-classic", "mode-ink", "mode-liar", "mode-melody", "mode-glyphs"]), rows.join(","));
    if (c.full) await page.screenshot({ path: shot("0-hub") });

    if (c.classic) {
      await startMode(page, "classic", "easy");
      const g = await grid(page);
      const sol = solve(g).join("");
      const empty = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
      for (const i of empty.slice(0, 3)) await tapPlace(page, i, Number(sol[i]));
      const s = await S(page);
      ok(`${tag} Классика беззвучна: AudioContext не создан, осцилляторов нет`, s.contexts === 0 && s.n === 0, JSON.stringify(s));
      await page.locator('[data-testid="more-button"]').click();
      ok(`${tag} Классика: в ⋯ нет пункта «Звук»`, (await page.locator('[data-testid="menu-sound"]').count()) === 0);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await page.locator("#tab-play").click();
      await page.locator('[data-testid="mode-melody"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(350);
    }

    const t0 = Date.now();
    await startMode(page, "melody", c.diff);
    ok(`${tag} Мелодия ${c.diff}: настоящая генерация, партия на поле`, true, `${Date.now() - t0} мс`);
    const chip = await page.locator('[data-testid="mode-chip"]').getAttribute("data-mode");
    ok(`${tag} чип режима «Мелодия»`, chip === "melody");
    ok(`${tag} строка о звуке до первого хода`, await page.locator('[data-testid="melody-hint"]').isVisible());
    let s = await S(page);
    ok(`${tag} до первой цифры AudioContext не создан`, s.contexts === 0, JSON.stringify(s));
    await page.screenshot({ path: shot("1-fresh") });

    const g = await grid(page);
    const sol = solve(g).join("");
    const empty = new Set([...g].flatMap((ch, i) => (ch === "0" ? [i] : [])));
    // Юнит с наименьшим числом пустых клеток (≥ 2): его закроем; первую цифру ставим вне него.
    // PD-206: держим и сам юнит (все 9 клеток), а не только его пустые клетки — по пустым `UNITS.find` находил первую
    // строку, где они лежат, хотя закрывали блок (213/213 → 212/213 на части сеток).
    const pick = UNITS.map((u) => ({ u, e: u.filter((i) => empty.has(i)) })).filter((x) => x.e.length >= 2).sort((a, b) => a.e.length - b.e.length)[0];
    const unit = pick.e;
    const other = [...empty].filter((i) => !unit.includes(i));

    // 1) первая цифра = жест
    let n0 = (await S(page)).n;
    const first = other[0];
    await tapPlace(page, first, Number(sol[first]));
    await page.waitForTimeout(250);
    s = await S(page);
    let notes = await notesSince(page, n0);
    // resume: chromium создаёт контекст сразу запущенным (активация жеста), webkit — через resume() в том же жесте.
    ok(`${tag} первая цифра: контекст создан в жесте и запущен, нота этой цифры прозвучала`, s.contexts === 1 && (s.resumes >= 1 || s.state === "running") && notes[0] === Number(sol[first]), `${JSON.stringify(s)} notes=${notes}`);
    ok(`${tag} контекст запущен (running)`, s.state === "running", String(s.state));
    ok(`${tag} строка о звуке ушла после хода`, !(await page.locator('[data-testid="melody-hint"]').isVisible().catch(() => false)));

    // 2) ошибочная цифра звучит своей нотой; undo и стирание молчат
    const wrongCell = other[1];
    const wrong = (Number(sol[wrongCell]) % 9) + 1;
    n0 = (await S(page)).n;
    await tapPlace(page, wrongCell, wrong);
    await page.waitForTimeout(150);
    notes = await notesSince(page, n0);
    ok(`${tag} ошибочная цифра звучит как верная (нота ${wrong})`, notes.length === 1 && notes[0] === wrong, String(notes));
    n0 = (await S(page)).n;
    await page.locator(".play:not(.today) .actions .act").nth(1).click(); // Undo
    await page.locator(`${BOARD} .cell[data-i="${first}"]`).click();
    await page.locator(".play:not(.today) .actions .act").nth(2).click(); // Erase
    await page.waitForTimeout(250);
    ok(`${tag} undo и стирание молчат`, (await S(page)).n === n0);
    await tapPlace(page, first, Number(sol[first]));

    // 3) закрытие юнита: арпеджио + кольцо
    for (const i of unit.slice(0, -1)) await tapPlace(page, i, Number(sol[i]));
    n0 = (await S(page)).n;
    const last = unit[unit.length - 1];
    await tapPlace(page, last, Number(sol[last]));
    await page.waitForTimeout(c.rm ? 500 : 350 + 4 * 110);
    const ring = await page.evaluate((sel) => {
      const rs = [...document.querySelectorAll(`${sel} .cell .mring`)];
      return {
        n: rs.length,
        cells: [...new Set(rs.map((r) => Number(r.closest(".cell").getAttribute("data-i"))))].sort((a, b) => a - b),
        delays: rs.map((r) => getComputedStyle(r).animationDelay),
        dur: rs[0] ? getComputedStyle(rs[0]).animationDuration : null,
        shadow: rs[0] ? getComputedStyle(rs[0]).boxShadow : null,
      };
    }, BOARD);
    const unitSorted = [...pick.u].sort((a, b) => a - b);
    ok(`${tag} кольцо на всех 9 клетках закрытого юнита`, ring.n >= 9 && unitSorted.every((i) => ring.cells.includes(i)), `${ring.n} колец, клетки ${ring.cells}`);
    ok(`${tag} кольцо — тонкая обводка 2 px`, /inset/.test(ring.shadow ?? "") && /2px/.test(ring.shadow ?? ""), ring.shadow);
    if (c.rm) {
      ok(`${tag} Reduce Motion: весь юнит разом (одна задержка), 1 с`, new Set(ring.delays.slice(0, 9)).size === 1 && /^1s$|^1000ms$/.test(ring.dur), `${[...new Set(ring.delays)]} ${ring.dur}`);
    } else {
      ok(`${tag} бег кольца: задержки по шагу 110 мс`, new Set(ring.delays.slice(0, 9)).size >= 9 && /0\.56s|560ms/.test(ring.dur), `${ring.delays.slice(0, 3)}… ${ring.dur}`);
    }
    await page.screenshot({ path: shot("2-ring") });
    await page.waitForTimeout(1600);
    notes = await notesSince(page, n0);
    // Первым звучит первый закрытый юнит в порядке строка → столбец → блок (тот же порядок, что у UNITS).
    const after = await grid(page);
    const unitDigits = UNITS.find((u) => u.includes(last) && u.every((i) => after[i] !== "0")).map((i) => Number(after[i]));
    ok(`${tag} закрытый юнит: нота + арпеджио из 9 нот юнита по порядку`, notes.length >= 10 && JSON.stringify(notes.slice(1, 10)) === JSON.stringify(unitDigits), `${notes.slice(0, 10)} / ${unitDigits}`);
    const ringsLeft = await page.locator(`${BOARD} .cell .mring`).count();
    ok(`${tag} кольцо гаснет и снимается (~1 с)`, ringsLeft === 0, String(ringsLeft));

    // 4) меню ⋯ → «Звук»
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-sound"]').waitFor();
    await page.waitForTimeout(300); // меню проявляется 160 мс
    const item = await page.locator('[data-testid="menu-sound"]').evaluate((e) => ({ role: e.getAttribute("role"), checked: e.getAttribute("aria-checked"), label: e.getAttribute("aria-label") }));
    ok(`${tag} ⋯: пункт «Звук» — menuitemcheckbox, отмечен`, item.role === "menuitemcheckbox" && item.checked === "true" && !!item.label, JSON.stringify(item));
    if (c.full || c.w === 320) await page.screenshot({ path: shot("3-menu") });
    await page.locator('[data-testid="menu-sound"]').click();
    await page.waitForTimeout(250);
    const muted = await page.locator('[data-testid="mode-chip"]').evaluate((e) => ({ m: e.getAttribute("data-muted"), t: e.textContent, cls: e.className }));
    ok(`${tag} выкл → чип «Мелодия · без звука»`, muted.m === "true" && /muted|без звук/.test(muted.t ?? ""), JSON.stringify(muted));
    ok(`${tag} настройка сохранена (pundoku.melodySound = 0)`, (await page.evaluate(() => localStorage.getItem("pundoku.melodySound"))) === "0");
    const free = [...empty].filter((i) => !unit.includes(i) && i !== first && i !== wrongCell);
    n0 = (await S(page)).n;
    await tapPlace(page, free[0], Number(sol[free[0]]));
    await page.waitForTimeout(200);
    ok(`${tag} без звука нота не строится`, (await S(page)).n === n0);
    await page.screenshot({ path: shot("4-muted") });

    // перезагрузка: настройка переживает
    await page.waitForTimeout(1200);
    await page.reload();
    await toHub(page);
    await page.locator('[data-testid="mode-melody"]').click();
    await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    ok(`${tag} после перезагрузки чип по-прежнему «без звука»`, (await page.locator('[data-testid="mode-chip"]').getAttribute("data-muted")) === "true");
    await page.locator('[data-testid="more-button"]').click();
    ok(`${tag} после перезагрузки галочка снята`, (await page.locator('[data-testid="menu-sound"]').getAttribute("aria-checked")) === "false");
    await page.waitForTimeout(300);
    if (c.full) await page.screenshot({ path: shot("3-menu-muted") });
    await page.locator('[data-testid="menu-sound"]').click();
    await page.waitForTimeout(200);
    ok(`${tag} вкл → чип обычный`, (await page.locator('[data-testid="mode-chip"]').getAttribute("data-muted")) === null);

    // 5) сворачивание PWA: контекст закрывается
    const left = [...empty].filter((i) => !unit.includes(i) && i !== first && i !== wrongCell && i !== free[0]);
    await tapPlace(page, left[0], Number(sol[left[0]])); // жест → контекст
    await page.waitForTimeout(200);
    const before = await S(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(200);
    const hidden = await S(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    ok(`${tag} сворачивание: AudioContext закрыт`, hidden.closes === before.closes + 1, `${before.closes}→${hidden.closes}`);
    n0 = (await S(page)).n;
    await tapPlace(page, left[1], Number(sol[left[1]]));
    await page.waitForTimeout(250);
    notes = await notesSince(page, n0);
    ok(`${tag} вернулись: первая же цифра снова звучит`, notes[0] === Number(sol[left[1]]), String(notes));

    // 6) решить до конца → карточка
    const cur = await grid(page);
    for (let i = 0; i < 81; i++) if (cur[i] !== sol[i]) await tapPlace(page, i, Number(sol[i]));
    await page.locator('[data-testid="result-card"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const tune = page.locator('[data-testid="melody-tune"]');
    ok(`${tag} карточка: «Сыграть мелодию» под картой пути`, (await tune.count()) === 1 && (await page.evaluate(() => document.querySelector('[data-testid="melody-tune"]')?.previousElementSibling?.classList.contains("legend"))));
    await tune.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("5-card-idle") });
    n0 = (await S(page)).n;
    await tune.click();
    await page.waitForTimeout(1200);
    const playing = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="melody-tune"]').textContent,
      p: document.querySelector('[data-testid="melody-tune"]').getAttribute("data-playing"),
      cur: !!document.querySelector('[data-testid="heat-cur"]'),
      pend: document.querySelectorAll(".heat i.pend").length,
      live: document.querySelector('[data-testid="melody-live"]').textContent,
    }));
    notes = await notesSince(page, n0);
    ok(`${tag} «Сыграть» → «Остановить», карта проявляется, текущая в кольце, live-region`, playing.p === "true" && playing.cur && playing.pend > 0 && !!playing.live, JSON.stringify(playing));
    ok(`${tag} мелодия пути звучит (ноты идут)`, notes.length >= 2, `${notes.length} нот`);
    await page.screenshot({ path: shot("6-card-playing") });
    await tune.click();
    await page.waitForTimeout(300);
    n0 = (await S(page)).n;
    await page.waitForTimeout(800);
    const stopped = await page.evaluate(() => ({ p: document.querySelector('[data-testid="melody-tune"]').getAttribute("data-playing"), pend: document.querySelectorAll(".heat i.pend").length }));
    ok(`${tag} «Остановить»: кнопка вернулась, карта целиком, новых нот нет`, stopped.p === "false" && stopped.pend === 0 && (await S(page)).n === n0, JSON.stringify(stopped));

    // 7) таймлапс: кнопка звука, ▶ — ноты
    if (c.full) {
      await page.locator('[data-testid="tl-watch"]').click();
      await page.locator('[data-testid="tl-start"]').click();
      await page.locator('[data-testid="tl-player"]').waitFor();
      const snd = await page.locator('[data-testid="tl-sound"]').evaluate((e) => ({ p: e.getAttribute("aria-pressed"), l: e.getAttribute("aria-label") }));
      ok(`${tag} таймлапс: кнопка звука в шапке, включена`, snd.p === "true" && !!snd.l, JSON.stringify(snd));
      n0 = (await S(page)).n;
      await page.locator('[data-testid="tl-play"]').click();
      await page.waitForTimeout(5000);
      notes = await notesSince(page, n0);
      ok(`${tag} таймлапс ▶: мелодия идёт за кадрами`, notes.length >= 2, `${notes.length} нот`);
      await page.screenshot({ path: shot("7-timelapse") });
      await page.locator('[data-testid="tl-play"]').click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  if (!process.env.WK_ONLY) for (const c of CONFIGS) await flow("cr", chromium, c);
  if (!process.env.CR_ONLY) for (const c of WK) await flow("wk", webkit, c);
} finally {
  const failed = results.filter((r) => !r.cond);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("FAILED:\n" + failed.map((f) => "  " + f.name).join("\n"));
    process.exitCode = 1;
  }
}
