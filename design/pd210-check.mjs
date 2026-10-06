/**
 * PD-210 — финальный визуал «Фонаря» (C «Туман», глубина 2, осмотр b, Year A) на РЕАЛЬНОЙ сборке, chromium + webkit.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5210 --strictPort
 *   PD_PW_HOME=/tmp/pundoku-qa/pw BASE=http://localhost:5210 node design/pd210-check.mjs
 *   (CR_ONLY=1 / WK_ONLY=1 — один движок; PERF=0 — без замера кадров; CFG=0,3 — только эти конфиги chromium, без Year)
 *
 * Сценарий на конфиг: хаб (порядок, первое предложение правила в строке) → шит (правило §6 целиком) → партия в темноте
 * (строка «Коснитесь клетки…», всё в тумане) → свои цифры и заметки → свет в центре / в углу: в тени своих цифр и заметок НЕТ в
 * DOM (пятно без текста), подписи VO «в тени»/«заметки, в тени», ни одного `filter` на поле, туман масштабируется от клетки →
 * удержание: < 0,45 с — нет, > 0,45 с — осмотр b (цифры читаются, контраст ≥ 4.5:1, граница света видна: is-peek), чип «Осмотр»,
 * строка удержания; отпустил — фонарь на месте → ⋯ «Осмотреть доску» → строка + «Готово» (44 pt, не налезает на поле/пад) →
 * «Готово» → Reduce Motion: переход 0 с. Год: строка «Режим · Фонарь», знака на полотне нет. Переполнения подписи/строки нет,
 * поле ≥ 150 px. Замер кадров смены выбора: классика / Фонарь (туман) / осмотр / осмотр + настоящий filter: blur (для сравнения).
 * Кадры: design/pd210-shots/. Браузеры — в finally.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const { solve, litCells } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);

const BASE = process.env.BASE ?? "http://localhost:5210";
const PERF = process.env.PERF !== "0";
const OUT = join(HERE, "pd210-shots");
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.WK_ONLY ? "wk" : process.env.CR_ONLY ? "cr" : null;
for (const f of readdirSync(OUT)) if (/^(cr|wk)-.*\.png$/.test(f) && (!ONLY || f.startsWith(ONLY + "-"))) rmSync(join(OUT, f), { force: true });

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localDate();
const seedRun = spawnSync("pnpm", ["exec", "tsx", "../../design/pd210-seed.ts", TODAY], { cwd: join(HERE, "../apps/api"), encoding: "utf8", maxBuffer: 64 << 20 });
if (seedRun.status !== 0) {
  console.error(seedRun.stderr);
  process.exit(1);
}
const SEED = JSON.parse(seedRun.stdout);

const results = [];
const perf = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

/** Конфиги партии. `shots` — снимать кадры; `perf` — замер кадров; `hub` — проверки хаба/шита. */
const CONFIGS = [
  { w: 390, h: 844, scheme: "light", lang: "en", shots: true, perf: true, hub: true },
  { w: 390, h: 844, scheme: "dark", lang: "ru", shots: true },
  { w: 320, h: 568, scheme: "light", lang: "uk", shots: true },
  { w: 320, h: 568, scheme: "light", lang: "ru", ax3: true, shots: true },
  { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true, shots: true },
  { w: 390, h: 844, scheme: "light", lang: "en", ax3: true, shots: true },
  { w: 390, h: 844, scheme: "dark", lang: "en", rm: true, shots: true },
];
const WK = [CONFIGS[0], CONFIGS[1], CONFIGS[3], CONFIGS[4]];
const YEAR = [
  { w: 390, h: 844, scheme: "light", lang: "en" },
  { w: 390, h: 844, scheme: "dark", lang: "ru" },
  { w: 320, h: 568, scheme: "light", lang: "uk", ax3: true },
];
const T = {
  en: {
    list: "Your digits and notes show only in the row, column and box of the selected cell.",
    desc: "Your digits and notes show only in the row, column and box of the selected cell. Givens stay visible. Touch and hold the board to see it all.",
    shadow: "in shadow", notes: "notes, in shadow", empty: "empty", chip: "Lantern", insp: "Inspecting", mode: "Mode", year: "Lantern",
  },
  uk: {
    list: "Ваші цифри й нотатки видно лише в рядку, стовпці та блоці вибраної клітинки.",
    desc: "Ваші цифри й нотатки видно лише в рядку, стовпці та блоці вибраної клітинки. Дані цифри видно завжди. Утримуйте палець на полі, щоб побачити все.",
    shadow: "у тіні", notes: "нотатки, у тіні", empty: "порожня", chip: "Ліхтар", insp: "Огляд", mode: "Режим", year: "Ліхтар",
  },
  ru: {
    list: "Ваши цифры и заметки видны только в строке, столбце и блоке выбранной клетки.",
    desc: "Ваши цифры и заметки видны только в строке, столбце и блоке выбранной клетки. Данные цифры видны всегда. Удерживайте палец на поле, чтобы увидеть всё.",
    shadow: "в тени", notes: "заметки, в тени", empty: "пуст", chip: "Фонарь", insp: "Осмотр", mode: "Режим", year: "Фонарь",
  },
};

