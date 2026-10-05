/**
 * PD-171 — Лжец на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit: кадры ключевых состояний и ручная проверка утечек.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5571 --strictPort
 *   PD_PW_HOME=/tmp/pd161-pw BASE=http://localhost:5571 node design/pd171-shots.mjs
 *
 * Сценарий (Лжец дня, сегодняшняя дата браузера): хаб → шит Лжеца → «Лжец дня» → поле до поимки (неверная цифра при
 * включённой «Подсветке ошибок») → долгое нажатие на честную подсказку (меню) → «оправдана» → долгое нажатие на лжеца →
 * поймана → доигрываем → карточка → таймлапс (последний кадр) → Year (шит месяца с отметкой).
 * Утечки до поимки: клетка лжеца неотличима от других подсказок (класс, подпись), нет `.err`, нет лампочки, a11y-дерево
 * (design/pd171-shots/a11y-*.txt) и HTML не содержат ни подписи «wrong», ни отметок лжеца; URL/консоль чистые.
 * Секрет сетки скрипт берёт из движка (`dailyLiarPuzzle`), а не со страницы. Никаких pkill: браузеры закрываются в finally.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
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
const { dailyLiarPuzzle } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);

const BASE = process.env.BASE ?? "http://localhost:5571";
const OUT = join(HERE, "pd171-shots");
const ONLY = process.env.ONLY;
// ONLY=cr|wk перезаписывает кадры только своего движка, остальные остаются.
if (ONLY && existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.startsWith(`${ONLY}-`) || f.startsWith(`a11y-${ONLY}-`)) rmSync(join(OUT, f));
if (!ONLY) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const CONFIGS = [
  { w: 390, h: 844, scheme: "light", lang: "en" },
  { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true },
  { w: 430, h: 932, scheme: "light", lang: "ru", rm: true },
  { w: 390, h: 844, scheme: "dark", lang: "ru" },
];

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[c.lang],
  });
  await ctx.addInitScript(
    ({ lang, ax3 }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
        localStorage.setItem("pundoku.highlightWrong", "1"); // самый «болтливый» режим подсветки
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
    { lang: c.lang, ax3: !!c.ax3 },
  );
  const page = await ctx.newPage();
  const errs = [];
  const logs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    logs.push(m.text());
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::/.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs, logs };
}

const cellSel = (i) => `.board [data-i="${i}"]`;
async function longPress(page, i) {
  const box = await page.locator(cellSel(i)).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function put(page, i, d) {
  await page.locator(cellSel(i)).click();
  await page.keyboard.press(`Digit${d}`);
}

async function flow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}`;
  try {
    const { page, errs, logs } = await open(browser, c);
    await page.goto(`${BASE}/#/play`);
    await page.locator('[data-testid="mode-liar"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${tag}-01-hub.png`) });
    await page.locator('[data-testid="mode-liar"]').click();
    await page.locator('[data-testid="liar-daily"]').waitFor();
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(OUT, `${tag}-02-sheet.png`) });
    await page.locator('[data-testid="liar-daily"]').click();
    await page.locator('.board[data-phase="playing"]').waitFor({ timeout: 20000 });
    const date = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const P = dailyLiarPuzzle(date, "medium");
    const mission = [...P.mission].map(Number);
    const sol = [...P.solution].map(Number);
    const empties = mission.flatMap((g, i) => (g === 0 ? [i] : []));
    const honest = mission.findIndex((g, i) => g !== 0 && i !== P.liarCell);
    ok(`${tag}: на поле ложная цифра`, (await page.locator(cellSel(P.liarCell)).innerText()).trim() === String(P.liarDigit));

    // До поимки: пара верных цифр и одна неверная (по истинному решению).
    await put(page, empties[0], sol[empties[0]]);
    await put(page, empties[1], sol[empties[1]]);
    const wrongCell = empties[2];
    await put(page, wrongCell, (sol[wrongCell] % 9) + 1);
    await page.locator(cellSel(empties[3])).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${tag}-03-before-catch.png`) });
    // Повторный тап по вкладке Play — хаб: незаконченный Лжец дня — строка «Продолжить»; тап возвращает на доску.
    await page.locator('.tabbar .tab[aria-selected="true"]').click();
    await page.locator('[data-testid="continue-liar-day"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${tag}-03b-hub-continue.png`) });
    await page.locator('[data-testid="continue-liar-day"]').click();
    await page.locator('.board[data-phase="playing"]').waitFor();
    await page.locator(cellSel(empties[3])).click();
    await page.waitForTimeout(300);

    // Утечки: сравнение клетки лжеца с честной подсказкой, ошибки не подсвечены, лампочки нет, a11y-дерево и HTML.
    const probe = await page.evaluate(
      ({ liar, honest, wrongCell }) => {
        const c = (i) => document.querySelector(`.board [data-i="${i}"]`);
        const lab = (i) => c(i).getAttribute("aria-label").replace(/\d+/g, "#");
        return {
          // Без классов положения относительно выбора (ряд/столбец/блок выбранной, та же цифра) — они от геометрии, не от секрета.
          sameClass: [c(liar), c(honest)].map((e) => [...e.classList].filter((k) => !["peer", "same", "sel"].includes(k)).join(" ")).every((v, _, a) => v === a[0]),
          sameLabel: lab(liar) === lab(honest),
          errs: document.querySelectorAll(".board .err").length,
          wrongClass: c(wrongCell).className,
          lamp: !!document.querySelector('[data-testid="hint-button"]'),
          html: document.documentElement.outerHTML,
          url: location.href,
        };
      },
      { liar: P.liarCell, honest, wrongCell },
    );
    ok(`${tag}: клетка лжеца = честная подсказка (класс)`, probe.sameClass);
    ok(`${tag}: клетка лжеца = честная подсказка (подпись)`, probe.sameLabel);
    ok(`${tag}: до поимки нет подсветки ошибок`, probe.errs === 0, probe.wrongClass);
    ok(`${tag}: до поимки нет лампочки подсказок`, !probe.lamp);
    ok(`${tag}: в HTML нет следов лжеца`, !/liar-|data-liar|caught|acquitted|class="lie"/.test(probe.html.replace(/data-testid="mode-liar"|data-mode="liar"|liar\.css/g, "")));
    ok(`${tag}: URL без секрета`, !/liar|cell|digit/i.test(probe.url.replace(/#\/play$/, "")), probe.url);
    const aria = await page.locator("body").ariaSnapshot();
    writeFileSync(join(OUT, `a11y-${tag}-before-catch.txt`), aria);
    ok(`${tag}: a11y-дерево до поимки без «wrong»/оправданных/зачёркнутых`, !/wrong|acquitted|struck|неверн|оправдан|зачёрк|виправдан|закреслен|хибн/i.test(aria));
    ok(`${tag}: консоль без секрета`, !logs.some((l) => l.includes(P.honestMission) || l.includes(P.solution)));

    // Жест: долгое нажатие на честную подсказку → меню с одним пунктом.
    await longPress(page, honest);
    const menu = page.locator('[data-testid="accuse-menu"]');
    ok(`${tag}: долгое нажатие открывает меню «Обвинить»`, await menu.isVisible());
    ok(`${tag}: в меню один пункт`, (await menu.locator('[role="menuitem"]').count()) === 1);
    await page.screenshot({ path: join(OUT, `${tag}-04-accuse-menu.png`) });
    await page.locator('[data-testid="accuse-confirm"]').click();
    await page.waitForTimeout(350);
    ok(`${tag}: неверное обвинение — оправдана`, await page.locator(`${cellSel(honest)}.acquitted`).isVisible());
    await page.screenshot({ path: join(OUT, `${tag}-05-acquitted.png`) });
    await longPress(page, honest);
    ok(`${tag}: повторно обвинить нельзя`, (await menu.count()) === 0);

    // Поимка.
    await longPress(page, P.liarCell);
    await page.locator('[data-testid="accuse-confirm"]').click();
    await page.waitForTimeout(450);
    const caught = await page.evaluate(
      ({ liar, wrongCell }) => {
        const c = document.querySelector(`.board [data-i="${liar}"]`);
        return {
          truth: c.querySelector(".d.given")?.textContent,
          lie: c.querySelector(".lie")?.textContent,
          errNow: document.querySelector(`.board [data-i="${wrongCell}"]`).classList.contains("err"),
          lamp: !!document.querySelector('[data-testid="hint-button"]'),
        };
      },
      { liar: P.liarCell, wrongCell },
    );
    ok(`${tag}: поймана — истинная цифра и зачёркнутая ложь`, caught.truth === String(P.trueDigit) && caught.lie === String(P.liarDigit));
    ok(`${tag}: после поимки — подсветка ошибок и подсказки`, caught.errNow && caught.lamp);
    await page.screenshot({ path: join(OUT, `${tag}-06-caught.png`) });

    // Доигрываем.
    await put(page, wrongCell, sol[wrongCell]);
    for (const i of empties.slice(3)) await put(page, i, sol[i]);
    await page.locator('[data-testid="result-card"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${tag}-07-final-card.png`) });
    const card = page.locator('[data-testid="result-card"]');
    await page.locator('[data-testid="liar-compare"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await card.screenshot({ path: join(OUT, `${tag}-08-card-rows.png`) });
    ok(`${tag}: карточка — строки Лжеца`, (await page.locator('[data-testid="liar-move-row"]').count()) === 1 && (await page.locator('[data-testid="liar-accuse-row"]').count()) === 1);

    // Таймлапс: последний кадр (истина + зачёркнутая ложь + печать оправданной).
    if (await page.locator('[data-testid="tl-watch"]').count()) {
      await page.locator('[data-testid="tl-watch"]').click();
      await page.locator('[data-testid="tl-start"]').click();
      await page.locator('[data-testid="tl-scrub"]').evaluate((el) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(el, el.max);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(400);
      const tl = await page.evaluate((liar) => {
        const c = document.querySelector(`.tl-field [data-i="${liar}"]`);
        return { lie: c?.querySelector(".lie")?.textContent ?? null, acq: document.querySelectorAll(".tl-field .acquitted").length };
      }, P.liarCell);
      ok(`${tag}: таймлапс — слой обвинений`, tl.lie === String(P.liarDigit) && tl.acq === 1);
      await page.screenshot({ path: join(OUT, `${tag}-09-timelapse.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    // Year: шит месяца с отметкой пойманного Лжеца дня.
    await page.goto(`${BASE}/#/year`);
    await page.locator('[data-testid="year-canvas"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    ok(`${tag}: Year — отметка на сегодняшней клетке`, (await page.locator(`.year-month [data-date="${date}"] .ylie`).count()) === 1);
    await page.locator(`.year-month[data-month="${Number(date.slice(5, 7)) - 1}"]`).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${tag}-10-year-month.png`) });
    await page.locator(`.ycell[data-date="${date}"]`).click();
    await page.waitForTimeout(450);
    ok(`${tag}: Year — строка Лжеца дня в карточке дня`, (await page.locator('[data-testid="liar-year-row"]').count()) === 1);
    await page.screenshot({ path: join(OUT, `${tag}-11-year-day.png`) });

    ok(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }
}

/** Заготовки expert/master (§1.5): вход в режим (шит Лжеца) прогревает обе в фоне; старт expert после этого — без ожидания. */
async function prefetch(name, type) {
  const browser = await type.launch();
  try {
    const { page, errs } = await open(browser, { w: 390, h: 844, scheme: "light", lang: "en" });
    await page.goto(`${BASE}/#/play`);
    await page.locator('[data-testid="mode-liar"]').waitFor({ timeout: 20000 });
    const t0 = Date.now();
    await page.locator('[data-testid="mode-liar"]').click();
    // UI не блокируется, пока Worker строит сетки: самый длинный кадр главного потока за 3 с прогрева (после того как шит
    // выехал: кадр открытия шита одинаково длинный и у Классики, его не считаем).
    await page.waitForTimeout(400);
    const maxFrame = await page.evaluate(
      () =>
        new Promise((res) => {
          let last = performance.now();
          let max = 0;
          const end = last + 3000;
          const tick = (now) => {
            max = Math.max(max, now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else res(Math.round(max));
          };
          requestAnimationFrame(tick);
        }),
    );
    const readPool = () =>
      page.evaluate(
        () =>
          new Promise((res) => {
            const r = indexedDB.open("pundoku");
            r.onsuccess = () => {
              const tx = r.result.transaction("kv", "readonly");
              const st = tx.objectStore("kv");
              const out = {};
              let n = 0;
              for (const d of ["expert", "master"]) {
                const g = st.get(`meta:liarReady:${d}`);
                g.onsuccess = () => {
                  out[d] = !!g.result;
                  if (++n === 2) res(out);
                };
              }
            };
            r.onerror = () => res({});
          }),
      );
    let pool = {};
    while (Date.now() - t0 < 60000) {
      pool = await readPool();
      if (pool.expert && pool.master) break;
      await page.waitForTimeout(250);
    }
    const warmMs = Date.now() - t0;
    ok(`${name}: прогрев кладёт expert и master в IndexedDB`, !!(pool.expert && pool.master), `${warmMs} мс`);
    ok(`${name}: главный поток свободен во время прогрева`, maxFrame < 100, `самый длинный кадр ${maxFrame} мс`);
    await page.locator('[data-testid="difficulty-expert"]').click();
    const pooled = await page.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open("pundoku");
          r.onsuccess = () => {
            const g = r.result.transaction("kv", "readonly").objectStore("kv").get("meta:liarReady:expert");
            g.onsuccess = () => res(g.result?.mission ?? null);
          };
        }),
    );
    const s0 = Date.now();
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator('.board[data-phase="playing"]').waitFor({ timeout: 45000 });
    const startMs = Date.now() - s0;
    const shown = await page.evaluate(() =>
      Array.from({ length: 81 }, (_, i) => {
        const c = document.querySelector(`.board [data-i="${i}"] .d.given`);
        return c ? c.textContent : "0";
      }).join(""),
    );
    ok(`${name}: expert стартует из заготовки (та же сетка, без генерации на старте)`, pooled !== null && shown === pooled, `${startMs} мс до поля`);
    // Заготовка съедена — сразу после старта партии строится следующая.
    let refilled = false;
    const r0 = Date.now();
    while (Date.now() - r0 < 60000) {
      const p2 = await readPool();
      if (p2.expert) {
        refilled = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    ok(`${name}: после старта заготовка expert восполняется`, refilled, `${Date.now() - r0} мс`);
    ok(`${name}: без ошибок страницы (прогрев)`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

for (const [name, type] of [
  ["cr", chromium],
  ["wk", webkit],
]) {
  if (ONLY && ONLY !== name) continue;
  try {
    await prefetch(name, type);
  } catch (e) {
    ok(`${name}: прогрев целиком`, false, String(e?.message ?? e).split("\n")[0]);
  }
  for (const c of CONFIGS) {
    try {
      await flow(name, type, c);
    } catch (e) {
      ok(`${name}-${c.w}-${c.scheme}-${c.lang}: сценарий целиком`, false, String(e?.message ?? e).split("\n")[0]);
    }
  }
}
const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
