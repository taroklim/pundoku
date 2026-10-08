/**
 * PD-262 — живая проверка: игра дня не за сегодня в «Продолжить» хаба Play подписана датой («Liar of the day · 7 Oct»).
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd262-dist
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd262-dist node design/pd262-check.mjs [chromium] [webkit]
 *
 * Сценарий на каждый набор (часы браузера подменены: `clock.install` на 2026-10-07 23:57 UTC, timezoneId UTC, дальше идут сами):
 *  1. Today — один ход в сетке дня (API дня — заглушка этого же сервера); Play → «Лжец» → «Лжец дня» — один ход; повторный тап
 *     по вкладке Play → хаб. Обе строки «Продолжить» БЕЗ даты (сегодня). Кадр *-1-today.
 *  2. Часы через полночь (`clock.fastForward`, хаб открыт, без перезагрузки): обе строки С датой 7-го — таймер полуночи
 *     useLocalDate. Кадр *-2-midnight.
 *  3. Перезагрузка утром 8-го: Лжец дня (из IndexedDB) — с датой; строки дня Today нет (после перезапуска хаб читает только
 *     сегодняшний день — поведение до PD-262). Кадр *-3-reload.
 * Проверки: текст заголовков, доступное имя кнопки (ariaSnapshot) содержит дату, строка не вылезает по ширине (scrollWidth),
 * дата не разорвана переносом (одна строка у «7 Oct»). Кадры строки — design/pd262-shots/. Браузеры/сервер закрываются в finally.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const OUT = process.env.OUT ?? path.join(HERE, "pd262-shots");
const PORT = +(process.env.PORT ?? 5262);
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const args = process.argv.slice(2);
const browsers = args.length ? args : ["chromium", "webkit"];
fs.mkdirSync(OUT, { recursive: true });

// [ширина, высота, схема, язык, AX3]
const CONFIGS = [
  [320, 568, "light", "en", true],
  [320, 568, "dark", "ru", true],
  [320, 568, "light", "uk", true],
  [393, 852, "light", "en", false],
  [393, 852, "dark", "ru", false],
  [393, 852, "dark", "uk", false],
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
    return r.end(JSON.stringify({ date: m[1], mission: MISSION, difficulty: "medium", source: "sudoku.com", winRate: 71 }));
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

const pane = ".tab-pane:not(.off)";
/** Один ход в открытой сетке: первая пустая клетка, цифра 1 с панели (неверная — тоже прогресс). */
async function oneMove(p) {
  const i = await p.evaluate((pane) => {
    for (const c of document.querySelectorAll(`${pane} .board button.cell`)) if (!c.querySelector(".given") && !c.textContent.trim()) return c.getAttribute("data-i");
    return null;
  }, pane);
  await p.locator(`${pane} .board button.cell[data-i="${i}"]`).click();
  await p.locator(`${pane} .pad .key`).nth(0).click();
  await p.waitForTimeout(400);
}

/** Заголовок, доступное имя и геометрия строки «Продолжить». */
async function rowInfo(p, id) {
  const loc = p.locator(`[data-testid="${id}"]`);
  if ((await loc.count()) === 0) return null;
  const geo = await loc.evaluate((el) => {
    const b = el.querySelector(".l1 b");
    const date = [...b.childNodes].map((n) => n.textContent).join("");
    // Строки текста заголовка: уникальные top у прямоугольников символов последних 6 знаков (дата) — одна строка = не разорвана.
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
    const lineH = parseFloat(getComputedStyle(b).lineHeight) || parseFloat(getComputedStyle(b).fontSize) * 1.2;
    return {
      title: date.replace(/\u00a0/g, " "),
      titleLines: Math.round(b.getBoundingClientRect().height / lineH),
      dateLines,
      overflow: el.scrollWidth - el.clientWidth,
      bOverflow: b.scrollWidth - b.clientWidth,
      rowRight: Math.round(el.getBoundingClientRect().right),
      vw: document.documentElement.clientWidth,
      ax3: document.documentElement.getAttribute("data-type"),
    };
  });
  const aria = await loc.ariaSnapshot();
  return { ...geo, aria: aria.replace(/\u00a0/g, " ") };
}

