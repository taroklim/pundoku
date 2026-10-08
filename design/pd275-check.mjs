/**
 * PD-275 — живая проверка: вчерашний незаконченный день Today не пропадает из «Продолжить» хаба Play после перезапуска
 * (как вчерашний Лжец дня, PD-217), подписан датой (PD-262) и открывает ту же сетку с теми же ходами.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd275-dist
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd275-dist PORT=5331 node design/pd275-check.mjs [chromium] [webkit]
 *   (ONLY=<индекс набора> — один набор из CONFIGS, для отладки)
 *
 * Часы браузера подменены (`clock.install`, timezoneId UTC). API дня — заглушка этого же сервера: 7-го — классическая сетка
 * MISSION, любой другой даты — её транспонированная (другая сетка, чтобы «та же сетка» проверялась по-настоящему).
 * Сценарий на каждый набор:
 *  1. Вечер 7-го: два верных хода в сетке дня на Today, ход в Лжеце дня; хаб — обе строки без даты.
 *  2. Перезапуск утром 8-го сразу на Play (стор Today не загружен): «Daily puzzle · 7 Oct» и «Liar of the day · 7 Oct»;
 *     доступное имя с датой, строка не шире экрана, дата на одной строке (AX3). Кадр *-2-restart-play.
 *  3. Перезапуск на Today (вкладка по умолчанию): Today — сетка 8-го, нетронутая; Play → строка дня 7-го с датой (главный путь
 *     бага: стор Today уже на сегодняшнем). Кадр *-3-restart-today.
 *  4. Тап → архив 7-го: та же сетка, те же два хода; ход проходит. «‹ Year» → Play: строка осталась, клеток на одну меньше.
 *  5. Снова тап → доиграть до карточки результата; «‹ Year» → Play: строки дня нет, Лжец дня 7-го на месте и открывается;
 *     Today — по-прежнему сетка 8-го без ходов.
 * Кадры — design/pd275-shots/. Браузеры/сервер закрываются в finally.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const OUT = process.env.OUT ?? path.join(HERE, "pd275-shots");
const PORT = +(process.env.PORT ?? 5331);
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const transpose = (s) => Array.from({ length: 81 }, (_, i) => s[(i % 9) * 9 + Math.floor(i / 9)]).join("");
const MISSION_T = transpose(MISSION);
const DAY7 = "2026-10-07";
const args = process.argv.slice(2);
const browsers = args.length ? args : ["chromium", "webkit"];
fs.mkdirSync(OUT, { recursive: true });
for (let i = 0; i < 81; i++) if (MISSION[i] !== "0" && MISSION[i] !== SOLUTION[i]) throw new Error("SOLUTION не от MISSION");

// [ширина, высота, схема, язык, AX3]
const CONFIGS = [
  [320, 568, "light", "en", true],
  [320, 568, "dark", "ru", true],
  [393, 852, "light", "uk", false],
  [393, 852, "dark", "en", false],
];
const TITLES = {
  en: { liar: "Liar of the day", day: "Today’s puzzle", dayPast: "Daily puzzle", date: "7 Oct" },
  uk: { liar: "Брехун дня", day: "Головоломка дня", dayPast: "Головоломка дня", date: "7 жовт." },
  ru: { liar: "Лжец дня", day: "Головоломка дня", dayPast: "Головоломка дня", date: "7 окт." },
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return r.end(JSON.stringify({ date: m[1], mission: m[1] === DAY7 ? MISSION : MISSION_T, difficulty: "medium", source: "sudoku.com", winRate: 71 }));
  }
  if (u.startsWith("/api/")) {
    r.writeHead(503);
    return r.end();
  }
  let f = path.join(DIST, u);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
});

const fails = [];
let total = 0;
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, typeof detail === "string" ? detail : JSON.stringify(detail));
};

const PANE = ".tab-pane:not(.off)";
const ARCH = '.push-layer [data-testid="archive-screen"]';
const empties = [...MISSION].flatMap((g, i) => (g === "0" ? [i] : []));

/** Цифра в клетку: тап по клетке, затем по клавише панели. */
async function put(p, root, i, d) {
  await p.locator(`${root} .board button.cell[data-i="${i}"]`).click();
  await p.locator(`${root} .pad .key`).nth(d - 1).click();
}
/** Поле как строка: цифра клетки или «0» (заметок в сценарии нет). */
async function boardSig(p, root) {
  return p.evaluate((root) => {
    const cells = [...document.querySelectorAll(`${root} .board button.cell`)].sort((a, b) => +a.dataset.i - +b.dataset.i);
    return cells.map((c) => (c.textContent.trim().match(/^[1-9]$/) ? c.textContent.trim() : "0")).join("");
  }, root);
}
/** Только подсказки поля (цифры с `.given`). */
async function givensSig(p, root) {
  return p.evaluate((root) => {
    const cells = [...document.querySelectorAll(`${root} .board button.cell`)].sort((a, b) => +a.dataset.i - +b.dataset.i);
    return cells.map((c) => c.querySelector(".given")?.textContent.trim() || "0").join("");
  }, root);
}

