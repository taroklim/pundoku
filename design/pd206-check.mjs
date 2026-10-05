/**
 * PD-206 — фикс по QA PD-204 режима «Мелодия» на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit, настоящая генерация.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5206 --strictPort
 *   PD_PW_HOME=/tmp/pundoku-qa/pw BASE=http://localhost:5206 node design/pd206-check.mjs
 *
 * A. Строка о звуке до первого хода при крупном шрифте: 320×568 и 390×844, xxxL (html 23 px) и AX3 (40 px — `data-type=ax3`
 *    ставит само приложение), en/uk/ru, light/dark (+ 17 px для регресса). Строка между полем и падом (не перекрывает ни поле,
 *    ни клавиши), без горизонтального выхода; при AX3 — «осталось N»; поле и пад не двигаются, когда строка уходит на первом
 *    ходу. Кадры: design/pd206-shots/.
 * B. AudioContext: партия — не создаётся жестом до первой цифры (выбор клетки, ⋯) и при выключенном звуке; первая цифра
 *    звучит тем же тапом. Карточка — после «Остановить», конца мелодии, сворачивания, ухода на Today контекст `closed`;
 *    осцилляторов без `ended` в незакрытых контекстах нет. Никаких pkill: браузеры закрываются в finally.
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

const BASE = process.env.BASE ?? "http://localhost:5206";
const OUT = join(HERE, "pd206-shots");
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^(cr|wk)-.*\.png$/.test(f)) rmSync(join(OUT, f), { force: true });

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const note = (s) => console.log("NOTE  " + s);

const HZ = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 783.99];
const digitOf = (f) => {
  const i = HZ.findIndex((h) => Math.abs(h - f) < 1);
  return i < 0 ? null : i + 1;
};

/** Шпион аудиографа: все контексты (состояние), осцилляторы с `ended` и контекстом-владельцем. */
function spy() {
  const S = { ctxs: [], resumes: 0, closes: 0, oscs: [] };
  window.__S = S;
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const C = window[name];
    if (typeof C !== "function") continue;
    if (name === "webkitAudioContext" && window.AudioContext === C) continue;
    const W = class extends C {
      constructor(...a) {
        super(...a);
        S.ctxs.push(this);
      }
    };
    try {
      Object.defineProperty(window, name, { value: W, configurable: true, writable: true });
    } catch {
      /* только чтение */
    }
  }
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  const co = P.createOscillator;
  P.createOscillator = function () {
    const o = co.call(this);
    const c = this;
    const st = o.start;
    o.start = function (...a) {
      const rec = { f: o.frequency.value, type: o.type, ended: false, ci: S.ctxs.indexOf(c) };
      S.oscs.push(rec);
      o.addEventListener("ended", () => (rec.ended = true));
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
const S = (page) =>
  page.evaluate(() => {
    const s = window.__S;
    return {
      contexts: s.ctxs.length,
      open: s.ctxs.filter((c) => c.state !== "closed").length,
      states: s.ctxs.map((c) => c.state),
      n: s.oscs.length,
      unended: s.oscs.filter((o) => !o.ended && s.ctxs[o.ci] && s.ctxs[o.ci].state !== "closed").length,
    };
  });
const notesSince = (page, k) =>
  page.evaluate((k) => window.__S.oscs.slice(k).filter((o) => o.type === "triangle").map((o) => o.f), k).then((fs) => fs.map(digitOf));

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme ?? "light",
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[c.lang],
    serviceWorkers: "block",
  });
  await ctx.addInitScript(spy);
  await ctx.addInitScript(
    ({ lang, fs }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
      } catch {
        /* приватный режим */
      }
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
    { lang: c.lang, fs: c.fs ?? 0 },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => {
    if (!/access control checks/.test(e.message)) errs.push(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::|access control/.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs };
}

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
async function startMelody(page) {
  await page.locator('[data-testid="mode-melody"]').click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator('[data-testid="difficulty-easy"]').click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(700);
}
async function grid(page) {
  return page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d")?.textContent?.trim() || "0";
    return out.join("");
  }, BOARD);
}
async function tapPlace(page, i, d) {
  await page.locator(`${BOARD} .cell[data-i="${i}"]`).click();
  await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
}

/** Геометрия: поле, строка (видимая часть), клавиши, форма. */
const geo = (page) =>
  page.evaluate((B) => {
    const r = (el) => el && el.getBoundingClientRect();
    const h = document.querySelector('[data-testid="melody-hint"]');
    const vis = (sel) => {
      const el = h?.querySelector(sel);
      return !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 2;
    };
    const form = !h ? null : vis(".mh-long") ? "long" : vis(".mh-short") ? "short" : vis(".mh-left") ? "none" : "?";
    const kids = h ? [...h.children].filter((k) => getComputedStyle(k).display !== "none" && k.getBoundingClientRect().width > 2) : [];
    const top = kids.length ? Math.min(...kids.map((k) => k.getBoundingClientRect().top)) : null;
    const bottom = kids.length ? Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) : null;
    const left = kids.length ? Math.min(...kids.map((k) => k.getBoundingClientRect().left)) : null;
    const right = kids.length ? Math.max(...kids.map((k) => k.getBoundingClientRect().right)) : null;
    const short = h?.querySelector(".mh-short");
    const b = r(document.querySelector(B));
    const key = r(document.querySelector(".play:not(.today) .pad .key"));
    return {
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      type: document.documentElement.getAttribute("data-type"),
      form,
      text: kids.map((k) => k.textContent).join(" ").trim(),
      hint: top === null ? null : [top, bottom, left, right],
      board: [b.top, b.bottom, b.width],
      padTop: key.top,
      vw: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      shortCut: !!short && getComputedStyle(short).display !== "none" && short.scrollWidth > short.clientWidth + 1,
      longName: h?.querySelector(".mh-long")?.textContent ?? "",
    };
  }, BOARD);

