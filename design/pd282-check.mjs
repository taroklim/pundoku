/**
 * PD-282 + PD-284 — живая проверка (на основе design/pd275-check.mjs).
 *
 *   cd apps/web && npx vite build --outDir /tmp/pdlow4-dist
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pdlow4-dist PORT=5341 node design/pd282-check.mjs [chromium] [webkit]
 *
 * PD-282: день, открытый из «Продолжить» хаба Play, — «‹ Play» (aria «Back to Play») ведёт обратно в хаб, не в Year; архив по
 * глубокой ссылке (без источника) — по-прежнему «‹ Year» на карточку дня. Телефон и десктоп C (≥ 1100 × 680, сайдбар).
 * PD-284: возврат на Play без записей не перечитывает `days` (счётчик IDBObjectStore.getAll по хранилищу days); после хода в
 * архиве и после решения — перечитывает: строка «Продолжить» сразу верная (на клетку меньше / ушла), устаревших данных нет.
 * Кадры — design/pd282-shots/. Браузеры/сервер закрываются в finally.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const OUT = process.env.OUT ?? path.join(HERE, "pd282-shots");
const PORT = +(process.env.PORT ?? 5341);
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const transpose = (s) => Array.from({ length: 81 }, (_, i) => s[(i % 9) * 9 + Math.floor(i / 9)]).join("");
const MISSION_T = transpose(MISSION);
const DAY7 = "2026-10-07";
const args = process.argv.slice(2);
const browsers = args.length ? args : ["chromium", "webkit"];
fs.mkdirSync(OUT, { recursive: true });
for (let i = 0; i < 81; i++) if (MISSION[i] !== "0" && MISSION[i] !== SOLUTION[i]) throw new Error("SOLUTION не от MISSION");

// [ширина, высота, схема, язык, десктоп C]
const CONFIGS = [
  [393, 852, "light", "en", false],
  [320, 568, "dark", "ru", false],
  [1280, 800, "light", "uk", true],
];
const TITLES = {
  en: { dayPast: "Daily puzzle", date: "7 Oct", play: "Play", year: "Year", backPlay: "Back to Play", backYear: "Back to Year" },
  uk: { dayPast: "Головоломка дня", date: "7 жовт.", play: "Гра", year: "Рік", backPlay: "Назад до гри", backYear: "Назад до року" },
  ru: { dayPast: "Головоломка дня", date: "7 окт.", play: "Игра", year: "Год", backPlay: "Назад к игре", backYear: "Назад к году" },
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


/** Раздел: телефон — таб-бар, десктоп C — сайдбар (Play из сайдбара — всегда хаб). */
async function tab(p, desk, id) {
  await p.locator(desk ? `[data-testid="side-${id}"]` : `#tab-${id}`).click();
  await p.waitForTimeout(700);
}
/** Сколько раз прочитано хранилище `days` целиком (getAll) с загрузки страницы. */
const reads = (p) => p.evaluate(() => window.__daysGetAll ?? 0);

