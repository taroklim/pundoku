// Общие помощники ПЕРЕМЕРА PD-140 на main 96bbd4a (после пакетов A–E, C, PD-139, PD-142, PD-144): эмуляция iPhone (393x852 / 320x568),
// внутристраничные метки времени, учёт тапов с координатами (зона большого пальца), решение сетки движком из сборки,
// посев профиля «ветерана». Отличие от lib.mjs ветки pd-ia-measure: IndexedDB сеется ВРУЧНУЮ с ожиданием tx.oncomplete
// (storageState({indexedDB:true}) в WebKit восстанавливает записи без ожидания фиксации -> getAll() с undefined -> ложные падения Year, PD-146).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";

export const BASE = process.env.BASE ?? "http://127.0.0.1:3992";
export const WT = process.env.WT ?? "/Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku-worktrees/ia-remeasure";
export const SHOTS = process.env.SHOTS ?? "/tmp/ia-shots-after";
export const STATE_DIR = process.env.STATE_DIR ?? "/tmp/pundoku-iarem";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(STATE_DIR, { recursive: true });

const require = createRequire((process.env.PW_DIR ?? "/tmp/pundoku-ios/pw") + "/");
export const pw = require("playwright");

const [VW, VH] = (process.env.VIEW ?? "393x852").split("x").map(Number);
export const H = VH;
export const THUMB_Y = (H * 2) / 3; // нижняя треть: y >= 568
export const zoneOf = (y) => (y >= THUMB_Y ? "thumb" : y >= H / 3 ? "mid" : "top");

const IPHONE16 = {
  viewport: { width: VW, height: VH },
  screen: { width: VW, height: VH },
  deviceScaleFactor: VW >= 390 ? 3 : 2,
  isMobile: true,
  hasTouch: true,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light",
};
const WEBKIT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const launch = (engine) => pw[engine].launch();
/** profile = { ls: storageState без IndexedDB (cookies + localStorage), idb: дамп IndexedDB } либо undefined (чистый профиль). */
export const newCtx = (browser, engine, profile) =>
  browser.newContext({ ...IPHONE16, ...(engine === "webkit" ? { userAgent: WEBKIT_UA } : {}), ...(profile ? { storageState: profile.ls } : {}) });

/**
 * PD-217: страница посева/дампа IndexedDB — тот же origin, но приложение на ней НЕ запускается. Раньше это был `/health`: за nginx
 * он проксируется в api, а на стенде vite (dev/preview: прокси только у `/api`) отдаётся index.html (SPA-fallback) — приложение
 * грузилось прямо на странице посева, открывало ту же базу и писало своё (день реальной даты, мета) параллельно с RESTORE.
 * Итог зависел от того, кто успел первым: «seed verify failed» через раз, а когда проверка проходила — профиль мог быть уже
 * испорчен записями приложения. Теперь страница — пустой HTML, который отдаёт `ctx.route` (сервер не участвует); путь под
 * `/api/`, чтобы и при зарегистрированном service worker навигация не ушла в его navigateFallback (index.html): `/api/` он не
 * обслуживает. Контроль: если на странице всё же оказался скрипт — ошибка сразу, а не флейк потом.
 */
export const FIXTURE_PATH = "/api/__pundoku-idb-fixture";
const FIXTURE_HTML = "<!doctype html><meta charset=utf-8><title>idb fixture</title>";
export async function fixturePage(ctx, base = BASE) {
  const url = base + FIXTURE_PATH;
  const handler = (route) => route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML });
  await ctx.route(url, handler);
  const page = await ctx.newPage();
  try {
    await page.goto(url);
    // Не перехвачен (редкость: навигацию забрал service worker) — придёт ответ api/прокси без скриптов, это тоже годится.
    if (await page.evaluate(() => document.scripts.length > 0)) throw new Error(`fixture page runs a script: ${url}`);
  } catch (e) {
    await page.close();
    await ctx.unroute(url, handler);
    throw e;
  }
  return {
    page,
    close: async () => {
      await page.close();
      await ctx.unroute(url, handler);
    },
  };
}