async function open(browser, c, days = null) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[c.lang],
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
    { lang: c.lang, ax3: !!c.ax3 },
  );
  const page = await ctx.newPage();
  const errs = [];
  const NOISE = /access control checks|Failed to load resource|\/api\/|ERR_CONNECTION|404|net::|Load failed|Could not connect/;
  page.on("pageerror", (e) => {
    if (!NOISE.test(e.message)) errs.push(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text());
  });
  if (days) {
    await page.goto(`${BASE}/manifest.webmanifest`);
    await page.evaluate(async ({ days, firstUse }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("pundoku", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("kv");
          r.result.createObjectStore("days", { keyPath: "date" });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction(["days", "kv"], "readwrite");
        for (const d of days) tx.objectStore("days").put(d);
        tx.objectStore("kv").put(firstUse, "meta:firstUseDate");
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    }, { days, firstUse: days.map((d) => d.date).sort()[0] });
  }
  return { ctx, page, errs };
}

const BOARD = ".play:not(.today) .board";
const cellSel = (i) => `${BOARD} .cell[data-i="${i}"]`;
async function toHub(page) {
  await page.goto(`${BASE}/#/play`);
  for (let k = 0; k < 4; k++) {
    if (await page.locator('[data-testid="mode-lantern"]').isVisible().catch(() => false)) break;
    await page.waitForTimeout(600);
    if (!(await page.locator('[data-testid="mode-lantern"]').isVisible().catch(() => false))) await page.locator("#tab-play").click();
  }
  await page.locator('[data-testid="mode-lantern"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
}
/** Подсказки по DOM (своих цифр на старте нет). */
const givens = (page) =>
  page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d.given")?.textContent?.trim() || "0";
    return out.join("");
  }, BOARD);
const state = (page) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel);
    const cls = (k) => [...b.querySelectorAll(`.cell.${k}`)].map((c) => Number(c.getAttribute("data-i")));
    return {
      lantern: b.getAttribute("data-lantern"),
      lit: cls("is-lit"),
      shadow: cls("is-shadow"),
      peek: cls("is-peek"),
      sel: Number(b.querySelector('.cell[aria-current="true"]')?.getAttribute("data-i") ?? -1),
      chip: document.querySelector('[data-testid="mode-chip"]')?.getAttribute("data-inspecting") === "true" ? "insp" : "lantern",
      status: document.querySelector('[data-testid="lantern-status"]')?.getAttribute("data-kind") ?? "left",
    };
  }, BOARD);
const tapCell = (page, i) => page.locator(cellSel(i)).click();
async function place(page, i, d) {
  await tapCell(page, i);
  await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
}
async function notes(page, i, ds) {
  await tapCell(page, i);
  await page.locator(".play:not(.today) .actions .act").nth(0).click();
  for (const d of ds) await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
  await page.locator(".play:not(.today) .actions .act").nth(0).click();
}

