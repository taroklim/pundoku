/**
 * PD-230 — заметки в тени Фонаря без позиционного узора (дефект QA PD-211: одиночная заметка читалась по месту размытого пятна
 * в сетке 3×3). На РЕАЛЬНОЙ сборке, chromium + webkit, масштаб iPhone (DPR 3).
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5230 --strictPort
 *   PD_PW_HOME=<каталог с node_modules/playwright> BASE=http://localhost:5230 node design/pd230-check.mjs   (ENGINES=cr,wk)
 *
 * На конфиг: партия Фонаря, свет на r5c5 (40). Клетка X в тени (и угловая клетка блока Y — у `.marks` там асимметричный отступ):
 *   одиночная заметка 1..9 по очереди → кадр клетки в тени → попиксельная разность с той же пустой клеткой: центр масс пятна,
 *   max ΔL, «масса», рамка пятна; и разность с кадром заметки 1 — геометрия пятна одинакова (кадры совпадают попиксельно).
 *   Наборы {1,9}, {2,4,6}, все 9 — то же пятно. Критерий QA PD-211: «ячейка 3×3 центра пятна = цифра заметки» — ни для одной
 *   цифры, кроме 5 (центр). Контроль метода: та же заметка в свете — центр в своей ячейке 3×3.
 *   Fill candidates (⋯) → все клетки тени с заметками: одно и то же пятно (DOM одинаковый, центр пятна в центре клетки).
 *   DOM тени: у заметок ни цифр, ни дочерних элементов, ни struck/style; подписи VO без цифр.
 * Кадры и результаты: design/pd230-shots/. Браузеры — в finally.
 */
import { createRequire } from "node:module";
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

const BASE = process.env.BASE ?? "http://localhost:5230";
const OUT = join(HERE, "pd230-shots");
mkdirSync(OUT, { recursive: true });
const ENGINES = (process.env.ENGINES ?? "cr,wk").split(",");
for (const f of readdirSync(OUT)) if (ENGINES.some((e) => f.startsWith(e + "-"))) rmSync(join(OUT, f), { force: true });

const CONFIGS = {
  cr: [
    { w: 390, h: 844, scheme: "light", lang: "en" },
    { w: 390, h: 844, scheme: "dark", lang: "ru" },
    { w: 320, h: 568, scheme: "light", lang: "uk", ax3: true },
    { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true },
  ],
  wk: [
    { w: 390, h: 844, scheme: "light", lang: "en" },
    { w: 320, h: 568, scheme: "dark", lang: "uk", ax3: true },
  ],
};
const BOARD = ".play:not(.today) .board";
const cellSel = (i) => `${BOARD} .cell[data-i="${i}"]`;

let results = [];
const data = {};
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const info = (name, extra) => {
  results.push({ name, cond: true, info: true, extra });
  console.log(`INFO  ${name}  ${extra}`);
};

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 3,
    colorScheme: c.scheme,
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
  page.on("pageerror", (e) => !NOISE.test(e.message) && errs.push(e.message));
  page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && errs.push(m.text()));
  return { ctx, page, errs };
}
async function toHub(page) {
  await page.goto(`${BASE}/#/play`);
  for (let k = 0; k < 4; k++) {
    if (await page.locator('[data-testid="mode-lantern"]').isVisible().catch(() => false)) break;
    await page.waitForTimeout(600);
    if (!(await page.locator('[data-testid="mode-lantern"]').isVisible().catch(() => false))) await page.locator("#tab-play").click();
  }
  await page.locator('[data-testid="mode-lantern"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
}
async function startLantern(page) {
  await page.locator('[data-testid="mode-lantern"]').click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator('[data-testid="difficulty-easy"]').click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(600);
}
const givens = (page) =>
  page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d.given")?.textContent?.trim() || "0";
    return out.join("");
  }, BOARD);
const tap = (page, i) => page.locator(cellSel(i)).click();
const key = (page, d) => page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
/** Переключить заметки `ds` в клетке (выбор клетки → Notes → цифры → Notes). */
async function toggleNotes(page, i, ds) {
  await tap(page, i);
  await page.locator(".play:not(.today) .actions .act").nth(0).click();
  for (const d of ds) await key(page, d);
  await page.locator(".play:not(.today) .actions .act").nth(0).click();
}
/** Свет на 40: клетка уходит в тень, переход света (160 мс) закончен. */
async function shade(page) {
  await tap(page, 40);
  await page.waitForTimeout(450);
}
const cellDom = (page, i) =>
  page.evaluate((s) => {
    const c = document.querySelector(s);
    return { cls: c.className, html: c.innerHTML, label: c.getAttribute("aria-label"), text: c.textContent };
  }, cellSel(i));