/** Дамп всех баз IndexedDB origin'а (страница `fixturePage` — приложение не грузится). Читает всё в одной readonly-транзакции и ждёт tx.oncomplete. */
const DUMP = async () => {
  const out = {};
  const dbs = (await indexedDB.databases?.()) ?? [];
  for (const { name } of dbs) {
    out[name] = await new Promise((resolve, reject) => {
      const rq = indexedDB.open(name);
      rq.onerror = () => reject(rq.error);
      rq.onsuccess = () => {
        const db = rq.result;
        const names = [...db.objectStoreNames];
        const res = { version: db.version, stores: {} };
        if (!names.length) {
          db.close();
          return resolve(res);
        }
        const tx = db.transaction(names, "readonly");
        for (const n of names) {
          const st = tx.objectStore(n);
          const rec = { keyPath: st.keyPath, autoIncrement: st.autoIncrement, indexes: [...st.indexNames].map((i) => ({ name: i, keyPath: st.index(i).keyPath, unique: st.index(i).unique, multiEntry: st.index(i).multiEntry })), keys: [], values: [] };
          st.getAllKeys().onsuccess = (e) => (rec.keys = e.target.result);
          st.getAll().onsuccess = (e) => (rec.values = e.target.result);
          res.stores[n] = rec;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(res);
        };
        tx.onerror = tx.onabort = () => reject(tx.error);
      };
    });
  }
  return out;
};
/**
 * Запись дампа: структура воссоздаётся в onupgradeneeded (та же версия, что у приложения -> upgrade у него не сработает); если
 * база уже есть (контекст не чистый), хранилища сначала очищаются — в базе ровно дамп. put всех записей, ждём tx.oncomplete.
 */
export const RESTORE = async (dump) => {
  for (const [name, d] of Object.entries(dump)) {
    await new Promise((resolve, reject) => {
      const rq = indexedDB.open(name, d.version);
      rq.onerror = () => reject(rq.error);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        for (const [n, st] of Object.entries(d.stores)) {
          const os = db.createObjectStore(n, { keyPath: st.keyPath ?? undefined, autoIncrement: st.autoIncrement });
          for (const ix of st.indexes) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
        }
      };
      rq.onsuccess = () => {
        const db = rq.result;
        const names = Object.keys(d.stores);
        if (!names.length) {
          db.close();
          return resolve();
        }
        const tx = db.transaction(names, "readwrite");
        for (const n of names) {
          const st = d.stores[n];
          const os = tx.objectStore(n);
          os.clear();
          st.values.forEach((v, i) => (st.keyPath ? os.put(v) : os.put(v, st.keys[i])));
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = tx.onabort = () => reject(tx.error);
      };
    });
  }
  // контроль: прочитать обратно и убедиться, что нет undefined
  for (const [name, d] of Object.entries(dump)) {
    await new Promise((resolve, reject) => {
      const rq = indexedDB.open(name);
      rq.onerror = () => reject(rq.error);
      rq.onsuccess = () => {
        const db = rq.result;
        const names = Object.keys(d.stores);
        if (!names.length) return resolve(db.close());
        const tx = db.transaction(names, "readonly");
        for (const n of names) {
          const os = tx.objectStore(n);
          os.getAll().onsuccess = (e) => {
            if (e.target.result.length !== d.stores[n].values.length || e.target.result.some((v) => v === undefined)) reject(new Error(`seed verify failed: ${name}/${n} (${e.target.result.length} != ${d.stores[n].values.length})`));
          };
          os.getAllKeys().onsuccess = (e) => {
            if (JSON.stringify(e.target.result) !== JSON.stringify(d.stores[n].keys)) reject(new Error(`seed verify failed: ${name}/${n} keys`));
          };
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = tx.onabort = () => reject(tx.error);
      };
    });
  }
};
export async function snapshotProfile(ctx, base = BASE) {
  const f = await fixturePage(ctx, base);
  try {
    const idb = await f.page.evaluate(DUMP);
    return { ls: await ctx.storageState({ indexedDB: false }), idb };
  } finally {
    await f.close();
  }
}
/** Посеять дамп IndexedDB в контекст (страница без приложения, см. `fixturePage`). Вызывать до первой страницы приложения. */
export async function seedIdb(ctx, idb, base = BASE) {
  if (!idb || !Object.keys(idb).length) return;
  const f = await fixturePage(ctx, base);
  try {
    await f.page.evaluate(RESTORE, idb);
  } finally {
    await f.close();
  }
}
/** Новый контекст с профилем: localStorage — через storageState, IndexedDB — ручной посев с ожиданием tx.oncomplete. */
export async function newProfileCtx(browser, engine, profile, base = BASE) {
  const ctx = await newCtx(browser, engine, profile);
  await seedIdb(ctx, profile?.idb, base);
  return ctx;
}

/** Внутристраничные метки. performance.now() считается от начала навигации (navigationStart). */
const INIT = () => {
  const T = (window.__ia = { marks: {}, watch: {}, lastDown: 0, downs: 0 });
  const down = () => {
    T.lastDown = performance.now();
    T.downs++;
  };
  for (const ev of ["pointerdown", "touchstart", "mousedown"]) addEventListener(ev, down, true);
  const check = () => {
    const now = performance.now();
    for (const [name, sel] of Object.entries(T.watch)) {
      if (document.querySelector(sel)) {
        delete T.watch[name];
        const m = (T.marks[name] = { t: now, sinceDown: now - T.lastDown, paint: null });
        requestAnimationFrame(() => (m.paint = performance.now()));
      }
    }
  };
  T.arm = (name, sel) => {
    delete T.marks[name];
    T.watch[name] = sel;
    check();
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  T.arm("board", ".board:not(.idle) .cell .d.given");
  T.arm("digit", ".board .cell .d.player");
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) T.marks[e.name] = { t: e.startTime };
    }).observe({ type: "paint", buffered: true });
  } catch {
    /* paint timing недоступен */
  }
};
export const instrument = (ctx) => ctx.addInitScript(INIT);