/** Утечки и вид тени: текст клеток тени, подписи, фильтры, туман. */
const shadowAudit = (page, sol) =>
  page.evaluate(
    ({ sel, sol }) => {
      const b = document.querySelector(sel);
      const bad = [];
      let fogD = 0;
      let fogM = 0;
      const ratios = [];
      for (const c of b.querySelectorAll(".cell.is-shadow")) {
        const i = Number(c.getAttribute("data-i"));
        const given = c.querySelector(".d.given")?.textContent ?? "";
        if (c.textContent !== given) bad.push(`text r${i}:${c.textContent}`);
        if (c.hasAttribute("title") || c.querySelector("[title]")) bad.push(`title r${i}`);
        const lab = c.getAttribute("aria-label") ?? "";
        const tail = lab.split(", ").slice(2).join(", ");
        if (!given && /\d/.test(tail)) bad.push(`label r${i}:${lab}`);
        const f = c.querySelector(".d.fog");
        if (f) {
          fogD++;
          if (!getComputedStyle(f).backgroundImage.includes("radial-gradient")) bad.push(`fog bg r${i}`);
          ratios.push(f.getBoundingClientRect().width / c.getBoundingClientRect().width);
        }
        if (c.querySelector(".marks.fog")) fogM++;
      }
      const filters = [...b.querySelectorAll(".d, .marks")].filter((e) => getComputedStyle(e).filter !== "none").length;
      const givenShadow = [...b.querySelectorAll(".cell.is-shadow .d.given")].map((e) => getComputedStyle(e)).filter((cs) => cs.opacity !== "1" || cs.filter !== "none").length;
      // Весь текст поля (как при копировании/печати): свои цифры — только в свете.
      const lit = new Set([...b.querySelectorAll(".cell.is-lit")].map((c) => Number(c.getAttribute("data-i"))));
      let leaked = 0;
      for (const c of b.querySelectorAll(".cell")) {
        const i = Number(c.getAttribute("data-i"));
        if (lit.has(i)) continue;
        const p = c.querySelector(".d.player:not(.fog)");
        if (p && p.textContent === sol[i]) leaked++;
      }
      const sorted = ratios.sort((a, b) => a - b);
      return { bad, fogD, fogM, filters, givenShadow, leaked, ratio: sorted.length ? sorted[sorted.length >> 1] : 0, userSelect: getComputedStyle(b).webkitUserSelect || getComputedStyle(b).userSelect };
    },
    { sel: BOARD, sol },
  );

/** Контраст своей цифры при осмотре к поверхности клетки (цвет color-mix → color(srgb …) или rgb()). */
const peekContrast = (page, i) =>
  page.evaluate((s) => {
    const parse = (str) => {
      let m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(str);
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
      m = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)/.exec(str);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const c = document.querySelector(s);
    const d = c.querySelector(".d.player");
    const cs = getComputedStyle(d);
    const fg = parse(cs.color);
    const bg = parse(getComputedStyle(c).backgroundColor);
    if (!fg || !bg) return { ratio: 0, color: cs.color, bg: getComputedStyle(c).backgroundColor };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { ratio: (a + 0.05) / (b + 0.05), text: d.textContent, halo: cs.textShadow !== "none", color: cs.color };
  }, cellSel(i));

/** Подпись/строка статуса/поле: переполнения, размер поля, «Готово». */
const fit = (page) =>
  page.evaluate((sel) => {
    const g = document.querySelector(".play:not(.today) .gap");
    const st = g?.querySelector(".lantern-status") ?? g?.querySelector(".status");
    const gr = g.getBoundingClientRect();
    const sub = document.querySelector(".play:not(.today) .subline");
    const board = document.querySelector(sel).getBoundingClientRect();
    const pad = document.querySelector(".play:not(.today) .pad")?.getBoundingClientRect();
    const kids = st ? [...st.children].filter((e) => e.getBoundingClientRect().width > 2) : [];
    const over = kids.some((e) => {
      const r = e.getBoundingClientRect();
      return r.left < gr.left - 0.5 || r.right > gr.right + 0.5;
    });
    const short = st?.querySelector(".ls-short");
    const ell = !!short && short.getBoundingClientRect().width > 2 && short.scrollWidth > short.clientWidth + 1;
    const d = st?.querySelector(".ls-done")?.getBoundingClientRect();
    const chip = document.querySelector('[data-testid="mode-chip"]')?.getBoundingClientRect();
    return {
      field: Math.round(board.width),
      subOver: sub.scrollWidth > sub.clientWidth + 1 || (chip ? chip.right > sub.getBoundingClientRect().right + 0.5 : false),
      over,
      ell,
      lines: st ? Math.round(st.getBoundingClientRect().height / parseFloat(getComputedStyle(st).lineHeight || "20")) : 0,
      done: d ? { h: Math.round(d.height), w: Math.round(d.width), clearBoard: d.top >= board.bottom - 0.5, clearPad: !pad || d.bottom <= pad.top + 0.5 } : null,
      text: (st?.innerText ?? "").replace(/\s+/g, " ").trim(),
    };
  }, BOARD);