/** Кадр секции «Продолжить»; при AX3 она выше экрана (таб-бар перекрыл бы низ) — тогда каждая строка отдельно, по центру экрана. */
async function shotRows(p, file, ax3) {
  const sec = p.locator('[data-testid="hub-continue"]');
  if ((await sec.count()) === 0) return;
  if (!ax3) return sec.screenshot({ path: path.join(OUT, file) });
  for (const [id, suffix] of [["continue-day", "day"], ["continue-liar-day", "liar"]]) {
    const row = p.locator(`[data-testid="${id}"]`);
    if ((await row.count()) === 0) continue;
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await p.waitForTimeout(250);
    await row.screenshot({ path: path.join(OUT, file.replace(/\.png$/, `-${suffix}.png`)) });
  }
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
    // WebKit отдаёт оборванный навигацией запрос синхронизации к заглушке API («/api/devices … access control checks») как
    // pageerror — шум стенда (API тут нет), как фильтр /api/ в прежних скриптах QA; всё остальное — FAIL.
    p.on("pageerror", (e) => {
      if (!/\/api\//.test(e.message)) errs.push(e.message);
    });
    await p.clock.install({ time: new Date("2026-10-07T23:57:00Z") });
    await p.clock.resume();

    // 1. Сегодня (7-е): ход в дне Today и в Лжеце дня → хаб.
    await p.goto(`http://127.0.0.1:${PORT}/#/today`);
    await p.waitForSelector(`${pane} .board button.cell`, { timeout: 40000 });
    await p.waitForTimeout(700);
    await oneMove(p);
    await p.goto(`http://127.0.0.1:${PORT}/#/play`);
    await p.locator('[data-testid="mode-liar"]').waitFor({ timeout: 20000 });
    await p.locator('[data-testid="mode-liar"]').click();
    await p.locator('[data-testid="liar-daily"]').click();
    await p.waitForSelector(`${pane} .board[data-phase="playing"]`, { timeout: 45000 });
    await p.waitForTimeout(500);
    await oneMove(p);
    await p.locator("#tab-play").click();
    await p.waitForTimeout(800);
    await p.locator('[data-testid="continue-liar-day"]').waitFor({ timeout: 10000 });
    await p.waitForTimeout(500);
    let liar = await rowInfo(p, "continue-liar-day");
    let day = await rowInfo(p, "continue-day");
    check(`${tag}: 23:5x — Лжец дня без даты`, liar?.title === T.liar, liar);
    check(`${tag}: 23:5x — день Today без даты`, day?.title === T.day, day);
    if (ax3) check(`${tag}: AX3 включён`, liar?.ax3 === "ax3", liar?.ax3);
    await shotRows(p, `${tag}-1-today.png`, ax3);

    // 2. Полночь на открытом хабе (без перезагрузки).
    await p.clock.fastForward("04:00");
    await p.waitForTimeout(600);
    liar = await rowInfo(p, "continue-liar-day");
    day = await rowInfo(p, "continue-day");
    check(`${tag}: после полуночи — Лжец дня с датой`, liar?.title === `${T.liar} · ${T.date}`, liar?.title);
    check(`${tag}: после полуночи — день Today с датой`, day?.title === `${T.dayPast} · ${T.date}`, day?.title);
    check(`${tag}: VoiceOver-имя Лжеца содержит дату`, !!liar?.aria.includes(`${T.liar} · ${T.date}`), liar?.aria);
    check(`${tag}: VoiceOver-имя дня содержит дату`, !!day?.aria.includes(`${T.dayPast} · ${T.date}`), day?.aria);
    for (const [n, r] of [["Лжец", liar], ["день", day]]) {
      check(`${tag}: строка «${n}» не шире экрана, заголовок не обрезан`, r && r.overflow <= 0 && r.bOverflow <= 0 && r.rowRight <= r.vw, r && { overflow: r.overflow, bOverflow: r.bOverflow, right: r.rowRight, vw: r.vw });
      check(`${tag}: дата «${n}» на одной строке`, r?.dateLines === 1, r && { dateLines: r.dateLines, titleLines: r.titleLines });
    }
    await shotRows(p, `${tag}-2-midnight.png`, ax3);

    // 3. Перезапуск утром 8-го.
    await p.clock.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    await p.goto(`http://127.0.0.1:${PORT}/?r=1#/play`);
    await p.locator('[data-testid="continue-liar-day"]').waitFor({ timeout: 20000 });
    await p.waitForTimeout(700);
    liar = await rowInfo(p, "continue-liar-day");
    check(`${tag}: перезапуск 8-го — Лжец дня 7-го с датой`, liar?.title === `${T.liar} · ${T.date}`, liar?.title);
    await p.screenshot({ path: path.join(OUT, `${tag}-3-reload-full.png`) });
    await shotRows(p, `${tag}-3-reload.png`, ax3);
    // Тап открывает именно Лжеца 7-го (PD-217) — подпись даты не сломала переход.
    await p.locator('[data-testid="continue-liar-day"]').click();
    await p.waitForSelector(`${pane} .board[data-phase="playing"]`, { timeout: 20000 });
    check(`${tag}: тап открывает партию`, true);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
try {
  for (const br of browsers) {
    for (const c of CONFIGS) {
      try {
        await run(br, c);
      } catch (e) {
        check(`${br}-${c.join("-")}: сценарий целиком`, false, String(e?.message ?? e).split("\n")[0]);
      }
    }
  }
} finally {
  server.close();
}
console.log(`\n${total - fails.length}/${total} PASS`);
process.exit(fails.length ? 1 : 0);