export async function waitMark(page, name, timeout = 30000) {
  await page.waitForFunction((n) => window.__ia?.marks?.[n]?.t !== undefined, name, { timeout });
  await page.waitForTimeout(0);
  return page.evaluate((n) => window.__ia.marks[n], name);
}
export const armMark = (page, name, sel) => page.evaluate(([n, s]) => window.__ia.arm(n, s), [name, sel]);
export const nowPage = (page) => page.evaluate(() => performance.now());

// ---------- сетка ----------
let engineMod;
export async function solveFromDom(page) {
  engineMod ??= await import(pathToFileURL(`${WT}/packages/engine/dist/index.js`).href);
  const puzzle = await page.evaluate(() => {
    const out = Array(81).fill(0);
    for (const c of document.querySelectorAll(".board .cell")) {
      const d = c.querySelector(".d.given");
      if (d) out[Number(c.getAttribute("data-i"))] = Number(d.textContent);
    }
    return out.join("");
  });
  const sol = engineMod.solve(puzzle);
  const s = typeof sol === "string" ? sol : (sol?.solution ?? sol?.grid ?? sol);
  const str = Array.isArray(s) ? s.join("") : String(s);
  if (!/^[1-9]{81}$/.test(str)) throw new Error("solve() вернул неожиданное");
  return { puzzle, solution: str };
}
export const selectedCell = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.board .cell[aria-current="true"]');
    return c ? Number(c.getAttribute("data-i")) : null;
  });

