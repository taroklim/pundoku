/**
 * PD-194 — режим «Глифы» (набор A «Фигуры», макет PD-170) на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5194 --strictPort
 *   PD_PW_HOME=<папка, где лежит node_modules/playwright> BASE=http://localhost:5194 node design/pd194-check.mjs
 *
 * Генерация НЕ настоящая: `window.Worker` генерации Play подменяется заглушкой (addInitScript) — сетка `dailyPuzzle` движка,
 * посчитанная в Node, отвечает сразу. Сценарий: хаб → строка «Глифы» → шит → «Начать» → партия знаками (дано залитым, ваше
 * контуром, заметки мини-знаками, пад со знаками и остатками, чип режима) → перезагрузка: слот режима на хабе, партия снова
 * знаками → решение до конца → карточка результата → таймлапс (кадр плеера знаками). Классика рядом — цифрами.
 * Проверки: ни одной цифры в клетках/на паде, подписи VoiceOver именами форм (en/uk/ru), размеры знака (≈57 % клетки, пад
 * ≤ 24 px, заметка ≈ 25 % клетки), нет горизонтального скролла, консоль чистая. Кадры: design/pd194-shots/.
 * Никаких pkill: браузеры закрываются в finally.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const { dailyPuzzle } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);

const BASE = process.env.BASE ?? "http://localhost:5194";
const OUT = join(HERE, "pd194-shots");
// Чистим только собственные кадры прогона (`<cr|wk>-<ширина>-<схема>-…png`, debug-кадры); ручные кадры
// (например cr-struck-notes-*.png) в той же папке сохраняются.
const OWN_SHOT = /^(cr|wk)-\d{3}-(light|dark)-.*\.png$/;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (OWN_SHOT.test(f)) rmSync(join(OUT, f), { force: true });
const P = dailyPuzzle("2026-10-05", "easy");
const PUZZLE = { mission: P.mission, solution: P.solution, difficulty: P.difficulty, seed: P.seed };
const EMPTY = [...P.mission].flatMap((c, i) => (c === "0" ? [i] : []));
const FORMS = ["circle", "triangle", "square", "plus", "diamond", "dome", "star", "leaf", "hourglass"];
const NAMES = {
  en: { circle: "circle", diamond: "diamond" },
  uk: { circle: "коло", diamond: "ромб" },
  ru: { circle: "круг", diamond: "ромб" },
};

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const CONFIGS = [
  { w: 390, h: 844, scheme: "light", lang: "en", full: true },
  { w: 390, h: 844, scheme: "dark", lang: "ru", full: true },
  { w: 320, h: 568, scheme: "light", lang: "uk" },
  { w: 430, h: 932, scheme: "dark", lang: "en", rm: true },
];

function stub({ puzzle }) {
  const Real = window.Worker;
  class FakeWorker {
    constructor(url, opts) {
      this.url = String(url);
      this.opts = opts;
      this.onmessage = null;
      this.onerror = null;
      this.dead = false;
    }
    postMessage(req) {
      const reply = (res) => {
        if (!this.dead && this.onmessage) this.onmessage({ data: res });
      };
      if (req.date !== undefined || req.liar || !/generate\.worker/.test(this.url)) {
        const w = new Real(this.url, this.opts);
        w.onmessage = (e) => reply(e.data);
        w.onerror = (e) => this.onerror?.(e);
        w.postMessage(req);
        this.real = w;
        return;
      }
      setTimeout(() => reply({ id: req.id, ok: true, puzzle }), 30);
    }
    terminate() {
      this.dead = true;
      this.real?.terminate();
    }
    addEventListener() {}
    removeEventListener() {}
  }
  window.Worker = FakeWorker;
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
  await ctx.addInitScript(stub, { puzzle: PUZZLE });
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
  // webkit без API: прерванные запросы /api/daily и generate.worker (воркер заглушки при уходе со страницы) пишут
  // «… due to access control checks» — и в консоль, и как pageerror. Шум стенда, не ошибка приложения.
  const STAND_NOISE = /access control checks/;
  page.on("pageerror", (e) => {
    if (!(STAND_NOISE.test(e.message) && /\/api\/|generate\.worker/.test(e.message))) errs.push(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::/.test(m.text()) && !STAND_NOISE.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs };
}

/** Состояние поля/пада: знаки, цифры в тексте, размеры, подписи. */
const probe = (page) =>
  page.evaluate(() => {
    const cells = [...document.querySelectorAll(".play:not(.today) .board .cell")];
    const r = (el) => el?.getBoundingClientRect();
    const given = document.querySelector(".play:not(.today) .board .cell .d.given svg.gl");
    const placed = document.querySelector(".play:not(.today) .board .cell .d.player svg.gl");
    const note = document.querySelector(".play:not(.today) .board .cell .marks svg.gl-note");
    const cellOf = (el) => el?.closest(".cell");
    const keys = [...document.querySelectorAll(".play:not(.today) .pad .key")];
    return {
      cells: cells.length,
      digitText: cells.filter((c) => /\d/.test(c.querySelector(".d")?.textContent ?? "") || /\d/.test(c.querySelector(".marks")?.textContent ?? "")).length,
      givenSvgs: document.querySelectorAll(".play:not(.today) .board .d.given svg.gl-given").length,
      givenFill: !!given?.querySelector("path.f") && getComputedStyle(given.querySelector("path.f")).fill !== "none",
      placedOutline: placed ? getComputedStyle(placed.querySelector("path.o")).fill === "none" && getComputedStyle(placed.querySelector("path.o")).stroke !== "none" : null,
      givenRatio: given ? r(given).width / r(cellOf(given)).width : null,
      placedRatio: placed ? r(placed).width / r(cellOf(placed)).width : null,
      noteRatio: note ? r(note).width / r(cellOf(note)).width : null,
      padForms: keys.map((k) => k.querySelector("svg.gl-pad")?.getAttribute("data-form") ?? null),
      padText: keys.map((k) => k.querySelector(".kd")?.textContent ?? "").join(""),
      padGlyphW: keys[0]?.querySelector("svg.gl-pad") ? r(keys[0].querySelector("svg.gl-pad")).width : null,
      padRem: keys.map((k) => k.querySelector(".kr")?.textContent ?? ""),
      padLabel0: keys[0]?.getAttribute("aria-label"),
      chip: document.querySelector('[data-testid="mode-chip"]')?.getAttribute("data-mode") ?? null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      colors: given && placed ? [getComputedStyle(given).color, getComputedStyle(placed).color] : null,
    };
  });
