/**
 * PD-279 (QA PD-275) — дополнительные сценарии, не покрытые design/pd275-check.mjs.
 *   DIST=/tmp/qa279-dist PORT=5362 PD_PW_HOME=<playwright> node design/qa279-extra.mjs [chromium] [webkit]   (ONLY=X|Y|Z|G|R)
 * X — другой год (31.12.2025 → 01.01.2026), en/uk/ru, 320 AX3 dark ru: подпись с годом, одна строка, архив той же сетки.
 * Y — два незаконченных прошлых дня (5-е, 7-е) + сегодняшний: порядок (сегодня > самый поздний прошлый), тап по сегодняшнему —
 *     Today; 7-е решено в архиве → запись late, Year-шит; сегодня решено → строка 5-го, архив 5-го с тем же полем.
 * Z — полночь на открытом приложении (без перезапуска): строка «· 7 Oct», тап → вкладка Today (стор держит 7-е); решить 7-е на
 *     Today → перезапуск 8-го → строки дня нет.
 * G — давно брошенный день (1 сентября) всплывает на 8 октября: «· 1 Sep», архив открывает ту же сетку.
 * R — перезапуск: начатый сегодня день (без прошлых) — строка без даты, открывает Today; Grid-ориентир (регресс PD-144).
 * T — запись «из будущего» (часы назад / пояс на запад): PD-283 — строки дня в «Продолжить» нет.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? "/tmp/qa279-dist");
const OUT = process.env.OUT ?? path.join(HERE, "qa279-shots");
const PORT = +(process.env.PORT ?? 5362);
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const transpose = (s) => Array.from({ length: 81 }, (_, i) => s[(i % 9) * 9 + Math.floor(i / 9)]).join("");
const MT = transpose(MISSION);
const ST = transpose(SOLUTION);
// Сетка по дате: 7-е и 31.12.2025 — MISSION, остальные — транспонированная.
const A_DAYS = new Set(["2026-10-07", "2025-12-31", "2026-09-01"]);
const missionOf = (d) => (A_DAYS.has(d) ? MISSION : MT);
const solutionOf = (d) => (A_DAYS.has(d) ? SOLUTION : ST);
const emptiesOf = (m) => [...m].flatMap((g, i) => (g === "0" ? [i] : []));
const args = process.argv.slice(2);
const browsers = args.length ? args : ["chromium", "webkit"];
fs.mkdirSync(OUT, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return r.end(JSON.stringify({ date: m[1], mission: missionOf(m[1]), difficulty: "medium", source: "sudoku.com", winRate: 71 }));
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
const URL0 = `http://127.0.0.1:${PORT}`;
let reloadN = 0;

async function put(p, root, i, d) {
  await p.locator(`${root} .board button.cell[data-i="${i}"]`).click();
  await p.locator(`${root} .pad .key`).nth(d - 1).click();
}
async function boardSig(p, root) {
  return p.evaluate((root) => {
    const cells = [...document.querySelectorAll(`${root} .board button.cell`)].sort((a, b) => +a.dataset.i - +b.dataset.i);
    return cells.map((c) => (c.textContent.trim().match(/^[1-9]$/) ? c.textContent.trim() : "0")).join("");
  }, root);
}
async function rowInfo(p, id) {
  const loc = p.locator(`[data-testid="${id}"]`);
  if ((await loc.count()) === 0) return null;
  const geo = await loc.evaluate((el) => {
    const b = el.querySelector(".l1 b");
    const text = b.lastChild;
    const range = document.createRange();
    const tops = new Set();
    if (text && text.nodeType === 3) {
      // хвост: вся дата (до 12 символов) — на одной строке
      const n = Math.min(12, text.length);
      for (let k = text.length - n; k < text.length; k++) {
        range.setStart(text, k);
        range.setEnd(text, k + 1);
        const r = range.getBoundingClientRect();
        if (r.width > 0) tops.add(Math.round(r.top));
      }
    }
    return { title: b.textContent.replace(/ /g, " "), meta: el.querySelector(".l2")?.textContent ?? "", dateLines: tops.size, overflow: el.scrollWidth - el.clientWidth, bOverflow: b.scrollWidth - b.clientWidth, rowRight: Math.round(el.getBoundingClientRect().right), vw: document.documentElement.clientWidth };
  });
  return geo;
}
async function dayRecord(p, date) {
  return p.evaluate(
    (date) =>
      new Promise((ok) => {
        const req = indexedDB.open("pundoku");
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction("days", "readonly").objectStore("days").get(date);
          g.onsuccess = () => {
            const r = g.result;
            ok(r ? { solved: r.solved, late: r.late, moves: r.play?.log?.length, elapsedMs: r.elapsedMs } : null);
            db.close();
          };
          g.onerror = () => ok("err");
        };
        req.onerror = () => ok("err");
      }),
    date,
  );
}
async function closeSheet(p) {
  const sheet = p.locator('[data-testid="year-sheet-root"].is-open .done');
  if ((await sheet.count()) > 0) {
    await sheet.click();
    await p.waitForTimeout(700);
  }
}
async function toHub(p) {
  await closeSheet(p);
  await p.locator("#tab-play").click();
  await p.waitForTimeout(800);
}
async function setNow(p, iso) {
  await p.clock.setSystemTime(new Date(iso));
}
async function openToday(p, iso) {
  await setNow(p, iso);
  await p.goto(`${URL0}/?r=${++reloadN}#/today`);
  await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
  await p.waitForTimeout(600);
}
async function openPlay(p, iso) {
  if (iso) await setNow(p, iso);
  await p.goto(`${URL0}/?r=${++reloadN}#/play`);
  await p.locator('[data-testid="mode-liar"]').waitFor({ timeout: 20000 });
  await p.waitForTimeout(1200); // чтение хранилища
}
async function shot(p, id, file) {
  const row = p.locator(`[data-testid="${id}"]`);
  if ((await row.count()) === 0) return p.screenshot({ path: path.join(OUT, file) });
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(200);
  await row.screenshot({ path: path.join(OUT, file) });
}
async function solveAll(p, root, date, skip = 0) {
  const m = missionOf(date);
  const s = solutionOf(date);
  const sig = await boardSig(p, root);
  for (const i of emptiesOf(m)) if (sig[i] === "0") await put(p, root, i, +s[i]);
  await p.locator(`${root} [data-testid="result-card"]`).waitFor({ timeout: 20000 });
}

async function newPage(br, { W = 393, H = 852, scheme = "light", lang = "en", ax3 = false, start }) {
  const browser = await pw[br].launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: { en: "en-US", uk: "uk-UA", ru: "ru-RU" }[lang], timezoneId: "UTC", colorScheme: scheme, serviceWorkers: "block" });
  await ctx.addInitScript(
    ({ lang, ax3 }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
      } catch {}
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
  p.on("pageerror", (e) => {
    if (!/\/api\//.test(e.message)) errs.push(e.message);
  });
  await p.clock.install({ time: new Date(start) });
  await p.clock.resume();
  return { browser, p, errs };
}

// X — другой год
const XL = {
  en: { past: "Daily puzzle", date: "31 Dec 2025" },
  uk: { past: "Головоломка дня", date: "31 груд. 2025" },
  ru: { past: "Головоломка дня", date: "31 дек. 2025" },
};
async function runX(br, cfg) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-X-${cfg.W}-${cfg.scheme}-${cfg.lang}${cfg.ax3 ? "-ax3" : ""}`;
  const { browser, p, errs } = await newPage(br, { ...cfg, start: "2025-12-31T20:00:00Z" });
  try {
    await openToday(p, "2025-12-31T20:00:00Z");
    const e = emptiesOf(MISSION);
    await put(p, PANE, e[0], +SOLUTION[e[0]]);
    await p.waitForTimeout(500);
    const sig = await boardSig(p, PANE);
    await openPlay(p, "2026-01-01T09:00:00Z");
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    const d = await rowInfo(p, "continue-day");
    const want = `${XL[cfg.lang].past} · ${XL[cfg.lang].date}`;
    check(`${tag}: другой год — «${want}»`, d?.title === want, d?.title);
    check(`${tag}: строка не шире экрана`, d && d.overflow <= 0 && d.bOverflow <= 0 && d.rowRight <= d.vw, d && { o: d.overflow, b: d.bOverflow, r: d.rowRight });
    check(`${tag}: дата с годом на одной строке`, d?.dateLines === 1, d?.dateLines);
    await shot(p, "continue-day", `${tag}-row.png`);
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="2025-12-31"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(500);
    check(`${tag}: архив 31.12.2025 — та же сетка с ходом`, (await boardSig(p, ARCH)) === sig);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

// Y — два прошлых + сегодняшний
async function runY(br) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-Y-393-light-en`;
  const { browser, p, errs } = await newPage(br, { start: "2026-10-05T20:00:00Z" });
  try {
    await openToday(p, "2026-10-05T20:00:00Z");
    check(`${tag}: 5-е — сетка 5-го`, (await boardSig(p, PANE)) === MT);
    const e5 = emptiesOf(MT);
    await put(p, PANE, e5[0], +ST[e5[0]]);
    await p.waitForTimeout(500);
    const sig5 = await boardSig(p, PANE);
    await openToday(p, "2026-10-07T20:00:00Z");
    check(`${tag}: 7-е — сетка 7-го`, (await boardSig(p, PANE)) === MISSION);
    const e7 = emptiesOf(MISSION);
    for (const i of e7.slice(0, 2)) await put(p, PANE, i, +SOLUTION[i]);
    await p.waitForTimeout(500);
    // 8-е: Today открыт, но не тронут → строка самого позднего прошлого (7-е), не 5-е
    await openToday(p, "2026-10-08T09:00:00Z");
    await toHub(p);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    let d = await rowInfo(p, "continue-day");
    check(`${tag}: два незаконченных прошлых — показан самый поздний (7 Oct)`, d?.title === "Daily puzzle · 7 Oct", d?.title);
    check(`${tag}: подпись 7-го — 49 клеток`, d?.meta.includes(String(e7.length - 2)), d?.meta);
    await shot(p, "continue-day", `${tag}-1-latest-past.png`);
    // ход в сегодняшнем → строка сегодняшнего, без даты
    await p.locator("#tab-today").click();
    await p.waitForTimeout(700);
    const e8 = emptiesOf(MT);
    await put(p, PANE, e8[0], +ST[e8[0]]);
    await p.waitForTimeout(500);
    await toHub(p);
    d = await rowInfo(p, "continue-day");
    check(`${tag}: сегодня начат — строка сегодняшнего без даты`, d?.title === "Today’s puzzle", d?.title);
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForTimeout(800);
    check(`${tag}: тап по сегодняшнему → вкладка Today, сетка 8-го с ходом`, /#\/today/.test(p.url()) && (await boardSig(p, PANE))[e8[0]] === ST[e8[0]], p.url());
    // перезапуск сразу на Play: сегодняшний из хранилища главнее прошлых
    await openPlay(p, "2026-10-08T10:00:00Z");
    d = await rowInfo(p, "continue-day");
    check(`${tag}: перезапуск на Play — сегодняшний (из хранилища), не прошлый`, d?.title === "Today’s puzzle", d?.title);
    // решить 7-е в архиве напрямую (Year → день)
    await p.goto(`${URL0}/?r=${++reloadN}#/day/2026-10-07`);
    await p.waitForSelector(`${ARCH}[data-date="2026-10-07"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(500);
    await solveAll(p, ARCH, "2026-10-07");
    await p.waitForTimeout(800);
    const rec7 = await dayRecord(p, "2026-10-07");
    check(`${tag}: 7-е решено в архиве 8-го — запись solved+late`, rec7?.solved === true && rec7?.late === true, rec7);
    await p.locator('[data-testid="archive-back"]').click();
    await p.waitForTimeout(1000);
    const sheetTxt = await p.locator('[data-testid="year-sheet-root"].is-open').innerText().catch(() => "");
    check(`${tag}: «‹ Year» → шит 7-го с пометкой Late`, /late/i.test(sheetTxt), sheetTxt.replace(/\s+/g, " ").slice(0, 160));
    await p.screenshot({ path: path.join(OUT, `${tag}-2-year-sheet-late.png`) });
    // решить сегодняшний на Today → строка 5-го
    await closeSheet(p);
    await p.locator("#tab-today").click();
    await p.waitForTimeout(800);
    await solveAll(p, PANE, "2026-10-08");
    await p.waitForTimeout(800);
    await toHub(p);
    const t0 = Date.now();
    await p.waitForFunction(() => document.querySelector('[data-testid="continue-day"] .l1 b')?.textContent.includes("5"), null, { timeout: 5000 }).catch(() => null);
    d = await rowInfo(p, "continue-day");
    check(`${tag}: сегодня и 7-е решены — строка 5-го «· 5 Oct»`, d?.title === "Daily puzzle · 5 Oct", { t: d?.title, ms: Date.now() - t0 });
    await shot(p, "continue-day", `${tag}-3-fifth.png`);
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="2026-10-05"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(500);
    check(`${tag}: архив 5-го — та же сетка с ходом`, (await boardSig(p, ARCH)) === sig5);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

// Z — полночь на открытом приложении, затем «вчера решено»
async function runZ(br) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-Z-393-dark-en`;
  const { browser, p, errs } = await newPage(br, { scheme: "dark", start: "2026-10-07T23:50:00Z" });
  try {
    await openToday(p, "2026-10-07T23:50:00Z");
    const e7 = emptiesOf(MISSION);
    for (const i of e7.slice(0, 2)) await put(p, PANE, i, +SOLUTION[i]);
    await p.waitForTimeout(500);
    const sig7 = await boardSig(p, PANE);
    await toHub(p);
    let d = await rowInfo(p, "continue-day");
    check(`${tag}: до полуночи — без даты`, d?.title === "Today’s puzzle", d?.title);
    await setNow(p, "2026-10-08T00:02:00Z");
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await p.waitForTimeout(1200);
    d = await rowInfo(p, "continue-day");
    check(`${tag}: после полуночи без перезапуска — «· 7 Oct»`, d?.title === "Daily puzzle · 7 Oct", d?.title);
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForTimeout(900);
    check(`${tag}: тап → вкладка Today (стор держит 7-е), та же сетка`, /#\/today/.test(p.url()) && (await boardSig(p, PANE)) === sig7, { u: p.url() });
    await solveAll(p, PANE, "2026-10-07");
    await p.waitForTimeout(800);
    const rec7 = await dayRecord(p, "2026-10-07");
    check(`${tag}: 7-е решено на Today после полуночи — solved+late (как до PD-275)`, rec7?.solved === true && rec7?.late === true, rec7);
    await toHub(p);
    await p.waitForTimeout(800);
    check(`${tag}: решённое 7-е — строки нет (без перезапуска)`, (await p.locator('[data-testid="continue-day"]').count()) === 0);
    await openPlay(p, "2026-10-08T09:00:00Z");
    check(`${tag}: перезапуск 8-го на Play — строки дня нет`, (await p.locator('[data-testid="continue-day"]').count()) === 0);
    await p.screenshot({ path: path.join(OUT, `${tag}-hub-no-row.png`) });
    await p.goto(`${URL0}/?r=${++reloadN}#/today`);
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
    await toHub(p);
    check(`${tag}: перезапуск на Today → Play — строки дня нет`, (await p.locator('[data-testid="continue-day"]').count()) === 0);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

// G — давно брошенный день
async function runG(br) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-G-393-light-en`;
  const { browser, p, errs } = await newPage(br, { start: "2026-09-01T20:00:00Z" });
  try {
    await openToday(p, "2026-09-01T20:00:00Z");
    const e = emptiesOf(MISSION);
    await put(p, PANE, e[0], +SOLUTION[e[0]]);
    await p.waitForTimeout(500);
    const sig = await boardSig(p, PANE);
    await openToday(p, "2026-10-08T09:00:00Z");
    await toHub(p);
    await p.locator('[data-testid="continue-day"]').waitFor({ timeout: 10000 });
    const d = await rowInfo(p, "continue-day");
    check(`${tag}: брошенный 1 сентября всплывает 8 октября`, d?.title === "Daily puzzle · 1 Sep", d?.title);
    await p.screenshot({ path: path.join(OUT, `${tag}-hub.png`) });
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForSelector(`${ARCH}[data-date="2026-09-01"] .board[data-phase="playing"]`, { timeout: 30000 });
    await p.waitForTimeout(500);
    check(`${tag}: архив 1.09 — та же сетка`, (await boardSig(p, ARCH)) === sig);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

// R — только сегодняшний, перезапуск
async function runR(br) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-R-320-light-en-ax3`;
  const { browser, p, errs } = await newPage(br, { W: 320, H: 568, ax3: true, start: "2026-10-08T08:00:00Z" });
  try {
    await openToday(p, "2026-10-08T08:00:00Z");
    const e = emptiesOf(MT);
    await put(p, PANE, e[0], +ST[e[0]]);
    await p.waitForTimeout(500);
    await openPlay(p, "2026-10-08T09:00:00Z");
    const d = await rowInfo(p, "continue-day");
    check(`${tag}: перезапуск на Play — сегодняшний без даты`, d?.title === "Today’s puzzle", d?.title);
    await p.locator('[data-testid="continue-day"]').click();
    await p.waitForTimeout(1500);
    check(`${tag}: тап → Today (не архив)`, /#\/today/.test(p.url()) && (await p.locator(ARCH).count()) === 0, p.url());
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 30000 });
    check(`${tag}: на Today — ход на месте`, (await boardSig(p, PANE))[e[0]] === ST[e[0]]);
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

// T — «будущий» день (смена часового пояса на запад / перевод часов назад): запись 8-го, «сегодня» стало 7-е.
async function runT(br) {
  const tag = `${br === "webkit" ? "wk" : "cr"}-T-393-light-en`;
  const { browser, p, errs } = await newPage(br, { start: "2026-10-08T09:00:00Z" });
  try {
    await openToday(p, "2026-10-08T09:00:00Z");
    const e = emptiesOf(MT);
    await put(p, PANE, e[0], +ST[e[0]]);
    await p.waitForTimeout(500);
    await openPlay(p, "2026-10-07T20:00:00Z");
    const d = await rowInfo(p, "continue-day");
    console.log(`INFO ${tag}: строка при записи «из будущего»:`, JSON.stringify(d?.title ?? null));
    check(`${tag}: PD-283 — строки дня «из будущего» в «Продолжить» нет`, d === null || d === undefined, JSON.stringify(d?.title ?? null));
    if (d) {
      await p.locator('[data-testid="continue-day"]').click();
      await p.waitForTimeout(2500);
      const unavailable = await p.locator(ARCH).evaluate((el) => el.innerText.replace(/\s+/g, " ").slice(0, 200)).catch(() => "");
      console.log(`INFO ${tag}: после тапа url=${p.url()} архив: ${unavailable}`);
      await p.screenshot({ path: path.join(OUT, `${tag}-future-tap.png`) });
    }
    check(`${tag}: без ошибок страницы`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

const XCFG = [
  { lang: "en", W: 393, H: 852, scheme: "light" },
  { lang: "uk", W: 393, H: 852, scheme: "dark" },
  { lang: "ru", W: 320, H: 568, scheme: "dark", ax3: true },
  { lang: "uk", W: 320, H: 568, scheme: "light", ax3: true },
];
const RUNS = { X: (br) => XCFG.reduce((a, c) => a.then(() => guard(`${br}-X-${c.lang}-${c.W}`, () => runX(br, c))), Promise.resolve()), Y: (br) => guard(`${br}-Y`, () => runY(br)), Z: (br) => guard(`${br}-Z`, () => runZ(br)), G: (br) => guard(`${br}-G`, () => runG(br)), R: (br) => guard(`${br}-R`, () => runR(br)), T: (br) => guard(`${br}-T`, () => runT(br)) };
async function guard(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name}: сценарий целиком`, false, String(e?.message ?? e).split("\n").slice(0, 8).join(" | "));
  }
}

await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
try {
  for (const br of browsers) for (const k of process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(RUNS)) await RUNS[k](br);
} finally {
  server.close();
}
console.log(`\n${total - fails.length}/${total} PASS`);
process.exit(fails.length ? 1 : 0);