/** Время от клика по клетке до второго кадра (мс) по списку клеток: медиана / p90 / max. */
const frames = (page, cells) =>
  page.evaluate(
    async ({ sel, cells }) => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      const out = [];
      const sync = [];
      for (const i of cells) {
        const el = document.querySelector(`${sel} .cell[data-i="${i}"]`);
        await raf();
        const t0 = performance.now();
        el.click();
        void document.body.offsetHeight; // стиль + раскладка синхронно
        sync.push(performance.now() - t0);
        await raf();
        await raf();
        out.push(performance.now() - t0);
      }
      const st = (a) => {
        const s = [...a].sort((x, y) => x - y);
        return { med: +s[s.length >> 1].toFixed(1), p90: +s[Math.floor(s.length * 0.9)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
      };
      return { frame: st(out), sync: st(sync) };
    },
    { sel: BOARD, cells },
  );

async function startMode(page, mode) {
  await page.locator(`[data-testid="mode-${mode}"]`).click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator('[data-testid="difficulty-easy"]').click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(700);
}

async function flow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}${c.rm ? "-rm" : ""}`;
  const shot = (s) => join(OUT, `${tag}-${s}.png`);
  const L = T[c.lang];
  try {
    const { page, errs } = await open(browser, c);
    await toHub(page);
    if (c.hub) {
      const rows = await page.locator(".hub-row.mode").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      ok(`${tag} хаб: Классика, Чернила, Лжец, Мелодия, Фонарь, Глифы`, JSON.stringify(rows) === JSON.stringify(["mode-classic", "mode-ink", "mode-liar", "mode-melody", "mode-lantern", "mode-glyphs"]), rows.join(","));
    }
    const listDesc = (await page.locator('[data-testid="mode-desc-lantern"]').textContent().catch(() => "")) ?? "";
    ok(`${tag} строка списка: первое предложение правила`, listDesc.trim() === L.list, listDesc);
    await page.locator('[data-testid="mode-lantern"]').click();
    await page.locator('[data-testid="sheet-start"]').waitFor();
    await page.waitForTimeout(400);
    const desc = await page.locator('[data-testid="mode-desc"]').textContent();
    ok(`${tag} шит: правило §6 целиком`, desc?.trim() === L.desc, desc);
    if (c.shots) await page.screenshot({ path: shot("sheet") });
    await page.locator('[data-testid="difficulty-easy"]').click();
    const t0 = Date.now();
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(700);
    ok(`${tag} партия: настоящая генерация`, true, `${Date.now() - t0} мс`);

    let st = await state(page);
    ok(`${tag} старт: темно, строка «нет выбора», чип «${L.chip}»`, st.lantern === "dark" && st.shadow.length === 81 && st.status === "dark" && st.chip === "lantern", JSON.stringify({ l: st.lantern, sh: st.shadow.length, s: st.status }));
    let f = await fit(page);
    ok(`${tag} нет выбора: строка без переполнения, подпись в одну строку, поле ≥ 150`, !f.over && !f.subOver && f.field >= 150, JSON.stringify(f));

    const g = await givens(page);
    const sol = solve(g).join("");
    const empty = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
    // Свои цифры по всему полю (≈ 2 на блок) и заметки в 3 клетках — как в макете.
    const byBox = new Map();
    for (const i of empty) {
      const b = 3 * Math.floor(Math.floor(i / 9) / 3) + Math.floor((i % 9) / 3);
      if (!byBox.has(b)) byBox.set(b, []);
      byBox.get(b).push(i);
    }
    const mine = [];
    const noted = [];
    for (const [, cells] of byBox) {
      mine.push(...cells.slice(0, 2));
      if (noted.length < 4 && cells[3] !== undefined) noted.push(cells[3]);
    }
    for (const i of mine) await place(page, i, Number(sol[i]));
    for (const i of noted) await notes(page, i, [Number(sol[i]), (Number(sol[i]) % 9) + 1]);

    // Свет в центре.
    await tapCell(page, 40);
    await page.waitForTimeout(450);
    st = await state(page);
    ok(`${tag} свет = строка/столбец/блок центра (21), остальное в тени (60)`, st.lantern === "lit" && JSON.stringify([...st.lit].sort((a, b) => a - b)) === JSON.stringify([...litCells(40)]) && st.shadow.length === 60);
    const a = await shadowAudit(page, sol);
    ok(`${tag} утечки: в тени нет текста своих цифр/заметок, нет title, подписи без цифр`, a.bad.length === 0 && a.leaked === 0, a.bad.slice(0, 4).join(" | "));
    ok(`${tag} туман: пятна цифр и заметок есть (градиент), ни одного filter на поле, подсказки в тени не тронуты`, a.fogD > 0 && a.fogM > 0 && a.filters === 0 && a.givenShadow === 0, JSON.stringify({ d: a.fogD, m: a.fogM, f: a.filters, g: a.givenShadow }));
    ok(`${tag} туман масштабируется от клетки (пятно ≈ 0.45 стороны)`, a.ratio > 0.36 && a.ratio < 0.54, a.ratio.toFixed(3));
    ok(`${tag} поле без выделения текста (user-select: none)`, a.userSelect === "none", a.userSelect);
    const shadowMine = mine.find((i) => st.shadow.includes(i));
    const shadowNote = noted.find((i) => st.shadow.includes(i));
    const lbl = await page.locator(cellSel(shadowMine)).getAttribute("aria-label");
    const lblN = shadowNote !== undefined ? await page.locator(cellSel(shadowNote)).getAttribute("aria-label") : `x, x, ${L.notes}`;
    ok(`${tag} VoiceOver: «${L.shadow}» / «${L.notes}»`, lbl.endsWith(`, ${L.shadow}`) && lbl.split(", ").length === 3 && lblN.endsWith(`, ${L.notes}`), `${lbl} | ${lblN}`);
    const trans = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).transitionDuration, `${BOARD} .cell.is-lit .d.player, ${BOARD} .cell .d.fog`);
    if (c.rm) ok(`${tag} Reduce Motion: переход света 0 с`, /^0s$/.test(trans), trans);
    else ok(`${tag} переход света 160 мс (только opacity)`, /0\.16s|160ms/.test(trans), trans);
    f = await fit(page);
    ok(`${tag} свет: строка «осталось N», подпись без переполнения`, !f.subOver && (await state(page)).status === "left", f.text);
    if (c.shots) await page.screenshot({ path: shot("center") });

    // Угол.
    await tapCell(page, 0);
    await page.waitForTimeout(450);
    st = await state(page);
    ok(`${tag} свет в углу`, JSON.stringify([...st.lit].sort((x, y) => x - y)) === JSON.stringify([...litCells(0)]));
    if (c.shots) await page.screenshot({ path: shot("corner") });
    await tapCell(page, 40);
    await page.waitForTimeout(300);
    st = await state(page);

    // Удержание: < 0,45 с — нет; > 0,45 с — осмотр b.
    const target = st.shadow.find((i) => !mine.includes(i) && !noted.includes(i));
    const tb = await page.locator(cellSel(target)).boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const early = (await state(page)).lantern;
    await page.waitForTimeout(400);
    const held = await state(page);
    const peekCell = mine.find((i) => held.peek.includes(i));
    const pc = await peekContrast(page, peekCell);
    ok(`${tag} удержание: 0,3 с — ещё нет, 0,7 с — осмотр`, early !== "inspect" && held.lantern === "inspect", `${early} → ${held.lantern}`);
    ok(`${tag} осмотр b: тень помечена is-peek (60), свет как был (21), тумана нет`, held.peek.length === 60 && held.lit.length === 21 && held.shadow.length === 0 && (await page.locator(`${BOARD} .fog`).count()) === 0);
    ok(`${tag} осмотр b: своя цифра тени читается (${sol[peekCell]}), контраст ≥ 4.5:1, ореол тумана`, pc.text === sol[peekCell] && pc.ratio >= 4.5 && pc.halo, JSON.stringify(pc));
    ok(`${tag} удержание: чип «${L.insp}», строка удержания`, held.chip === "insp" && held.status === "hold");
    f = await fit(page);
    ok(`${tag} удержание: строка и подпись без переполнения`, !f.over && !f.subOver, JSON.stringify(f));
    if (c.shots) await page.screenshot({ path: shot("hold") });
    await page.mouse.up();
    await page.waitForTimeout(400);
    st = await state(page);
    ok(`${tag} отпустил — туман вернулся, фонарь на месте`, st.lantern === "lit" && st.shadow.length === 60 && st.sel === 40 && st.chip === "lantern", `sel=${st.sel}`);

    // ⋯ «Осмотреть доску».
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-inspect"]').waitFor();
    await page.waitForTimeout(350);
    if (c.shots && !c.ax3) await page.screenshot({ path: shot("menu") });
    await page.locator('[data-testid="menu-inspect"]').click();
    await page.waitForTimeout(450);
    st = await state(page);
    f = await fit(page);
    ok(`${tag} ⋯ → осмотр: строка «осмотр» + «Готово», чип «${L.insp}»`, st.lantern === "inspect" && st.status === "menu" && st.chip === "insp" && !!f.done, f.text);
    ok(`${tag} «Готово» ≥ 44 pt, не налезает на поле/пад, строка/подпись без переполнения`, f.done && f.done.h >= 44 && f.done.clearBoard && f.done.clearPad && !f.over && !f.subOver && f.field >= 150, JSON.stringify(f));
    if (c.shots) await page.screenshot({ path: shot("inspect-menu") });
    await page.locator('[data-testid="inspect-done"]').click();
    await page.waitForTimeout(400);
    ok(`${tag} «Готово» — туман вернулся`, (await state(page)).lantern === "lit");

    // Замер кадров (только конфиг perf): Фонарь — туман; осмотр — is-peek; осмотр + настоящий filter: blur (как альтернатива).
    if (c.perf && PERF) {
      const seq = [40, 0, 80, 8, 72, 30, 50, 12, 68, 4, 44, 76, 36, 20, 60, 2, 78, 41, 39, 13, 67, 31, 49, 22];
      const fog = await frames(page, seq);
      await page.locator('[data-testid="more-button"]').click();
      await page.locator('[data-testid="menu-inspect"]').click();
      await page.waitForTimeout(400);
      // В осмотре тап по полю заканчивает осмотр — меряем смену выбора с клавиатуры (стрелки), а не кликом.
      const arrows = async () =>
        page.evaluate(async (sel) => {
          const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
          const b = document.querySelector(sel);
          const out = [];
          const keys = ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
          for (let k = 0; k < 24; k++) {
            await raf();
            const t0 = performance.now();
            b.dispatchEvent(new KeyboardEvent("keydown", { key: keys[k % keys.length], bubbles: true }));
            await raf();
            await raf();
            out.push(performance.now() - t0);
          }
          const s = out.sort((x, y) => x - y);
          return { med: +s[s.length >> 1].toFixed(1), p90: +s[Math.floor(s.length * 0.9)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
        }, BOARD);
      await page.locator(cellSel(40)).focus().catch(() => {});
      const peek = await arrows();
      await page.addStyleTag({ content: `${BOARD} .cell.is-peek .d.player{filter:blur(calc(var(--s) * 0.11)) opacity(0.32) !important;text-shadow:none !important}` });
      await page.waitForTimeout(300);
      const blur = await arrows();
      if (c.shots) await page.screenshot({ path: shot("perf-filter-blur-compare") });
      // Вкл/выкл осмотра (весь туман ↔ цифры): «Готово» → кадр.
      const toggle = await page.evaluate(async () => {
        const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
        const t0 = performance.now();
        document.querySelector('[data-testid="inspect-done"]').click();
        await raf();
        await raf();
        return +(performance.now() - t0).toFixed(1);
      });
      // Классика: та же плотность своих цифр.
      await page.goto(`${BASE}/#/play`);
      await page.waitForTimeout(500);
      await toHub(page);
      await startMode(page, "classic");
      const g2 = await givens(page);
      const sol2 = solve(g2).join("");
      const empty2 = [...g2].flatMap((ch, i) => (ch === "0" ? [i] : []));
      for (const i of empty2.filter((_, k) => k % 3 === 0).slice(0, mine.length)) await place(page, i, Number(sol2[i]));
      const classic = await frames(page, seq);
      perf.push({ engine: name, tag, classic, fog, peekArrows: peek, peekFilterBlurArrows: blur, inspectOffMs: toggle });
      ok(`${tag} замер кадров (см. pd210-perf.json)`, true, JSON.stringify({ classic: classic.frame, fog: fog.frame, peek, blur, toggle }));
    }
    ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
  } finally {
    await browser.close();
  }
}