const label = (page, i) => page.locator(`.play:not(.today) .board .cell[data-i="${i}"]`).getAttribute("aria-label");

async function startGlyphs(page) {
  await page.goto(`${BASE}/#/play`);
  // Живая партия на доске — повторный тап по вкладке Play возвращает на хаб (партия паркуется).
  if (!(await page.locator('[data-testid="mode-glyphs"]').isVisible().catch(() => false))) {
    await page.waitForTimeout(600);
    if (!(await page.locator('[data-testid="mode-glyphs"]').isVisible())) await page.locator("#tab-play").click();
  }
  await page.locator('[data-testid="mode-glyphs"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="mode-glyphs"]').click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(".play:not(.today) .board .cell .d.given svg.gl").first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
}
async function place(page, i, d) {
  await page.locator(`.play:not(.today) .board .cell[data-i="${i}"]`).click();
  await page.keyboard.press(`Digit${d}`);
}

async function flow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;
  try {
    const { page, errs } = await open(browser, c);
    await page.goto(`${BASE}/#/play`);
    await page.locator('[data-testid="mode-glyphs"]').waitFor({ timeout: 20000 });
    const row = await page.locator('[data-testid="mode-glyphs"]').textContent();
    ok(`${tag} строка «Глифы» на хабе`, /Glyphs|Гліфи|Глифы/.test(row ?? ""), row ?? "");
    if (c.full) await page.screenshot({ path: join(OUT, `${tag}-0-hub.png`) });

    await startGlyphs(page);
    // Три верных хода, заметки в одной клетке, выбор на «дано» (подсветка той же формы).
    for (const i of EMPTY.slice(0, 3)) await place(page, i, P.solution[i]);
    const noteCell = EMPTY[5];
    await page.locator(`.play:not(.today) .board .cell[data-i="${noteCell}"]`).click();
    await page.keyboard.press("KeyN");
    for (const d of [1, 3, 5, 7]) await page.keyboard.press(`Digit${d}`);
    await page.keyboard.press("KeyN");
    const givenIdx = [...P.mission].findIndex((ch) => ch !== "0");
    await page.locator(`.play:not(.today) .board .cell[data-i="${givenIdx}"]`).click();
    await page.waitForTimeout(500);
    const m = await probe(page);
    ok(`${tag} 81 клетка, ни одной цифры в клетках`, m.cells === 81 && m.digitText === 0, `digitText=${m.digitText}`);
    ok(`${tag} дано — залитые знаки`, m.givenSvgs === 81 - EMPTY.length && m.givenFill, `${m.givenSvgs}`);
    ok(`${tag} ваше — контур`, m.placedOutline === true);
    ok(`${tag} знак ≈ 57 % клетки`, m.givenRatio > 0.52 && m.givenRatio < 0.62 && m.placedRatio > 0.52 && m.placedRatio < 0.62, `${m.givenRatio?.toFixed(3)} / ${m.placedRatio?.toFixed(3)}`);
    ok(`${tag} заметка ≈ 25 % клетки`, m.noteRatio > 0.18 && m.noteRatio < 0.3, `${m.noteRatio?.toFixed(3)}`);
    ok(`${tag} пад: 9 знаков по порядку набора A, без цифр`, JSON.stringify(m.padForms) === JSON.stringify(FORMS) && !/\d/.test(m.padText), m.padText);
    ok(`${tag} пад: знак ≤ 24 px`, m.padGlyphW > 12 && m.padGlyphW <= 24.5, `${m.padGlyphW?.toFixed(1)}`);
    ok(`${tag} пад: остатки на месте`, m.padRem.every((x) => /^[\d·]$/.test(x)), m.padRem.join(","));
    ok(`${tag} чип режима «Глифы»`, m.chip === "glyphs");
    ok(`${tag} без горизонтального скролла`, !m.overflowX);
    const lbl = await label(page, givenIdx);
    const shape = FORMS[Number(P.mission[givenIdx]) - 1];
    ok(`${tag} VoiceOver: дано — имя формы`, !/\d,|\d$/.test(lbl.replace(/^\D*\d+\D+\d+/, "")) && lbl.includes(NAMES[c.lang][shape] ?? ""), lbl);
    ok(`${tag} VoiceOver: пад — имя формы`, m.padLabel0.startsWith(NAMES[c.lang].circle), m.padLabel0);
    await page.screenshot({ path: join(OUT, `${tag}-1-board.png`) });

    // Перезагрузка: слот режима на хабе, партия снова знаками.
    if (c.full) {
      await page.waitForTimeout(1500); // запись в IndexedDB идёт очередью после хода
      await page.goto(`${BASE}/#/today`);
      await page.waitForTimeout(300);
      await page.reload();
      await page.locator("#tab-play").waitFor({ timeout: 20000 });
      await page.waitForTimeout(500);
      await page.locator("#tab-play").click();
      await page.locator('[data-testid="mode-status-glyphs"]').waitFor({ timeout: 10000 }).catch(async () => {
        console.log("DEBUG hub:", await page.locator(".play:not(.today)").first().textContent().catch(() => "?"), page.url());
        await page.screenshot({ path: join(OUT, `${tag}-debug.png`) });
      });
      ok(`${tag} после перезагрузки — строка «В процессе» у Глифов`, (await page.locator('[data-testid="mode-status-glyphs"]').count()) === 1);
      await page.locator('[data-testid="mode-glyphs"]').click();
      await page.locator(".play:not(.today) .board .cell .d.player svg.gl-placed").first().waitFor({ timeout: 5000 });
      const m2 = await probe(page);
      ok(`${tag} после перезагрузки — партия знаками`, m2.digitText === 0 && m2.givenSvgs === 81 - EMPTY.length);
    }

    // Решить до конца → карточка → таймлапс.
    for (const i of EMPTY.slice(3)) {
      await place(page, i, P.solution[i]);
    }
    await page.locator('[data-testid="result-card"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    ok(`${tag} решено — карточка результата`, true);
    if (c.full) await page.screenshot({ path: join(OUT, `${tag}-2-card.png`) });
    await page.locator('[data-testid="tl-watch"]').click();
    await page.locator('[data-testid="tl-start"]').click();
    await page.locator('[data-testid="tl-player"]').waitFor();
    await page.locator('[data-testid="tl-play"]').click(); // пауза
    await page.waitForTimeout(200);
    for (let k = 0; k < 24; k++) await page.locator('[data-testid="tl-next"]').click();
    await page.waitForTimeout(400);
    const tl = await page.evaluate(() => ({
      digits: [...document.querySelectorAll(".tl-field .d")].filter((d) => /\d/.test(d.textContent ?? "")).length,
      given: document.querySelectorAll(".tl-field .d.given svg.gl-given").length,
      placed: document.querySelectorAll(".tl-field .d.player svg.gl-placed").length,
    }));
    ok(`${tag} таймлапс знаками`, tl.digits === 0 && tl.given === 81 - EMPTY.length && tl.placed > 0, JSON.stringify(tl));
    await page.screenshot({ path: join(OUT, `${tag}-3-timelapse.png`) });

    // Классика рядом — цифрами (регрессия). Закрыть таймлапс, повторный тап по вкладке Play — на хаб.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.locator('.tabbar [aria-controls="' + (await page.locator('.tabbar .tab[aria-selected="true"]').getAttribute("aria-controls")) + '"]').click();
    await page.locator('[data-testid="mode-classic"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="mode-classic"]').click();
    await page.locator('[data-testid="sheet-start"]').waitFor();
    await page.waitForTimeout(350);
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator(".play:not(.today) .board .cell .d.given").first().waitFor({ timeout: 8000 });
    const cl = await page.evaluate(() => ({ gl: document.querySelectorAll(".gl").length, txt: document.querySelector(".play:not(.today) .board .cell .d.given")?.textContent }));
    ok(`${tag} Классика без изменений (цифры, ни одного знака)`, cl.gl === 0 && /^\d$/.test(cl.txt ?? ""), JSON.stringify(cl));

    // forced-colors (только chromium): знаки видны, различие заливка/контур держится.
    if (name === "cr" && c.full) {
      await startGlyphs(page);
      for (const i of EMPTY.slice(0, 4)) await place(page, i, P.solution[i]);
      await page.emulateMedia({ forcedColors: "active" });
      await page.waitForTimeout(300);
      const fc = await page.evaluate(() => {
        const g = document.querySelector(".play:not(.today) .board .d.given svg.gl path.f");
        const p = document.querySelector(".play:not(.today) .board .d.player svg.gl path.o");
        return { gFill: g && getComputedStyle(g).fill, pFill: p && getComputedStyle(p).fill, pStroke: p && getComputedStyle(p).stroke };
      });
      ok(`${tag} forced-colors: дано залито, ваше контуром`, fc.gFill && fc.gFill !== "none" && fc.pFill === "none" && fc.pStroke !== "none", JSON.stringify(fc));
      await page.screenshot({ path: join(OUT, `${tag}-4-forced-colors.png`) });
      await page.emulateMedia({ forcedColors: "none" });
    }
    ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  if (!process.env.WK_ONLY) for (const c of CONFIGS) await flow("cr", chromium, c);
  for (const c of CONFIGS.filter((x) => x.full)) await flow("wk", webkit, c);
} finally {
  const failed = results.filter((r) => !r.cond);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("FAILED:\n" + failed.map((f) => "  " + f.name).join("\n"));
    process.exitCode = 1;
  }
}