/** Заголовок, подпись, доступное имя и геометрия строки «Продолжить». */
async function rowInfo(p, id) {
  const loc = p.locator(`[data-testid="${id}"]`);
  if ((await loc.count()) === 0) return null;
  const geo = await loc.evaluate((el) => {
    const b = el.querySelector(".l1 b");
    const range = document.createRange();
    const text = b.lastChild;
    let dateLines = 0;
    if (text && text.nodeType === 3 && text.length >= 6) {
      const tops = new Set();
      for (let k = text.length - 6; k < text.length; k++) {
        range.setStart(text, k);
        range.setEnd(text, k + 1);
        const r = range.getBoundingClientRect();
        if (r.width > 0) tops.add(Math.round(r.top));
      }
      dateLines = tops.size;
    }
    return {
      title: b.textContent.replace(/ /g, " "),
      meta: el.querySelector(".l2")?.textContent ?? "",
      dateLines,
      overflow: el.scrollWidth - el.clientWidth,
      bOverflow: b.scrollWidth - b.clientWidth,
      rowRight: Math.round(el.getBoundingClientRect().right),
      vw: document.documentElement.clientWidth,
      ax3: document.documentElement.getAttribute("data-type"),
    };
  });
  const aria = await loc.ariaSnapshot();
  return { ...geo, aria: aria.replace(/ /g, " ") };
}

async function shotRow(p, id, file) {
  const row = p.locator(`[data-testid="${id}"]`);
  if ((await row.count()) === 0) return;
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(250);
  await row.screenshot({ path: path.join(OUT, file) });
}

async function toHub(p) {
  // «‹ Year» из архива ведёт на карточку дня в Year (шит поверх таб-бара) — закрыть «Done», как пользователь.
  const sheet = p.locator('[data-testid="year-sheet-root"].is-open .done');
  if ((await sheet.count()) > 0) {
    await sheet.click();
    await p.waitForTimeout(700);
  }
  await p.locator("#tab-play").click();
  await p.waitForTimeout(700);
}

