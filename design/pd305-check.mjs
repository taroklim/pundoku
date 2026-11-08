/**
 * PD-305 живая проверка (393×852): DIST=apps/web/dist ENGINE=packages/engine/dist/index.js PW_MODULE=<playwright-core> OUT=/tmp/pd305-shots
 *   node design/pd305-check.mjs [chromium] [webkit] [timing] [only-timing]
 * A — новый профиль: Play → Classic: 4 сложности, Expert выбран, пояснение «No X-Wing»; Settings: switch вкл, источник Sudoku.com.
 * B — выключили «No X-Wing» → в шите 6 строк (Virtuoso, Master), пояснения нет; включили — снова 4.
 * C — Today (Sudoku.com) без ходов → выбрали наш → Today сразу наша сетка (= dailyPuzzle(date,'expert')), API дня больше не зовётся.
 * D — начатый день Sudoku.com → выбрали наш → подпись «from tomorrow», сетка та же и после перезагрузки; следующий день — наша.
 * E — наш источник офлайн (API 503 + offline) — та же сетка; два профиля — одинаковая сетка.
 * T — замер: Today нашей сетки и Play Expert при CPU-троттлинге ×4 (Chromium, профиль «iPhone»).
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = process.env.PW_MODULE ? createRequire(import.meta.url)(process.env.PW_MODULE) : createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const engine = await import(process.env.ENGINE);
const DIST = path.resolve(process.env.DIST);
const OUT = process.env.OUT ?? "/tmp/pd305-shots";
const PORT = +(process.env.PORT ?? 5391);
fs.mkdirSync(OUT, { recursive: true });
const D1 = "2026-11-08";
const D2 = "2026-11-09";
const SUDOKU = (d) => engine.dailyPuzzle(d, "easy").mission; // «сетка Sudoku.com» мока
const OWN = (d) => engine.dailyPuzzle(d, "expert");
let apiDaily = 0;
let apiDown = false;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    apiDaily++;
    if (apiDown) {
      r.writeHead(503);
      return r.end();
    }
    r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return r.end(JSON.stringify({ date: m[1], mission: SUDOKU(m[1]), difficulty: "hard", source: "sudoku.com", winRate: 71 }));
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
const URL0 = `http://127.0.0.1:${PORT}`;
let reloadN = 0;

async function newPage(br, { lang = "en", start = `${D1}T10:00:00Z` } = {}) {
  const browser = await pw[br].launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
  await ctx.addInitScript((lang) => {
    try {
      localStorage.setItem("pundoku.locale", lang);
    } catch {}
  }, lang);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => {
    if (!/\/api\//.test(e.message)) errs.push(e.message); // мок API отдаёт 503 на sync/devices — как в прежних QA-скриптах
  });
  await p.clock.install({ time: new Date(start) });
  await p.clock.resume();
  return { browser, ctx, p, errs };
}
async function boardSig(p) {
  return p.evaluate((root) => {
    const cells = [...document.querySelectorAll(`${root} .board button.cell`)].sort((a, b) => +a.dataset.i - +b.dataset.i);
    return cells.map((c) => (c.textContent.trim().match(/^[1-9]$/) ? c.textContent.trim() : "0")).join("");
  }, PANE);
}
const givensOf = (sig, mission) => [...mission].map((g, i) => (g === "0" ? "0" : sig[i])).join("");
async function openToday(p) {
  await p.goto(`${URL0}/?r=${++reloadN}#/today`);
  await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
  await p.waitForTimeout(500);
}
async function toHash(p, h) {
  await p.evaluate((h) => (location.hash = h), h);
  await p.waitForTimeout(700);
}
async function sourceLine(p) {
  const l = p.locator(`${PANE} [data-testid="source"]`);
  return (await l.count()) ? (await l.textContent()).trim() : null;
}
async function openSheet(p, mode = "classic") {
  await p.goto(`${URL0}/?r=${++reloadN}#/play`);
  await p.locator(`[data-testid="mode-${mode}"]`).waitFor({ timeout: 20000 });
  await p.waitForTimeout(800);
  await p.locator(`[data-testid="mode-${mode}"]`).click();
  await p.locator('[data-testid="mode-sheet"]').waitFor();
  await p.waitForTimeout(500);
}
async function sheetInfo(p) {
  return p.evaluate(() => {
    const radios = [...document.querySelectorAll('[data-testid="mode-sheet"] [role="radio"]')];
    return {
      ids: radios.map((r) => r.dataset.testid.replace("difficulty-", "")),
      checked: radios.find((r) => r.getAttribute("aria-checked") === "true")?.dataset.testid,
      note: document.querySelector('[data-testid="difficulty-noxwing-note"]')?.textContent ?? null,
      labels: radios.map((r) => r.querySelector(".lab")?.textContent),
    };
  });
}

async function runA_B(br) {
  const tag = br === "webkit" ? "wk" : "cr";
  const { browser, p, errs } = await newPage(br);
  try {
    await openSheet(p);
    let s = await sheetInfo(p);
    check(`${tag} A: 4 сложности по умолчанию`, JSON.stringify(s.ids) === JSON.stringify(["easy", "medium", "hard", "expert"]), s.ids);
    check(`${tag} A: Expert выбран`, s.checked === "difficulty-expert", s.checked);
    check(`${tag} A: пояснение «No X-Wing»`, /No X-Wing/.test(s.note ?? ""), s.note);
    await p.locator('[data-testid="mode-sheet"]').screenshot({ path: path.join(OUT, `${tag}-A-sheet-noxwing.png`) });
    await p.goto(`${URL0}/?r=${++reloadN}#/settings`);
    await p.locator('[data-testid="no-x-wing"]').waitFor();
    check(`${tag} A: switch «No X-Wing» вкл`, await p.locator('[data-testid="no-x-wing"]').isChecked());
    check(`${tag} A: источник по умолчанию Sudoku.com`, (await p.locator('[data-testid="daily-source-sudoku.com"]').getAttribute("aria-checked")) === "true");
    await p.locator("#settings-h-game").scrollIntoViewIfNeeded();
    await p.locator('[data-testid="no-x-wing"]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, `${tag}-A-settings-game.png`) });
    await p.locator("#settings-h-daily").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, `${tag}-A-settings-daily.png`) });
    // B
    await p.locator('[data-testid="no-x-wing"]').evaluate((el) => el.closest("label").click());
    await p.waitForTimeout(200);
    check(`${tag} B: выключили`, !(await p.locator('[data-testid="no-x-wing"]').isChecked()));
    await openSheet(p);
    s = await sheetInfo(p);
    check(`${tag} B: 6 сложностей`, s.ids.length === 6 && s.ids.includes("expert_plus") && s.ids.includes("master"), s.ids);
    check(`${tag} B: Virtuoso в списке`, s.labels.some((l) => /^Virtuoso24 clues · X-Wing, Swordfish$/.test(l)), s.labels);
    check(`${tag} B: пояснения нет`, s.note === null);
    await p.locator('[data-testid="mode-sheet"]').screenshot({ path: path.join(OUT, `${tag}-B-sheet-all.png`) });
    // выбрать master, включить настройку обратно — предвыбор Expert
    await p.locator('[data-testid="difficulty-master"]').click();
    await p.locator('[data-testid="sheet-cancel"]').click();
    await p.goto(`${URL0}/?r=${++reloadN}#/settings`);
    await p.locator('[data-testid="no-x-wing"]').evaluate((el) => el.closest("label").click());
    await openSheet(p);
    s = await sheetInfo(p);
    check(`${tag} B: снова 4, Expert`, s.ids.length === 4 && s.checked === "difficulty-expert", s);
    // старт Expert — сетка строится, партия идёт
    await p.locator('[data-testid="sheet-start"]').click();
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
    check(`${tag} B: партия Expert стартовала`, true);
    check(`${tag} A/B: без ошибок страницы`, errs.length === 0, errs);
  } finally {
    await browser.close();
  }
}

async function runC_D(br) {
  const tag = br === "webkit" ? "wk" : "cr";
  const { browser, p, errs } = await newPage(br);
  try {
    apiDaily = 0;
    await openToday(p);
    let sig = await boardSig(p);
    check(`${tag} C: Today Sudoku.com по умолчанию`, sig === SUDOKU(D1), await sourceLine(p));
    await toHash(p, "#/settings");
    await p.locator('[data-testid="daily-source-pundoku"]').click();
    await p.waitForTimeout(300);
    check(`${tag} C: подписи «tomorrow» нет (день не начат)`, (await p.locator('[data-testid="daily-source-later"]').count()) === 0);
    const before = apiDaily;
    await toHash(p, "#/today");
    await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 45000 });
    await p.waitForTimeout(400);
    sig = await boardSig(p);
    check(`${tag} C: не начатый день сразу стал нашим`, sig === OWN(D1).mission, sig.slice(0, 20));
    const head = await p.locator(`${PANE} >> text=/· Expert ·/`).count();
    check(`${tag} C: подпись дня «· Expert ·»`, head > 0, head);
    await p.waitForTimeout(300);
    check(`${tag} C: API дня не звали после выбора нашего`, apiDaily === before, { before, after: apiDaily });
    await p.screenshot({ path: path.join(OUT, `${tag}-C-today-own.png`) });
    // перезагрузка — та же, без сети
    await openToday(p);
    check(`${tag} C: после перезагрузки — та же наша`, (await boardSig(p)) === OWN(D1).mission);
    check(`${tag} C: и API дня не зван`, apiDaily === before, apiDaily);
    // D: вернули Sudoku.com — не начат — сразу Sudoku.com; ставим ход; выбираем наш — остаётся
    await toHash(p, "#/settings");
    await p.locator('[data-testid="daily-source-sudoku.com"]').click();
    await toHash(p, "#/today");
    await p.waitForFunction((args) => {
      const [root, m] = args;
      const cells = [...document.querySelectorAll(`${root} .board button.cell`)].sort((a, b) => +a.dataset.i - +b.dataset.i);
      return cells.map((c) => (c.textContent.trim().match(/^[1-9]$/) ? c.textContent.trim() : "0")).join("") === m;
    }, [PANE, SUDOKU(D1)], { timeout: 20000 });
    check(`${tag} D: вернулись к Sudoku.com (не начат)`, true);
    const sol = engine.solve(SUDOKU(D1)).join("");
    const empty = [...SUDOKU(D1)].findIndex((g) => g === "0");
    await p.locator(`${PANE} .board button.cell[data-i="${empty}"]`).click();
    await p.locator(`${PANE} .pad .key`).nth(+sol[empty] - 1).click();
    await p.waitForTimeout(500);
    await toHash(p, "#/settings");
    await p.locator('[data-testid="daily-source-pundoku"]').click();
    await p.waitForTimeout(400);
    const later = p.locator('[data-testid="daily-source-later"]');
    check(`${tag} D: подпись «applies from tomorrow»`, (await later.count()) === 1 && /tomorrow/.test(await later.textContent()), (await later.count()) ? await later.textContent() : null);
    await p.locator("#settings-h-daily").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, `${tag}-D-settings-later.png`) });
    await toHash(p, "#/today");
    sig = await boardSig(p);
    check(`${tag} D: начатый день не сменился`, givensOf(sig, SUDOKU(D1)) === SUDOKU(D1) && sig[empty] === sol[empty]);
    await openToday(p);
    sig = await boardSig(p);
    check(`${tag} D: и после перезагрузки`, givensOf(sig, SUDOKU(D1)) === SUDOKU(D1) && sig[empty] === sol[empty], await sourceLine(p));
    // следующий день
    await p.clock.setSystemTime(new Date(`${D2}T09:00:00Z`));
    await openToday(p);
    check(`${tag} D: следующий день — наша сетка`, (await boardSig(p)) === OWN(D2).mission, await sourceLine(p));
    check(`${tag} C/D: без ошибок страницы`, errs.length === 0, errs);
  } finally {
    await browser.close();
  }
}

async function runE(br) {
  const tag = br === "webkit" ? "wk" : "cr";
  const a = await newPage(br);
  const b = await newPage(br);
  try {
    apiDown = true;
    for (const x of [a, b]) {
      await x.p.goto(`${URL0}/?r=${++reloadN}#/settings`);
      await x.p.locator('[data-testid="daily-source-pundoku"]').click();
    }
    await a.p.route("**/api/**", (r) => r.abort("internetdisconnected"));
    await openToday(a.p);
    await openToday(b.p);
    const sa = await boardSig(a.p);
    const sb = await boardSig(b.p);
    check(`${tag} E: офлайн — наша сетка`, sa === OWN(D1).mission);
    check(`${tag} E: два профиля — одна сетка`, sa === sb);
    check(`${tag} E: без плашки офлайна/ошибок`, a.errs.length === 0 && b.errs.length === 0, [...a.errs, ...b.errs]);
  } finally {
    apiDown = false;
    await a.browser.close();
    await b.browser.close();
  }
}

/** Замер: CPU ×4 (Chromium CDP). Today нашей сетки — от goto до поля; Play Expert — от «Start» до поля. */
async function runT() {
  const { browser, p } = await newPage("chromium");
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const today = [];
  const play = [];
  const base = [];
  try {
    for (let i = 0; i < 12; i++) {
      await p.clock.setSystemTime(new Date(Date.UTC(2026, 10, 1 + i, 10)));
      await p.goto(`${URL0}/?r=${++reloadN}#/play`);
      await p.evaluate(() => new Promise((ok) => { const r = indexedDB.deleteDatabase("pundoku"); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
      const t0 = Date.now();
      await openToday(p);
      base.push(Date.now() - t0 - 500);
    }
    await p.goto(`${URL0}/?r=${++reloadN}#/settings`);
    await p.locator('[data-testid="daily-source-pundoku"]').click();
    for (let i = 0; i < 12; i++) {
      const date = new Date(Date.UTC(2026, 10, 1 + i, 10));
      await p.clock.setSystemTime(date);
      await p.evaluate(() => indexedDB.deleteDatabase("pundoku"));
      const t0 = Date.now();
      await openToday(p);
      today.push(Date.now() - t0 - 500);
    }
    for (let i = 0; i < 12; i++) {
      await p.evaluate(() => new Promise((ok) => { const r = indexedDB.deleteDatabase("pundoku"); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
      await openSheet(p);
      const t0 = Date.now();
      await p.locator('[data-testid="sheet-start"]').click();
      await p.waitForSelector(`${PANE} .board[data-phase="playing"]`, { timeout: 60000 });
      play.push(Date.now() - t0);
    }
  } finally {
    await browser.close();
  }
  const st = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s.at(-1) };
  };
  console.log("TIMING today-sudoku.com baseline (cold load incl. page boot, CPU x4)", JSON.stringify(st(base)));
  console.log("TIMING today-own (cold load incl. page boot, CPU x4)", JSON.stringify(st(today)));
  console.log("TIMING play-expert start->board (CPU x4)", JSON.stringify(st(play)));
}

await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
const args = process.argv.slice(2).filter((a) => a !== "timing" && a !== "only-timing");
const browsers = args.length ? args : ["chromium", "webkit"];
try {
  for (const br of process.argv.includes("only-timing") ? [] : browsers) {
    await runA_B(br);
    await runC_D(br);
    await runE(br);
  }
  if (process.argv.includes("timing")) await runT();
} catch (e) {
  console.log("CRASH", e);
  fails.push("crash");
} finally {
  server.close();
}
console.log(`\n${total - fails.length}/${total} PASS${fails.length ? " — FAIL: " + fails.join(", ") : ""}`);
process.exit(fails.length ? 1 : 0);