// ---------- учёт тапов ----------
export class Run {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.taps = [];
    this.extra = []; // не-тапы: прокрутка колеса iOS-пикера, ввод ключа и т.п.
    this.steps = [];
    this.t0 = Date.now();
  }
  /** Тап по интерактивному элементу; координаты цели — центр bounding box в CSS-pt (окно 393x852). */
  async tap(label, loc) {
    // шиты выезжают снизу: координату берём, когда цель встала на место (две одинаковые выборки подряд)
    let box = await loc.boundingBox();
    for (let i = 0; i < 40; i++) {
      await this.page.waitForTimeout(60);
      const b2 = await loc.boundingBox();
      if (box && b2 && Math.abs(b2.y - box.y) < 0.5 && Math.abs(b2.x - box.x) < 0.5) {
        box = b2;
        break;
      }
      box = b2;
    }
    if (!box) throw new Error(`нет bbox: ${label}`);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    this.taps.push({ n: this.taps.length + 1, label, x: Math.round(cx), y: Math.round(cy), h: Math.round(box.height), zone: zoneOf(cy) });
    await loc.tap();
  }
  async select(label, loc, value, osExtra) {
    const box = await loc.boundingBox();
    const cy = box.y + box.height / 2;
    this.taps.push({ n: this.taps.length + 1, label, x: Math.round(box.x + box.width / 2), y: Math.round(cy), h: Math.round(box.height), zone: zoneOf(cy), native: "select" });
    if (osExtra) this.extra.push(...osExtra);
    await loc.selectOption(value);
  }
  async step(name, data = {}) {
    this.steps.push({ name, t: Math.round(await nowPage(this.page)), taps: this.taps.length, ...data });
  }
  async shot(file) {
    await this.page.screenshot({ path: `${SHOTS}/${file}.png`, scale: "css" });
  }
  summary() {
    return {
      taps: this.taps.length,
      extraGestures: this.extra,
      targets: this.taps.map((t) => `${t.label}@y${t.y}(${t.zone})`),
      tapList: this.taps,
      zones: this.taps.reduce((a, t) => ((a[t.zone] = (a[t.zone] ?? 0) + 1), a), {}),
      steps: this.steps,
    };
  }
}

/** Один шаг «поставить значение»: первая выбранная клетка + верная цифра с клавиатуры-панели. Возвращает {cell, digit, selectedBefore}. */
export async function placeFirstDigit(run, { cellTap = "auto" } = {}) {
  const { page } = run;
  const { solution } = await solveFromDom(page);
  let cell = await selectedCell(page);
  const selectedBefore = cell;
  // выбранная клетка уже занята (после возобновления) -> цифра стёрла бы её; честная цена хода = тап по первой пустой клетке + цифра
  const selectedFilled = cell !== null && (await page.locator(`.board .cell[data-i="${cell}"] .d`).count()) > 0;
  if (cell === null || selectedFilled) {
    // ничего не выбрано: берём первую пустую клетку
    const empty = await page.evaluate(() => {
      for (const c of document.querySelectorAll(".board .cell")) if (!c.querySelector(".d")) return Number(c.getAttribute("data-i"));
      return null;
    });
    cell = empty;
    await run.tap(`cell r${Math.floor(cell / 9) + 1}c${(cell % 9) + 1}`, page.locator(`.board .cell[data-i="${cell}"]`));
  }
  const d = Number(solution[cell]);
  await run.tap(`digit ${d}`, page.locator(".pad .key").nth(d - 1));
  return { cell, digit: d, selectedBefore, selectedFilled };
}

// ---------- посев профиля «ветерана» ----------
export async function playDay(browser, ctx, page, dateStr, mode) {
  await page.clock.install({ time: new Date(`${dateStr}T12:00:00`) });
  await page.goto(BASE + "/#/today");
  await page.waitForSelector(".board:not(.idle) .cell .d.given", { timeout: 40000 });
  await page.waitForTimeout(400);
  const { puzzle, solution } = await solveFromDom(page);
  const empt = [...puzzle].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0);
  const todo = mode === "full" ? empt : empt.slice(0, 30);
  for (const i of todo) {
    await page.locator(`.board .cell[data-i="${i}"]`).tap();
    await page.locator(".pad .key").nth(Number(solution[i]) - 1).tap();
  }
  await page.waitForTimeout(1500);
}
export async function seedVeteran(engine, file) {
  const b = await launch(engine);
  const ctx = await newCtx(b, engine);
  const page = await ctx.newPage();
  for (const [d, m] of [
    ["2026-09-25", "part"],
    ["2026-09-28", "full"],
    ["2026-09-29", "full"],
    ["2026-09-30", "full"],
    ["2026-10-01", "full"],
  ]) {
    await playDay(b, ctx, page, d, m);
    console.log("seed", d, m);
  }
  const { writeFileSync } = await import("node:fs");
  await page.waitForTimeout(800);
  await page.close(); // PD-217: дамп — когда приложение уже ничего не пишет
  writeFileSync(file, JSON.stringify(await snapshotProfile(ctx)));
  await b.close();
}