async function run(br, [W, H, scheme, lang, ax3]) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-${W}-${scheme}-${lang}${ax3 ? "-ax3" : ""}`;
  const T = TITLES[lang];
  const browser = await pw[br].launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 2,
      locale: { en: "en-US", uk: "uk-UA", ru: "ru-RU" }[lang],
      timezoneId: "UTC",
      colorScheme: scheme,
      serviceWorkers: "block",
    });
    await ctx.addInitScript(
      ({ lang, ax3 }) => {
        try {
          localStorage.setItem("pundoku.locale", lang);
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
      { lang, ax3 },
    );
    const p = await ctx.newPage();
    const errs = [];
    // Оборванные навигацией запросы синхронизации к заглушке API (WebKit: «/api/… access control checks») — шум стенда.
    p.on("pageerror", (e) => {
      if (!/\/api\//.test(e.message)) errs.push(e.message);
    });
    await p.clock.install({ time: new Date("2026-10-07T20:00:00Z") });
    await p.clock.resume();

    // 1. Вечер 7-го: два верных хода в дне Today, ход в Лжеце дня.
    await p.goto(`http://127.0.0.1:${PORT}/#/today`);
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
    await p.waitForTimeout(700);
    check(`${tag}: 7-е — на Today сетка 7-го`, (await givensSig(p, PANE)) === MISSION);
    for (const i of empties.slice(0, 2)) await put(p, PANE, i, +SOLUTION[i]);
    await p.waitForTimeout(500);
    const sig7 = await boardSig(p, PANE);
    check(`${tag}: 7-е — два хода на поле`, [...sig7].filter((d, i) => d !== MISSION[i]).length === 2, sig7);
    await p.goto(`http://127.0.0.1:${PORT}/#/play`);
    await p.locator('[data-testid="mode-liar"]').waitFor({ timeout: 20000 });
    await p.locator('[data-testid="mode-liar"]').click();
    await p.locator('[data-testid="liar-daily"]').click();
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 60000 });
    await p.waitForTimeout(500);
    const li = await p.evaluate((pane) => {
      for (const c of document.querySelectorAll(`${pane} .board button.cell`)) if (!c.querySelector(".given") && !c.textContent.trim()) return +c.dataset.i;
      return null;
    }, PANE);
    await put(p, PANE, li, 1);
    await p.waitForTimeout(400);
    await toHub(p);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    let day = await rowInfo(p, "continue-day");
    let liar = await rowInfo(p, "continue-liar-day");
    check(`${tag}: 7-е — день Today без даты`, day?.title === T.day, day?.title);
    check(`${tag}: 7-е — Лжец дня без даты`, liar?.title === T.liar, liar?.title);
    if (ax3) check(`${tag}: AX3 включён`, day?.ax3 === "ax3", day?.ax3);

    // 2. Перезапуск утром 8-го сразу на Play.
    await p.clock.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    await p.goto(`http://127.0.0.1:${PORT}/?r=1#/play`);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 20000 });
    await p.waitForTimeout(700);
    day = await rowInfo(p, "continue-day");
    liar = await rowInfo(p, "continue-liar-day");
    check(`${tag}: перезапуск на Play — день 7-го в «Продолжить» с датой`, day?.title === `${T.dayPast} · ${T.date}`, day?.title);
    check(`${tag}: перезапуск на Play — Лжец дня 7-го с датой (PD-217/262 не сломаны)`, liar?.title === `${T.liar} · ${T.date}`, liar?.title);
    check(`${tag}: VoiceOver-имя строки дня содержит дату`, !!day?.aria.includes(`${T.dayPast} · ${T.date}`), day?.aria);
    check(`${tag}: строка дня не шире экрана`, day && day.overflow <= 0 && day.bOverflow <= 0 && day.rowRight <= day.vw, day && { o: day.overflow, b: day.bOverflow, r: day.rowRight, vw: day.vw });
    check(`${tag}: дата строки дня на одной строке`, day?.dateLines === 1, day?.dateLines);
    check(`${tag}: подпись — осталось клеток после двух ходов`, !!day?.meta.includes(String(empties.length - 2)), day?.meta);
    await shotRow(p, "continue-day", `${tag}-2-restart-play.png`);

    // 3. Перезапуск на Today (вкладка по умолчанию): стор Today уже на 8-м — главный путь бага.
    await p.goto(`http://127.0.0.1:${PORT}/?r=2#/today`);
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
    await p.waitForTimeout(600);
    check(`${tag}: Today после перезапуска — сетка 8-го, без ходов`, (await boardSig(p, PANE)) === MISSION_T);
    await toHub(p);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    day = await rowInfo(p, "continue-day");
    check(`${tag}: перезапуск на Today → Play — день 7-го с датой`, day?.title === `${T.dayPast} · ${T.date}`, day?.title);
    await shotRow(p, "continue-day", `${tag}-3-restart-today.png`);
    await p.screenshot({ path: path.join(OUT, `${tag}-3-hub-full.png`) });

    // 4. Тап → архив 7-го: та же сетка, те же ходы, играется.
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="${DAY7}"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(600);
    check(`${tag}: тап → архив 7-го (#/day/${DAY7})`, p.url().endsWith(`#/day/${DAY7}`), p.url());
    check(`${tag}: та же сетка и те же два хода`, (await boardSig(p, ARCH)) === sig7);
    await p.screenshot({ path: path.join(OUT, `${tag}-4-archive.png`) });
    const third = empties[2];
    await put(p, ARCH, third, +SOLUTION[third]);
    await p.waitForTimeout(500);
    check(`${tag}: ход в архиве проходит`, (await boardSig(p, ARCH))[third] === SOLUTION[third]);
    await p.locator('[data-testid="archive-back"]').click();
    await p.waitForTimeout(900);
    // Year открывает карточку дня и снимает дату с адреса (#/year/<дата> → #/year): проверяем сам шит.
    check(`${tag}: «‹ Year» из архива — вкладка Year, шит карточки дня`, /#\/year/.test(p.url()) && (await p.locator('[data-testid="year-sheet-root"].is-open').count()) === 1, p.url());
    await p.screenshot({ path: path.join(OUT, `${tag}-4b-back-year.png`) });
    await toHub(p);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    day = await rowInfo(p, "continue-day");
    check(`${tag}: после хода в архиве — строка на месте, клеток на одну меньше`, day?.title === `${T.dayPast} · ${T.date}` && day.meta.includes(String(empties.length - 3)), day && { t: day.title, m: day.meta });

    // 5. Доиграть 7-е до карточки; строка дня уходит, Лжец остаётся; Today не тронут.
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="${DAY7}"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(500);
    for (const i of empties.slice(3)) await put(p, ARCH, i, +SOLUTION[i]);
    await p.locator(`${ARCH} [data-testid="result-card"]`).waitFor({ timeout: 20000 });
    check(`${tag}: 7-е доиграно — карточка результата`, true);
    await p.waitForTimeout(600);
    await p.locator('[data-testid="archive-back"]').click();
    await p.waitForTimeout(600);
    await toHub(p);
    await p.locator('[data-testid="continue-liar-day"]').waitFor({ timeout: 10000 });
    await p.waitForTimeout(500);
    check(`${tag}: решённый 7-й из «Продолжить» ушёл`, (await p.locator('[data-testid="continue-day"]').count()) === 0);
    liar = await rowInfo(p, "continue-liar-day");
    check(`${tag}: Лжец дня 7-го на месте с датой`, liar?.title === `${T.liar} · ${T.date}`, liar?.title);
    await p.locator('[data-testid="continue-liar-day"]').click();
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 30000 });
    check(`${tag}: Лжец дня 7-го открывается`, true);
    await p.locator("#tab-today").click();
    await p.waitForTimeout(700);
    check(`${tag}: Today — по-прежнему сетка 8-го без ходов`, (await boardSig(p, PANE)) === MISSION_T);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
try {
  for (const br of browsers) {
    // ONLY=<индекс> — один набор (отладка скрипта без всей матрицы).
    for (const c of process.env.ONLY !== undefined ? [CONFIGS[+process.env.ONLY]] : CONFIGS) {
      try {
        await run(br, c);
      } catch (e) {
        check(`${br}-${c.join("-")}: сценарий целиком`, false, String(e?.message ?? e).split("\n").slice(0, 12).join(" | "));
      }
    }
  }
} finally {
  server.close();
}
console.log(`\n${total - fails.length}/${total} PASS`);
process.exit(fails.length ? 1 : 0);