/** Попиксельная разность ΔL двух PNG одной клетки: max ΔL, центр масс (доли клетки), масса, рамка пятна (ΔL ≥ 3). */
async function analyze(ap, buf, ref) {
  return ap.evaluate(
    async ({ a, b }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height);
      };
      const A = await load(a);
      const B = await load(b);
      const W = Math.min(A.width, B.width);
      const H = Math.min(A.height, B.height);
      const L = (D, x, y) => {
        const k = (y * D.width + x) * 4;
        return 0.2126 * D.data[k] + 0.7152 * D.data[k + 1] + 0.0722 * D.data[k + 2];
      };
      let sw = 0, sx = 0, sy = 0, max = 0;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const d = Math.abs(L(A, x, y) - L(B, x, y));
          if (d > max) max = d;
          if (d >= 3) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
          if (d < 1.5) continue;
          sw += d;
          sx += d * x;
          sy += d * y;
        }
      const r = (v) => +v.toFixed(3);
      return {
        maxDL: +max.toFixed(1),
        cx: sw ? r(sx / sw / W) : null,
        cy: sw ? r(sy / sw / H) : null,
        mass: r(sw / (W * H)),
        box: x1 < 0 ? null : [r(x0 / W), r(y0 / H), r((x1 + 1) / W), r((y1 + 1) / H)],
      };
    },
    { a: buf.toString("base64"), b: ref.toString("base64") },
  );
}
const sub3 = (cx, cy) => (cx === null ? -1 : 1 + 3 * Math.min(2, Math.floor(cy * 3)) + Math.min(2, Math.floor(cx * 3)));
const spread = (xs) => +(Math.max(...xs) - Math.min(...xs)).toFixed(3);
/** Разброс рамки пятна (ΔL ≥ 3) по сторонам: рамка по порогу дрожит на пиксель от сглаживания (кадры при этом равны до ΔL ≤ 2). */
const boxSpread = (rs) => Math.max(...[0, 1, 2, 3].map((k) => spread(rs.map((r) => r.box?.[k] ?? 9))));
const isBoxCorner = (i) => [0, 2, 6, 8].includes(3 * (Math.floor(i / 9) % 3) + ((i % 9) % 3));

