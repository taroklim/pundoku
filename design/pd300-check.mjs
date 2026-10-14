/**
 * PD-300 / PD-302 — живая проверка: клавиши 1–9 выше и цифра крупнее на iPhone от 390 pt (PD-302: и на iPhone 16 393×852 — решение
 * владельца), на 375 pt и уже, AX3, в ландшафте и на десктопе C — как в main; поле нигде не меняется. Сравнение ветки с эталонной сборкой main на РЕАЛЬНЫХ сборках (Chromium + WebKit).
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd300-dist          (ветка pd-300)
 *   (main)        npx vite build --outDir /tmp/pd300-base            (эталон)
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd300-dist BASE_DIST=/tmp/pd300-base PORT=5531 \
 *     node design/pd300-check.mjs [chromium] [webkit]
 *
 * Условия — как pd285/pd295: html font-size 17 px (23 — xxxL, 40 — AX3), --sa-top/--sa-bot как у устройства (430×932 и 393×852
 * 59/34, 428×926 47/34, 440×956 и 402×874 62/34, 390×844 47/34, 414×896 48/34, 375×812 50/34, 375×667 и 320×568 20/0, Android
 * 412×915 и 360×800 0/0) и вариант «без safe-area» (вкладка браузера/эмуляция); isMobile +
 * hasTouch, время зафиксировано, сетка дня своя. Питомец выключен в обеих сборках (localStorage pundoku.pet = "0").
 *
 * На каждом кадре (ветка и main): поле (.board: top/left/width/height), клавиша (высота, ширина), кегль/насыщенность цифры, кегль
 * счётчика остатка, низ ряда действий против верха таб-бара, экран партии не прокручивается.
 *   board     — поле ветки == поле main (±0.5 px) везде;
 *   grow      — PD-302: 390/393/402 (17 и 23 px, с safe-area и без): клавиша выше main ≥ 6 px и ≤ 76, цифра не мельче main (при 17 px
 *               крупнее); 393×852 при 17 px — клавиша 64–68 px, цифра 24–25.5 px;
 *   big       — 412/414/428/430/440: клавиша не ниже main (после PD-300) и ≤ 76 px, цифра не мельче main;
 *   same      — 320×568, 375×667, 375×812, 360×800 (и с safe-area, и без), AX3, ландшафт 932×430, десктоп C 1280×800: высота
 *               клавиши и кегль цифры == main;
 *   fit       — ряд действий над таб-баром, экран партии не прокручивается (Today при AX3 прокручивается по PD-159 — там не меряем);
 *   kr        — счётчик остатка не мельче 11 px;
 *   dock      — 430×932 и 393×852: открытый док подсказки поле не двигает (как в main).
 * Режимы: Today, Play Classic, Лжец, Ink, Глифы. Кадры до/после (393×852 и 430×932, light/dark, Play и Today, chromium) —
 * design/<OUT>/{main,<TAG>}-<w>x<h>-<тема>-<экран>.png; итог — design/<OUT>/results-<браузеры>.json. OUT/TAG — переменные
 * окружения (по умолчанию pd302-shots / pd302; для PD-300 были pd300-shots / pd300).
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Developer/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const BASE_DIST = path.resolve(process.env.BASE_DIST ?? "/tmp/pd300-base");
const PORT = +(process.env.PORT ?? 5531);
const OUT = path.join(HERE, process.env.OUT ?? "pd302-shots");
const TAG = process.env.TAG ?? "pd302";
const NOW = new Date("2026-10-14T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const args = process.argv.slice(2);
const brs = args.filter((a) => ["chromium", "webkit"].includes(a));
const browsers = brs.length ? brs : ["chromium", "webkit"];
const FILTER = process.env.FILTER ?? "";
fs.mkdirSync(OUT, { recursive: true });

// ---------- сервер ----------
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function serve(root, port) {
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
    let f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
    r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

const results = {};
const fails = [];
const check = (name, ok, detail = {}) => {
  results[name] = { ok: !!ok, ...detail };
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail));
};

// ---------- кейсы ----------
const SA = {
  "430x932": [59, 34],
  "428x926": [47, 34],
  "440x956": [62, 34],
  "393x852": [59, 34],
  "375x667": [20, 0],
  "320x568": [20, 0],
  "402x874": [62, 34],
  "390x844": [47, 34],
  "414x896": [48, 34],
  "412x915": [0, 0],
  "375x812": [50, 34],
  "360x800": [0, 0],
};
// PD-302: класс ожидания по ширине вьюпорта (главный кейс — iPhone 16 владельца, 393×852).
const GROW = new Set(["390x844", "393x852", "402x874"]);
const BIG = new Set(["412x915", "414x896", "428x926", "430x932", "440x956"]);
// Полный набор режимов — на исходных шести экранах PD-300; на добавленных в PD-302 — Play/Today, без safe-area и Глифы.
const FULL = new Set(["430x932", "428x926", "440x956", "393x852", "375x667", "320x568"]);
const cases = [];
for (const s of Object.keys(SA)) {
  const [w, h] = s.split("x").map(Number);
  const full = FULL.has(s);
  for (const screen of ["play", "today"])
    for (const scheme of ["light", "dark"]) if (full || (screen === "play") === (scheme === "light")) cases.push({ s, w, h, screen, scheme, rem: 17, sa: SA[s] });
  if (SA[s][0] || SA[s][1]) cases.push({ s, w, h, screen: "play", scheme: "light", rem: 17, sa: [0, 0], tag: "nosa" });
  for (const mode of full ? ["liar", "ink", "glyphs"] : ["glyphs"]) cases.push({ s, w, h, screen: "play", mode, scheme: "light", rem: 17, sa: SA[s] });
}
for (const s of ["430x932", "440x956", "393x852", "320x568"]) {
  const [w, h] = s.split("x").map(Number);
  cases.push({ s, w, h, screen: "play", scheme: "light", rem: 40, sa: SA[s], tag: "AX3", expectSame: true });
  cases.push({ s, w, h, screen: "today", scheme: "light", rem: 40, sa: SA[s], tag: "AX3", expectSame: true, scrolls: true });
}
for (const s of ["430x932", "393x852"]) {
  const [w, h] = s.split("x").map(Number);
  cases.push({ s, w, h, screen: "play", scheme: "light", rem: 23, sa: SA[s], tag: "xxxL" });
}
cases.push({ s: "932x430", w: 932, h: 430, screen: "play", scheme: "light", rem: 17, sa: [0, 21], tag: "landscape", expectSame: true });
cases.push({ s: "956x440", w: 956, h: 440, screen: "today", scheme: "dark", rem: 17, sa: [0, 21], tag: "landscape", expectSame: true });
cases.push({ s: "1280x800", w: 1280, h: 800, screen: "play", scheme: "light", rem: 16, sa: [0, 0], tag: "desk", desk: true, expectSame: true });
cases.push({ s: "1280x800", w: 1280, h: 800, screen: "play", mode: "glyphs", scheme: "dark", rem: 16, sa: [0, 0], tag: "desk", desk: true, expectSame: true });
const label = (c) => `${c.s} ${c.screen}${c.mode ? "-" + c.mode : ""} ${c.scheme}${c.tag ? " " + c.tag : ""}${c.rem !== 17 && !c.tag ? " " + c.rem : ""}`;

// ---------- браузер ----------
const ENV_INIT = () => {
  const v = sessionStorage.getItem("pd300env");
  if (!v) return;
  const [f, t, b] = JSON.parse(v);
  const add = () => {
    const st = document.createElement("style");
    st.textContent = `html{font-size:${f}px !important}:root{--sa-top:${t}px !important;--sa-bot:${b}px !important}`;
    document.documentElement.appendChild(st);
  };
  if (document.documentElement) add();
  else document.addEventListener("DOMContentLoaded", add);
};
async function open(browser, bname, c, base) {
  const touch = !c.desk;
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    screen: { width: c.w, height: c.h },
    deviceScaleFactor: c.desk ? 1 : 2,
    isMobile: touch && bname === "chromium",
    hasTouch: touch,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: c.scheme,
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript((v) => {
    sessionStorage.setItem("pd300env", v);
    localStorage.setItem("pundoku.pet", "0");
  }, JSON.stringify([c.rem, c.sa[0], c.sa[1]]));
  await ctx.addInitScript(ENV_INIT);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => {
    if (!/api\/devices|access control/.test(e.message)) errs.push(e.message);
  });
  await p.goto(`${base}/#/${c.screen}`);
  return { ctx, p, errs };
}
const act = (p, c, loc) => (c.desk ? loc.click() : loc.tap());
async function startMode(p, c) {
  const pane = c.desk ? "" : '.tab-pane[data-tab="play"] ';
  const row = p.locator(`${pane}[data-testid="mode-${c.mode ?? "classic"}"]`).first();
  await row.waitFor({ timeout: 60000 });
  await act(p, c, row);
  await p.locator('[data-testid="sheet-start"]').waitFor();
  await p.waitForTimeout(400);
  const easy = p.locator('[data-testid="difficulty-easy"]');
  if (await easy.count()) await act(p, c, easy);
  await act(p, c, p.locator('[data-testid="sheet-start"]'));
  if (c.mode === "ink") {
    // Чернила: после шита режима — шит правила «без отмены».
    const rule = p.locator('[data-testid="ink-rule-start"]');
    await rule.waitFor({ timeout: 10000 }).catch(() => {});
    if (await rule.count()) await act(p, c, rule);
  }
}
const rootSel = (c) => (c.desk ? ".play.play-fit" : `.tab-pane[data-tab="${c.screen}"] .play-fit`);
const measure = (p, c) =>
  p.evaluate((root) => {
    const R = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), l: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    const fit = document.querySelector(root);
    const key = fit?.querySelector(".pad .key");
    const kd = key?.querySelector(".kd");
    const gl = kd?.querySelector(".gl");
    const kr = key?.querySelector(".kr");
    const cs = kd ? getComputedStyle(kd) : null;
    const ks = key ? getComputedStyle(key) : null;
    return {
      board: R(fit?.querySelector(".board")),
      key: R(key),
      kd: cs ? { size: +parseFloat(cs.fontSize).toFixed(2), weight: cs.fontWeight } : null,
      gl: R(gl),
      kr: kr ? +parseFloat(getComputedStyle(kr).fontSize).toFixed(2) : null,
      keyShadow: ks?.boxShadow ?? null,
      actions: R(fit?.querySelector(".actions")),
      tab: R(document.querySelector(".tabbar")),
      fit: fit ? [fit.scrollHeight, fit.clientHeight] : null,
      pane: (() => {
        const sc = fit?.closest(".scroll");
        return sc ? [sc.scrollHeight, sc.clientHeight] : null;
      })(),
    };
  }, rootSel(c));

async function frame(browser, bname, c, base, shot) {
  const { ctx, p, errs } = await open(browser, bname, c, base);
  try {
    if (c.screen === "play") await startMode(p, c);
    await p.locator(`${rootSel(c)} .board .cell .d.given`).first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(900);
    const m = await measure(p, c);
    if (shot) fs.writeFileSync(shot, await p.screenshot());
    if (c.dock) {
      const lamp = p.locator('[data-testid="hint-button"]').first();
      if (await lamp.count()) {
        await act(p, c, lamp);
        await p.waitForTimeout(700);
        m.docked = await measure(p, c);
      }
    }
    m.errs = errs;
    return m;
  } finally {
    await ctx.close();
  }
}

const near = (a, b, eps = 0.5) => a != null && b != null && Math.abs(a - b) <= eps;
const sameBox = (a, b) => a && b && near(a.t, b.t) && near(a.l, b.l) && near(a.w, b.w) && near(a.h, b.h);

const s1 = await serve(DIST, PORT);
const s2 = await serve(BASE_DIST, PORT + 1);
const table = [];
try {
  for (const bname of browsers) {
    const browser = await pw[bname].launch();
    try {
      for (const c0 of cases) {
        const c = { ...c0, dock: (c0.s === "430x932" || c0.s === "393x852") && c0.screen === "play" && !c0.mode && c0.rem === 17 && !c0.tag };
        const L = `${bname} ${label(c)}`;
        if (FILTER && !L.includes(FILTER)) continue;
        const shotOk = bname === "chromium" && (c.s === "430x932" || c.s === "393x852") && !c.mode && !c.tag && c.rem === 17;
        const nm = (who) => (shotOk ? path.join(OUT, `${who}-${c.s}-${c.scheme}-${c.screen}.png`) : null);
        let a, b;
        try {
          a = await frame(browser, bname, c, `http://127.0.0.1:${PORT}`, nm(TAG));
          b = await frame(browser, bname, c, `http://127.0.0.1:${PORT + 1}`, nm("main"));
        } catch (e) {
          check(`${L}: кадр снят`, false, { err: String(e).slice(0, 300) });
          continue;
        }
        check(`${L}: board == main`, sameBox(a.board, b.board), { pd300: a.board, main: b.board });
        const sizes = { key: [b.key.h, a.key.h], kd: [b.kd.size, a.kd.size], gl: [b.gl?.w, a.gl?.w] };
        const notSmaller = c.mode === "glyphs" ? a.gl.w >= b.gl.w - 0.05 : a.kd.size >= b.kd.size - 0.01;
        if (GROW.has(c.s) && !c.expectSame) {
          const larger = c.mode === "glyphs" ? a.gl.w > b.gl.w : a.kd.size > b.kd.size;
          check(`${L}: клавиша выше main ≥ 6 px и ≤ 76, цифра ${c.rem === 17 ? "крупнее" : "не мельче"}`, a.key.h >= b.key.h + 6 && a.key.h <= 76.5 && (c.rem === 17 ? larger : notSmaller), sizes);
          if (c.s === "393x852" && c.rem === 17 && !c.mode)
            check(`${L}: iPhone 16 — клавиша 64–68 px, цифра 24–25.5 px`, a.key.h >= 63.5 && a.key.h <= 68.5 && a.kd.size >= 24 && a.kd.size <= 25.5, sizes);
        } else if (BIG.has(c.s) && !c.expectSame) {
          check(`${L}: клавиша не ниже main (PD-300) и ≤ 76, цифра не мельче`, a.key.h >= b.key.h - 0.5 && a.key.h <= 76.5 && notSmaller, sizes);
        } else {
          check(`${L}: клавиша и цифра == main`, near(a.key.h, b.key.h) && near(a.kd.size, b.kd.size, 0.01) && near(a.gl?.w ?? 0, b.gl?.w ?? 0), {
            key: [b.key.h, a.key.h],
            kd: [b.kd.size, a.kd.size],
            gl: [b.gl?.w, a.gl?.w],
          });
        }
        if (!c.desk && !c.scrolls && c.tag !== "landscape") {
          check(`${L}: ряд действий над таб-баром, экран не прокручивается`, a.actions.b <= a.tab.t + 0.5 && a.fit[0] <= a.fit[1] && a.pane[0] <= a.pane[1], {
            actionsBottom: a.actions.b,
            tabTop: a.tab.t,
            fit: a.fit,
            pane: a.pane,
          });
        }
        check(`${L}: счётчик остатка ≥ 11 px`, a.kr >= 11, { kr: a.kr });
        if (a.docked) check(`${L}: док подсказки поле не двигает`, sameBox(a.docked.board, a.board) && sameBox(b.docked?.board, b.board), { closed: a.board, open: a.docked.board });
        if (a.errs.length) check(`${L}: без ошибок страницы`, false, { errs: a.errs.slice(0, 3) });
        table.push({ browser: bname, case: label(c), board: `${b.board.w}→${a.board.w}`, boardTop: `${b.board.t}→${a.board.t}`, key: `${b.key.h}→${a.key.h}`, kd: `${b.kd.size}→${a.kd.size}`, weight: `${b.kd.weight}→${a.kd.weight}`, kr: `${b.kr}→${a.kr}`, gap: +(a.tab ? a.tab.t - a.actions.b : 0).toFixed(1) });
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  s1.close();
  s2.close();
}
console.table(table);
fs.writeFileSync(path.join(OUT, `results-${browsers.join("-")}.json`), JSON.stringify({ fails, results, table }, null, 1));
console.log(fails.length ? `\n${fails.length} FAIL` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