async function yearFlow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}`;
  const L = T[c.lang];
  try {
    const { page, errs } = await open(browser, c, SEED.year);
    await page.goto(`${BASE}/#/year`);
    await page.locator(".year-month").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(700);
    const cls = (d) => page.locator(`.year-month .ymark[data-date="${d}"]`).getAttribute("class");
    const [lc, pc] = [await cls(SEED.lanternDate), await cls(SEED.plainDate)];
    ok(`${tag} Year A: у дня Фонаря на полотне нет своего знака (как у обычного)`, lc === pc, `${lc} | ${pc}`);
    const month = Number(SEED.lanternDate.slice(5, 7)) - 1;
    await page.locator(`.year-month[data-month="${month}"]`).click();
    await page.locator('[data-testid="month-page"]').waitFor();
    await page.waitForTimeout(400);
    await page.locator(`.ycell[data-date="${SEED.lanternDate}"]`).click();
    await page.locator('[data-testid="lantern-mode-row"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(450);
    const row = await page.locator('[data-testid="lantern-mode-row"]').evaluate((r) => [r.querySelector("dt").textContent, r.querySelector("dd").textContent]);
    ok(`${tag} лист дня: «${L.mode} · ${L.year}»`, row[0] === L.mode && row[1] === L.year, row.join(" · "));
    await page.screenshot({ path: join(OUT, `${tag}-year-day.png`) });
    await page.locator(".ysheet .back").click().catch(() => {});
    await page.waitForTimeout(350);
    await page.locator(`.ycell[data-date="${SEED.plainDate}"]`).click();
    await page.waitForTimeout(500);
    ok(`${tag} обычный день — без строки режима`, (await page.locator('[data-testid="lantern-mode-row"]').count()) === 0);
    ok(`${tag} Year: консоль чистая`, errs.length === 0, errs.join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  if (ONLY !== "wk") {
    for (const [k, c] of CONFIGS.entries()) if (!process.env.CFG || process.env.CFG.split(",").includes(String(k))) await flow("cr", chromium, c);
    if (!process.env.CFG) for (const c of YEAR) await yearFlow("cr", chromium, c);
  }
  if (ONLY !== "cr") {
    for (const c of WK) await flow("wk", webkit, c);
    await yearFlow("wk", webkit, YEAR[0]);
  }
} finally {
  if (perf.length) writeFileSync(join(OUT, `pd210-perf${ONLY ? "-" + ONLY : ""}.json`), JSON.stringify(perf, null, 2));
  const failed = results.filter((r) => !r.cond);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("FAILED:\n" + failed.map((f) => "  " + f.name).join("\n"));
    process.exitCode = 1;
  }
}