async function run(bn, type, c) {
  const tag = `${bn}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""}`;
  const shot = (s) => join(OUT, `${tag}-${s}.png`);
  const browser = await type.launch();
  try {
    const { ctx, page, errs } = await open(browser, c);
    const ap = await ctx.newPage();
    await toHub(page);
    await startLantern(page);
    const g = await givens(page);
    const sol = solve(g).join("");
    const lit40 = new Set(litCells(40));
    const empties = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
    const emptyShadow = empties.filter((i) => !lit40.has(i));
    // X — клетка тени не в углу блока; Y — угловая клетка блока (асимметричный отступ `.marks`); Z — своя цифра (сравнение видимости).
    const X = emptyShadow.find((i) => !isBoxCorner(i));
    const Y = emptyShadow.find((i) => isBoxCorner(i) && i !== X);
    const Z = emptyShadow.find((i) => i !== X && i !== Y);
    const rowPeer = (i) => empties.find((j) => j !== i && j !== X && j !== Y && j !== Z && Math.floor(j / 9) === Math.floor(i / 9));
    const cellShot = (i, path) => page.locator(cellSel(i)).screenshot(path ? { path } : {});
    await shade(page);
    const ref = new Map();
    for (const i of [X, Y, Z]) ref.set(i, await cellShot(i));
    // Эталон «в свете» для контроля метода: X пустая, выбрана пустая клетка той же строки.
    const peerX = rowPeer(X);
    await tap(page, peerX);
    await page.waitForTimeout(450);
    const refLitX = await cellShot(X);

    const res = { X, Y, single: {}, singleY: {}, sets: {}, lit: {}, fill: null };
    /** Одиночная заметка d в клетке i: кадр в тени, разбор, DOM; затем заметка снимается. */
    const single = async (i, d, store, save) => {
      await toggleNotes(page, i, [d]);
      await shade(page);
      const buf = await cellShot(i, save ? shot(`note${d}-${i === X ? "X" : "Y"}-shadow`) : undefined);
      const a = await analyze(ap, buf, ref.get(i));
      store[d] = { ...a, sub: sub3(a.cx, a.cy), dom: await cellDom(page, i), buf };
      await toggleNotes(page, i, [d]);
    };
    for (let d = 1; d <= 9; d++) await single(X, d, res.single, true);
    for (const d of [1, 3, 7, 9]) await single(Y, d, res.singleY, true);
    for (const ds of [[1, 9], [2, 4, 6], [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
      await toggleNotes(page, X, ds);
      await shade(page);
      const buf = await cellShot(X, shot(`notes${ds.join("")}-X-shadow`));
      res.sets[ds.join("")] = { ...(await analyze(ap, buf, ref.get(X))), dom: await cellDom(page, X), buf };
      await toggleNotes(page, X, ds);
    }
    // Контроль метода: одиночная заметка 1 и 9 в свете — центр пятна в своей ячейке 3×3.
    for (const d of [1, 9]) {
      await toggleNotes(page, X, [d]);
      await tap(page, peerX);
      await page.waitForTimeout(450);
      const a = await analyze(ap, await cellShot(X, shot(`note${d}-X-lit`)), refLitX);
      res.lit[d] = sub3(a.cx, a.cy);
      await toggleNotes(page, X, [d]);
    }
    // Своя цифра в тени (видимость пятна для сравнения).
    await tap(page, Z);
    await key(page, Number(sol[Z]));
    await shade(page);
    const own = await analyze(ap, await cellShot(Z, shot("own-digit-shadow")), ref.get(Z));

    const S = Object.values(res.single);
    const base = res.single[1];
    const pixX = [];
    for (let d = 2; d <= 9; d++) pixX.push((await analyze(ap, res.single[d].buf, base.buf)).maxDL);
    const pixY = [];
    for (const d of [3, 7, 9]) pixY.push((await analyze(ap, res.singleY[d].buf, res.singleY[1].buf)).maxDL);
    const pixSets = [];
    for (const s of Object.values(res.sets)) pixSets.push((await analyze(ap, s.buf, base.buf)).maxDL);
    info(
      `${tag} одиночная заметка 1..9 в тени (X=r${Math.floor(X / 9) + 1}c${(X % 9) + 1})`,
      S.map((r, k) => `${k + 1}:(${r.cx},${r.cy}) ΔL${r.maxDL}`).join(" "),
    );
    ok(
      `${tag} геометрия пятна одинакова для заметок 1..9: центр (разброс ≤ 0,01), рамка, масса`,
      spread(S.map((r) => r.cx)) <= 0.01 && spread(S.map((r) => r.cy)) <= 0.01 && boxSpread(S) <= 0.02 && spread(S.map((r) => r.mass)) <= 0.01,
      `разброс cx ${spread(S.map((r) => r.cx))}, cy ${spread(S.map((r) => r.cy))}, рамки ${boxSpread(S)}, массы ${spread(S.map((r) => r.mass))}; рамка ${JSON.stringify(base.box)}`,
    );
    ok(`${tag} кадры клетки с заметкой 2..9 попиксельно = кадру с заметкой 1 (max ΔL ≤ 2)`, Math.max(...pixX) <= 2, `max ΔL ${Math.max(...pixX)}`);
    ok(`${tag} наборы {1,9}, {2,4,6}, все 9 — то же пятно (max ΔL ≤ 2 к заметке 1)`, Math.max(...pixSets) <= 2, `max ΔL ${pixSets.join("/")}`);
    ok(`${tag} угловая клетка блока Y (r${Math.floor(Y / 9) + 1}c${(Y % 9) + 1}): заметки 1/3/7/9 — один кадр`, Math.max(...pixY) <= 2, `max ΔL ${pixY.join("/")}; центр ${res.singleY[1].cx},${res.singleY[1].cy}`);
    const readable = S.filter((r, k) => r.sub === k + 1 && k + 1 !== 5).length;
    ok(`${tag} критерий QA PD-211: заметка не читается по месту пятна (центр во всех 9 случаях — ячейка 5)`, readable === 0 && S.every((r) => r.sub === 5), S.map((r, k) => `${k + 1}→${r.sub}`).join(" "));
    ok(`${tag} контроль метода: в свете заметка 1 / 9 — в своей ячейке 3×3`, res.lit[1] === 1 && res.lit[9] === 9, `1→${res.lit[1]} 9→${res.lit[9]}`);
    const doms = [...S, ...Object.values(res.sets)].map((r) => r.dom.cls + "|" + r.dom.html + "|" + r.dom.label);
    ok(`${tag} DOM клетки тени одинаков для всех наборов заметок, без цифр`, new Set(doms).size === 1 && S.every((r) => r.dom.text === ""), base.dom.html);
    ok(`${tag} «видно, что клетка с заметками»: пятно заметок заметно (ΔL ≥ 6), слабее своей цифры`, base.maxDL >= 6 && base.maxDL < own.maxDL, `заметки ΔL ${base.maxDL}, своя цифра ΔL ${own.maxDL}`);

    // Fill candidates: эталоны пустых клеток тени до заполнения.
    const fillCells = emptyShadow.filter((i) => ![X, Y, Z].includes(i)).slice(0, 10);
    const refFill = new Map();
    for (const i of fillCells) refFill.set(i, await cellShot(i));
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-fill"]').click();
    await page.waitForTimeout(500);
    await shade(page);
    const dom = await page.evaluate((sel) => {
      const b = document.querySelector(sel);
      const shadowNoted = [...b.querySelectorAll(".cell.is-shadow")].filter((c) => c.querySelector(".marks"));
      const bad = [];
      for (const c of b.querySelectorAll(".cell.is-shadow")) {
        const m = c.querySelector(".marks");
        if (!m) continue;
        if (!m.classList.contains("spot") || m.children.length || m.textContent !== "" || m.hasAttribute("style")) bad.push(c.getAttribute("data-i"));
        if (c.querySelector(".struck, [style]")) bad.push("s" + c.getAttribute("data-i"));
        if (/\d/.test((c.getAttribute("aria-label") ?? "").split(", ").slice(2).join(", "))) bad.push("label" + c.getAttribute("data-i"));
      }
      const fs = getComputedStyle(b.querySelector(".cell.is-shadow .marks.spot") ?? b).filter;
      return { n: shadowNoted.length, kinds: new Set(shadowNoted.map((c) => c.innerHTML)).size, bad, filter: fs };
    }, BOARD);
    const fillA = [];
    for (const i of fillCells) fillA.push({ i, ...(await analyze(ap, await cellShot(i, fillA.length < 3 ? shot(`fill-r${Math.floor(i / 9) + 1}c${(i % 9) + 1}`) : undefined), refFill.get(i))) });
    await page.locator(BOARD).screenshot({ path: shot("fill-board") });
    res.fill = { dom, cells: fillA };
    ok(
      `${tag} Fill candidates: ${dom.n} клеток тени с заметками — один вид DOM, без цифр/struck/style, filter blur+opacity`,
      dom.n > 20 && dom.kinds === 1 && dom.bad.length === 0 && /blur\(/.test(dom.filter) && /opacity\(/.test(dom.filter),
      JSON.stringify({ kinds: dom.kinds, bad: dom.bad.slice(0, 4), filter: dom.filter }),
    );
    // Центр — с точностью до пикселя кадра (на AX3 320 клетка ≈ 54 px при DPR 3: 1,5 px ≈ 0,03); масса зависит от размера клетки
    // (округление до пикселя по столбцам), не от заметок — только INFO.
    ok(
      `${tag} Fill candidates: центр пятна в центре клетки у всех ${fillA.length} замеренных (|c − 0,5| ≤ 0,04, ячейка 5)`,
      fillA.every((r) => Math.abs(r.cx - 0.5) <= 0.04 && Math.abs(r.cy - 0.5) <= 0.04 && sub3(r.cx, r.cy) === 5),
      fillA.map((r) => `(${r.cx},${r.cy})`).join(" "),
    );
    info(`${tag} Fill candidates: ΔL / масса по клеткам`, fillA.map((r) => `r${Math.floor(r.i / 9) + 1}c${(r.i % 9) + 1} ${r.maxDL}/${r.mass}`).join(" "));
    // Кадр верхней трети поля после заполнения + осмотр (заметки читаются) — для глаз.
    const bb = await page.locator(BOARD).boundingBox();
    await page.screenshot({ path: shot("fill-top-shadow"), clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height / 3 } });
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-inspect"]').click();
    await page.waitForTimeout(450);
    const peekText = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .cell.is-peek .marks`)].filter((m) => /\d/.test(m.textContent)).length, BOARD);
    ok(`${tag} осмотр (вид b): заметки тени снова читаются цифрами`, peekText > 20, `${peekText} клеток`);
    await page.screenshot({ path: shot("fill-top-inspect"), clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height / 3 } });
    await page.locator('[data-testid="inspect-done"]').click();
    ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
    for (const r of [...S, ...Object.values(res.singleY), ...Object.values(res.sets)]) delete r.buf;
    data[tag] = { ...res, own };
  } finally {
    await browser.close();
  }
}

const t0 = Date.now();
for (const e of ENGINES) {
  results = [];
  const type = e === "wk" ? webkit : chromium;
  for (const c of CONFIGS[e]) {
    try {
      await run(e, type, c);
    } catch (err) {
      ok(`${e}-${c.w}-${c.scheme}-${c.lang}${c.ax3 ? "-ax3" : ""} прогон без исключений`, false, String(err?.message ?? err).split("\n")[0]);
    }
  }
  const pass = results.filter((r) => r.cond && !r.info).length;
  const total = results.filter((r) => !r.info).length;
  console.log(`== ${e}: ${pass}/${total}`);
  writeFileSync(join(OUT, `results-${e}.txt`), results.map((r) => `${r.info ? "INFO" : r.cond ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "  " + r.extra : ""}`).join("\n") + `\n== ${pass}/${total}\n`);
}
writeFileSync(join(OUT, "data.json"), JSON.stringify(data, null, 1));
console.log(`время ${((Date.now() - t0) / 1000).toFixed(0)} с`);