async function layoutFlow(bn, type, configs) {
  const browser = await type.launch();
  try {
    for (const c of configs) {
      const tag = `${bn}-${c.w}-${c.scheme}-${c.lang}-${c.fs === 40 ? "AX3" : c.fs ? c.fs + "px" : "17px"}`;
      const { ctx, page, errs } = await open(browser, c);
      try {
        await toHub(page);
        await startMelody(page);
        const g = await geo(page);
        const [top, bottom, left, right] = g.hint ?? [0, 0, 0, 0];
        const t = 0.5;
        ok(
          `${tag} строка о звуке между полем и падом (не перекрывает), без гориз. выхода`,
          g.hint && top >= g.board[1] - t && bottom <= g.padTop + t && left >= -t && right <= g.vw + t && !g.overflowX && !g.shortCut,
          `form=${g.form} rem=${g.rem} hint=[${top.toFixed(1)},${bottom.toFixed(1)}] board.bottom=${g.board[1].toFixed(1)} pad=${g.padTop.toFixed(1)} «${g.text}»`,
        );
        if (c.fs === 40) ok(`${tag} AX3: data-type=ax3, вместо подсказки «осталось N»`, g.type === "ax3" && g.form === "none" && /\d/.test(g.text), `${g.type} ${g.form} «${g.text}»`);
        ok(`${tag} полный текст — доступное имя`, g.longName.length > 30);
        if (!c.noShot) await page.screenshot({ path: join(OUT, `${tag}-fresh.png`) });
        // первый ход: строка уходит — поле и пад на месте
        const grd = await grid(page);
        const sol = solve(grd).join("");
        const i = [...grd].findIndex((ch) => ch === "0");
        await tapPlace(page, i, Number(sol[i]));
        await page.waitForTimeout(350);
        const g2 = await geo(page);
        const same = Math.abs(g2.board[0] - g.board[0]) < 0.5 && Math.abs(g2.board[2] - g.board[2]) < 0.5 && Math.abs(g2.padTop - g.padTop) < 0.5;
        ok(`${tag} первый ход: строка ушла, поле и пад не сдвинулись`, g2.form === null && same, `board ${g.board.map((x) => x.toFixed(1))} → ${g2.board.map((x) => x.toFixed(1))}, pad ${g.padTop.toFixed(1)} → ${g2.padTop.toFixed(1)}`);
        if (c.fs === 40 && !c.noShot) await page.screenshot({ path: join(OUT, `${tag}-move.png`) });
        ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function audioFlow(bn, type) {
  const browser = await type.launch();
  const tag = `${bn}-audio`;
  try {
    const { ctx, page, errs } = await open(browser, { w: 390, h: 844, lang: "en" });
    try {
      await toHub(page);
      await startMelody(page);
      const grd = await grid(page);
      const sol = solve(grd).join("");
      const empty = [...grd].flatMap((ch, i) => (ch === "0" ? [i] : []));
      // жесты до первой цифры: выбор клетки, ⋯ открыть/закрыть
      await page.locator(`${BOARD} .cell[data-i="${empty[0]}"]`).click();
      await page.locator('[data-testid="more-button"]').click();
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      let s = await S(page);
      ok(`${tag} жесты до первой цифры (клетка, ⋯) — AudioContext не создан`, s.contexts === 0, JSON.stringify(s));
      // звук выкл: цифры контекст не создают
      await page.locator('[data-testid="more-button"]').click();
      await page.locator('[data-testid="menu-sound"]').waitFor();
      await page.waitForTimeout(250);
      await page.locator('[data-testid="menu-sound"]').click();
      await page.waitForTimeout(250);
      await tapPlace(page, empty[0], Number(sol[empty[0]]));
      await tapPlace(page, empty[1], Number(sol[empty[1]]));
      await page.waitForTimeout(200);
      s = await S(page);
      ok(`${tag} «Звук» выкл: цифры AudioContext не создают`, s.contexts === 0 && s.n === 0, JSON.stringify(s));
      // включили: следующая цифра звучит тем же тапом
      await page.locator('[data-testid="more-button"]').click();
      await page.locator('[data-testid="menu-sound"]').waitFor();
      await page.waitForTimeout(250);
      await page.locator('[data-testid="menu-sound"]').click();
      await page.waitForTimeout(250);
      s = await S(page);
      ok(`${tag} включили «Звук» (жест меню) — контекста ещё нет`, s.contexts === 0, JSON.stringify(s));
      await tapPlace(page, empty[2], Number(sol[empty[2]]));
      await page.waitForTimeout(250);
      s = await S(page);
      const n1 = await notesSince(page, 0);
      ok(`${tag} первая цифра: контекст создан этим тапом, running, её нота прозвучала`, s.contexts === 1 && s.states[0] === "running" && n1[0] === Number(sol[empty[2]]), `${JSON.stringify(s)} notes=${n1}`);

      // решить до конца → карточка
      const cur = await grid(page);
      for (let i = 0; i < 81; i++) if (cur[i] !== sol[i]) await tapPlace(page, i, Number(sol[i]));
      await page.locator('[data-testid="result-card"]').waitFor({ timeout: 15000 });
      await page.waitForTimeout(4600); // хвост партии (TAIL_MS 4 с) — контекст партии закрыт
      s = await S(page);
      ok(`${tag} после хвоста партии открытых контекстов нет`, s.open === 0, JSON.stringify(s));
      const tune = page.locator('[data-testid="melody-tune"]');
      await tune.scrollIntoViewIfNeeded();
      const cardCtx = async () => (await S(page)).states.at(-1);

      // 1) «Остановить»
      await tune.click();
      await page.waitForTimeout(1500);
      ok(`${tag} карточка «Сыграть»: свой контекст running`, (await cardCtx()) === "running");
      await tune.click();
      await page.waitForTimeout(500);
      s = await S(page);
      ok(`${tag} «Остановить» → контекст карточки closed, открытых нет, оборванных осцилляторов нет`, s.states.at(-1) === "closed" && s.open === 0 && s.unended === 0, JSON.stringify({ ...s, states: s.states.slice(-2) }));
      await page.screenshot({ path: join(OUT, `${tag}-stopped.png`) });

      // 2) конец мелодии
      await tune.click();
      await page.waitForTimeout(300);
      ok(`${tag} «Сыграть» снова — новый контекст в жесте, running`, (await cardCtx()) === "running");
      await page.locator('[data-testid="melody-tune"][data-playing="false"]').waitFor({ timeout: 25000 });
      await page.waitForTimeout(1400);
      s = await S(page);
      ok(`${tag} мелодия доиграла → контекст closed, оборванных нет`, s.states.at(-1) === "closed" && s.open === 0 && s.unended === 0, JSON.stringify({ ...s, states: s.states.slice(-2) }));

      // 3) сворачивание
      await tune.click();
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(300);
      s = await S(page);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      ok(`${tag} сворачивание посреди мелодии → контекст closed`, s.states.at(-1) === "closed" && s.open === 0, JSON.stringify({ ...s, states: s.states.slice(-2) }));

      // 4) уход на Today (карточка остаётся смонтированной)
      await tune.click();
      await page.waitForTimeout(800);
      await page.locator("#tab-today").click();
      await page.waitForTimeout(600);
      s = await S(page);
      ok(`${tag} уход на Today посреди мелодии → контекст closed`, s.states.at(-1) === "closed" && s.open === 0 && s.unended === 0, JSON.stringify({ ...s, states: s.states.slice(-2) }));
      await page.locator("#tab-year").click();
      await page.waitForTimeout(500);
      s = await S(page);
      ok(`${tag} на Year — открытых контекстов нет`, s.open === 0, JSON.stringify(s));
      await page.locator("#tab-play").click();
      await page.waitForTimeout(600);
      await tune.click();
      await page.waitForTimeout(500);
      ok(`${tag} вернулись на Play — «Сыграть» снова звучит`, (await cardCtx()) === "running");
      await tune.click();
      await page.waitForTimeout(500);
      s = await S(page);
      ok(`${tag} итог: открытых контекстов нет, оборванных осцилляторов нет`, s.open === 0 && s.unended === 0, JSON.stringify({ contexts: s.contexts, open: s.open, n: s.n, unended: s.unended }));
      ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

const LAYOUT = [];
for (const w of [320, 390])
  for (const fs of [23, 40])
    for (const lang of ["en", "uk", "ru"]) for (const scheme of ["light", "dark"]) LAYOUT.push({ w, h: w === 320 ? 568 : 844, fs, lang, scheme });
for (const w of [320, 390]) for (const lang of ["en", "ru"]) LAYOUT.push({ w, h: w === 320 ? 568 : 844, fs: 0, lang, scheme: "light" });

try {
  if (!process.env.WK_ONLY) {
    await layoutFlow("cr", chromium, LAYOUT);
    await audioFlow("cr", chromium);
  }
  if (!process.env.CR_ONLY) {
    await layoutFlow("wk", webkit, LAYOUT.map((c) => ({ ...c, noShot: c.scheme === "dark" })));
    await audioFlow("wk", webkit);
  }
} finally {
  const failed = results.filter((r) => !r.cond);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("FAILED:\n" + failed.map((f) => "  " + f.name).join("\n"));
    process.exitCode = 1;
  }
}