async function run(br, [W, H, scheme, lang, desk]) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-${W}x${H}-${scheme}-${lang}${desk ? "-desk" : ""}`;
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
    await ctx.addInitScript((lang) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
      } catch {
        /* приватный режим */
      }
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...a) {
        if (this.name === "days") window.__daysGetAll = (window.__daysGetAll ?? 0) + 1;
        return getAll.apply(this, a);
      };
    }, lang);
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => {
      if (!/\/api\//.test(e.message)) errs.push(e.message);
    });
    await p.clock.install({ time: new Date("2026-10-07T20:00:00Z") });
    await p.clock.resume();

    // 1. Вечер 7-го: два верных хода в дне Today.
    await p.goto(`http://127.0.0.1:${PORT}/#/today`);
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
    await p.waitForTimeout(700);
    check(`${tag}: десктоп C ${desk ? "включён" : "выключен"}`, (await p.locator(".shell.desk").count()) === (desk ? 1 : 0));
    for (const i of empties.slice(0, 2)) await put(p, PANE, i, +SOLUTION[i]);
    await p.waitForTimeout(500);
    const sig7 = await boardSig(p, PANE);

    // 2. Перезапуск утром 8-го на Play: строка дня 7-го.
    await p.clock.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    await p.goto(`http://127.0.0.1:${PORT}/?r=1#/play`);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 20000 });
    await p.waitForTimeout(900);
    let day = await rowInfo(p, "continue-day");
    check(`${tag}: Play — день 7-го в «Продолжить»`, day?.title === `${T.dayPast} · ${T.date}`, day?.title);

    // 3. PD-284: Play ↔ Year без записей — `days` не перечитывается; Year при этом получает дни (полотно на месте).
    const r0 = await reads(p);
    for (let k = 0; k < 3; k++) {
      await tab(p, desk, "year");
      await tab(p, desk, "play");
    }
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    const r1 = await reads(p);
    check(`${tag}: PD-284 — 3 × Play ↔ Year без записей: getAll(days) не вызывался`, r1 === r0, { r0, r1 });
    day = await rowInfo(p, "continue-day");
    check(`${tag}: PD-284 — строка дня на месте`, day?.title === `${T.dayPast} · ${T.date}` && day.meta.includes(String(empties.length - 2)), day && { t: day.title, m: day.meta });

    // 4. PD-282: тап → архив 7-го; «‹ Play», aria «Back to Play».
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="${DAY7}"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(600);
    check(`${tag}: тап → архив 7-го, та же сетка`, p.url().endsWith(`#/day/${DAY7}`) && (await boardSig(p, ARCH)) === sig7, p.url());
    const back = p.locator('[data-testid="archive-back"]');
    const bi = await back.evaluate((el) => ({ text: el.textContent.trim(), aria: el.getAttribute("aria-label"), vis: el.getBoundingClientRect().width > 0 }));
    check(`${tag}: PD-282 — кнопка «‹ ${T.play}», aria «${T.backPlay}»`, bi.text === T.play && bi.aria === T.backPlay && bi.vis, bi);
    await p.screenshot({ path: path.join(OUT, `${tag}-1-archive-from-play.png`) });
    const third = empties[2];
    await put(p, ARCH, third, +SOLUTION[third]);
    await p.waitForTimeout(500);
    const r2 = await reads(p);
    await back.click();
    await p.waitForTimeout(900);
    check(`${tag}: PD-282 — «‹ ${T.play}» → хаб Play (#/play), не Year, шита дня нет`, p.url().endsWith("#/play") && (await p.locator('[data-testid="year-sheet-root"].is-open').count()) === 0 && (await p.locator(".push-layer").count()) === 0, p.url());
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    await p.waitForTimeout(400);
    day = await rowInfo(p, "continue-day");
    const r3 = await reads(p);
    check(`${tag}: PD-284 — после хода в архиве строка свежая (на клетку меньше), days перечитан`, day?.meta.includes(String(empties.length - 3)) && r3 > r2, { m: day?.meta, r2, r3 });
    const sel = await p.evaluate(() => document.querySelector(".tabbar [aria-selected=true]")?.id ?? document.querySelector('.side-it[aria-current="page"]')?.getAttribute("data-testid"));
    check(`${tag}: в хабе выбран раздел Play`, sel === "tab-play" || sel === "side-play", sel);
    await p.screenshot({ path: path.join(OUT, `${tag}-2-back-to-play.png`) });

    // 5. Архив по глубокой ссылке (источника нет) — «‹ Year» на карточку дня, как раньше.
    await p.goto(`http://127.0.0.1:${PORT}/?r=2#/day/${DAY7}`);
    await p.waitForSelector(`${ARCH}[data-date="${DAY7}"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(600);
    const by = await back.evaluate((el) => ({ text: el.textContent.trim(), aria: el.getAttribute("aria-label") }));
    check(`${tag}: глубокая ссылка — «‹ ${T.year}», aria «${T.backYear}»`, by.text === T.year && by.aria === T.backYear, by);
    await back.click();
    await p.waitForTimeout(900);
    check(`${tag}: глубокая ссылка — «‹ ${T.year}» → Year, шит карточки дня`, /#\/year/.test(p.url()) && (await p.locator('[data-testid="year-sheet-root"].is-open').count()) === 1, p.url());
    const done = p.locator('[data-testid="year-sheet-root"].is-open .done');
    if ((await done.count()) > 0) {
      await done.click();
      await p.waitForTimeout(700);
    }

    // 6. Доиграть 7-е из «Продолжить» → «‹ Play»: строки дня нет (кэш сброшен записью решения).
    await tab(p, desk, "play");
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="${DAY7}"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(500);
    for (const i of empties.slice(3)) await put(p, ARCH, i, +SOLUTION[i]);
    await p.locator(`${ARCH} [data-testid="result-card"]`).waitFor({ timeout: 20000 });
    await p.waitForTimeout(600);
    await back.click();
    await p.waitForTimeout(600);
    check(`${tag}: после решения «‹ ${T.play}» → #/play`, p.url().endsWith("#/play"), p.url());
    const t0 = Date.now();
    const gone = await p
      .locator('[data-testid="continue-day"]')
      .waitFor({ state: "detached", timeout: 5000 })
      .then(() => true, () => false);
    check(`${tag}: PD-284 — решённый 7-й из «Продолжить» ушёл`, gone, `${Date.now() - t0} ms`);
    await p.screenshot({ path: path.join(OUT, `${tag}-3-solved-gone.png`) });
    // Year видит решённый 7-й (не устаревший список): клетка 7 октября окрашена/помечена решённой.
    await tab(p, desk, "year");
    await p.waitForTimeout(500);
    const y7 = await p.evaluate((d) => {
      const el = document.querySelector(`.tab-pane:not(.off) [data-date="${d}"]`);
      return el ? { cls: el.className, aria: el.getAttribute("aria-label"), state: el.getAttribute("data-state") } : null;
    }, DAY7);
    check(`${tag}: Year — 7-е уже не «в процессе» (свежие days)`, !!y7 && !/progress|started|unfinished|начат|почат/i.test(`${y7.cls} ${y7.aria} ${y7.state}`), y7);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
try {
  for (const br of browsers) {
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
