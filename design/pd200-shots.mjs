// PD-200: заметки в клетке с полосой «где происходит» (лесенка подсказок) — нижний ряд заметок и зачёркивание не должны
// лежать на полосе. Живая проверка на реальной сборке (vite preview), chromium + webkit, 320–430, light/dark, AX3,
// Глифы и Классика. Кадры: design/pd200-shots/<LABEL>/ (LABEL=before|after).
//   BASE=http://localhost:5299 LABEL=after node design/pd200-shots.mjs
// Playwright: PW_HOME (по умолчанию /tmp/pundoku-qa/pw). Браузер закрывается в finally.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium, webkit } = createRequire(join(process.env.PW_HOME ?? "/tmp/pundoku-qa/pw", "/"))("playwright");
const BASE = process.env.BASE ?? "http://localhost:5299";
const LABEL = process.env.LABEL ?? "after";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd200-shots", LABEL);
mkdirSync(OUT, { recursive: true });
const BROWSERS = (process.env.BROWSERS ?? "cr,wk").split(",");
const FULL = process.env.FULL !== "0";

// Позиция с ходом Locked Candidates: вычёркивание 9 в клетках 30, 39, 75 (подобрано в QA PD-195, elim.json).
const ELIM = {
  moves: [[6, 3], [26, 1], [79, 8], [28, 1], [4, 8], [17, 8], [23, 3], [5, 6], [55, 6]],
  elim: [{ cell: 30, digit: 9 }, { cell: 39, digit: 9 }, { cell: 75, digit: 9 }],
  puzzle: {
    mission: "001000000000012650080000920000030000040020700075600800008300009904068000100000406",
    solution: "251986347793412658486573921612837594849125763375694812568341279924768135137259486",
    difficulty: "hard",
    seed: "2026-09-02/hard",
  },
};
// Вторая клетка с заметками без полосы: проверяем, что её раскладка не изменилась.
const PLAIN = 0;

function stub({ puzzle }) {
  const Real = window.Worker;
  class FakeWorker {
    constructor(url, opts) { this.url = String(url); this.opts = opts; this.onmessage = null; this.dead = false; }
    postMessage(req) {
      const reply = (res) => { if (!this.dead && this.onmessage) this.onmessage({ data: res }); };
      if (req.date !== undefined || req.liar || !/generate\.worker/.test(this.url)) {
        const w = new Real(this.url, this.opts);
        w.onmessage = (e) => reply(e.data);
        w.postMessage(req);
        this.real = w;
        return;
      }
      setTimeout(() => reply({ id: req.id, ok: true, puzzle }), 30);
    }
    terminate() { this.dead = true; this.real?.terminate(); }
    addEventListener() {}
    removeEventListener() {}
  }
  window.Worker = FakeWorker;
}

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const B = ".play:not(.today) .board";

async function run(browser, bn, c) {
  const tag = `${bn}-${c.mode}-${c.w}-${c.scheme}${c.ax3 ? "-ax3" : ""}`;
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h }, deviceScaleFactor: 3, colorScheme: c.scheme, locale: "en-US", serviceWorkers: "block",
  });
  try {
    await ctx.addInitScript(stub, { puzzle: ELIM.puzzle });
    await ctx.addInitScript(({ ax3 }) => {
      try { localStorage.setItem("pundoku.locale", "en"); } catch {}
      if (ax3) {
        const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); };
        if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
      }
    }, { ax3: !!c.ax3 });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const cell = (i) => page.locator(`${B} .cell[data-i="${i}"]`);
    await page.goto(`${BASE}/#/play`);
    await page.locator(`[data-testid="mode-${c.mode}"]`).waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    await page.locator(`[data-testid="mode-${c.mode}"]`).click();
    await page.locator('[data-testid="sheet-start"]').waitFor();
    await page.waitForTimeout(350);
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator(`${B} .cell .d.given`).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(400);
    for (const [i, d] of ELIM.moves) { await cell(i).click(); await page.keyboard.press(`Digit${d}`); }
    await page.keyboard.press("KeyN");
    // В клетках вычёркивания: 9 + верная цифра (обычно «8 9» или «7 9» в нижнем ряду); в клетке без полосы — то же.
    for (const e of [...ELIM.elim, { cell: PLAIN, digit: 9 }]) {
      await cell(e.cell).click();
      await page.keyboard.press(`Digit${e.digit}`);
      await page.keyboard.press(`Digit${ELIM.puzzle.solution[e.cell]}`);
      await page.keyboard.press("Digit7");
    }
    await page.keyboard.press("KeyN");
    await page.locator('[data-testid="hint-button"]').click();
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="hint-rule-go"]').count()) await page.locator('[data-testid="hint-rule-go"]').click();
    await page.locator('[data-testid="hint-dock"]').waitFor({ timeout: 10000 });
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(300);
      if ((await page.locator('[data-testid="hint-dock"]').getAttribute("data-step")) === "4") break;
      await page.locator('[data-testid="hint-more"]').click();
    }
    await page.waitForTimeout(500);
    const geo = await page.evaluate(({ B, cells, plain }) => {
      const cv = document.createElement("canvas").getContext("2d");
      const one = (i) => {
        const c = document.querySelector(`${B} .cell[data-i="${i}"]`);
        const strip = c.querySelector(".hint-strip")?.getBoundingClientRect() ?? null;
        const marks = c.querySelector(".marks");
        const spans = [...c.querySelectorAll(".marks > span")];
        const notes = [];
        spans.forEach((s, k) => {
          if (!s.textContent && !s.querySelector("svg")) return;
          const svg = s.querySelector("svg");
          let top, bottom;
          if (svg) {
            const r = svg.getBoundingClientRect();
            top = r.top; bottom = r.bottom;
          } else {
            const range = document.createRange();
            range.selectNodeContents(s);
            const r = range.getBoundingClientRect();
            const cs = getComputedStyle(s);
            cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const m = cv.measureText(s.textContent);
            const base = r.top + m.fontBoundingBoxAscent;
            top = base - m.actualBoundingBoxAscent; bottom = base + m.actualBoundingBoxDescent;
          }
          let lineBottom = null;
          if (s.classList.contains("struck") && svg) {
            // ::after: линия ≈ 96 % ширины слота, повёрнута на −20°, 1.5 px + ободок 1 px.
            const r = s.getBoundingClientRect();
            lineBottom = r.top + r.height / 2 + (0.96 * r.width / 2) * Math.sin((20 * Math.PI) / 180) + 1.75;
          }
          notes.push({ slot: k + 1, struck: s.classList.contains("struck"), top, bottom, lineBottom });
        });
        const cr = c.getBoundingClientRect();
        return { i, strip: strip && { top: strip.top, bottom: strip.bottom, left: strip.left, right: strip.right }, cell: { top: cr.top, bottom: cr.bottom, h: cr.height }, notes, pad: getComputedStyle(marks).padding };
      };
      return { cells: cells.map(one), plain: one(plain) };
    }, { B, cells: ELIM.elim.map((e) => e.cell), plain: PLAIN });
    for (const g of geo.cells) {
      if (!g.strip) { ok(`${tag} cell${g.i}: полоса на месте`, false); continue; }
      const low = g.notes.filter((n) => n.slot >= 7);
      const inkBottom = Math.max(...low.map((n) => Math.max(n.bottom, n.lineBottom ?? -1e9)));
      const gap = g.strip.top - inkBottom;
      ok(`${tag} cell${g.i}: нижний ряд заметок и зачёркивание выше полосы (зазор ≥ 1 px)`, low.length > 0 && gap >= 1, `gap=${gap.toFixed(2)} cell=${g.cell.h.toFixed(1)} notes=${low.map((n) => n.slot + (n.struck ? "s" : "")).join(",")}`);
      const top = Math.min(...g.notes.map((n) => n.top));
      ok(`${tag} cell${g.i}: верхний ряд в клетке`, top >= g.cell.top, `top-gap=${(top - g.cell.top).toFixed(2)}`);
      // соседние ряды не наезжают друг на друга
      const rows = [1, 2, 3].map((r) => g.notes.filter((n) => Math.ceil(n.slot / 3) === r));
      for (let r = 0; r < 2; r++) {
        if (!rows[r].length || !rows[r + 1].length) continue;
        const ov = Math.max(...rows[r].map((n) => n.bottom)) - Math.min(...rows[r + 1].map((n) => n.top));
        ok(`${tag} cell${g.i}: ряды ${r + 1}/${r + 2} не пересекаются`, ov <= 0.5, `overlap=${ov.toFixed(2)}`);
      }
    }
    ok(`${tag} клетка без полосы: отступ заметок как в базе`, !geo.plain.strip, geo.plain.pad);
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(geo, null, 1));
    const bx = await cell(30).boundingBox();
    if (FULL || c.w === 320) {
      await page.screenshot({ path: join(OUT, `${tag}-zoom.png`), clip: { x: bx.x - bx.width * 0.5, y: bx.y - bx.height * 0.5, width: bx.width * 2, height: bx.height * 6 } });
    }
    for (const i of [30, 75]) {
      const b = await cell(i).boundingBox();
      await page.screenshot({ path: join(OUT, `${tag}-cell${i}.png`), clip: { x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 } });
    }
    ok(`${tag} консоль без ошибок`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

const CONFIGS = [];
for (const mode of ["glyphs", "classic"]) {
  for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]]) for (const scheme of ["light", "dark"]) CONFIGS.push({ mode, w, h, scheme });
  for (const [w, h] of [[320, 568], [430, 932]]) for (const scheme of ["light", "dark"]) CONFIGS.push({ mode, w, h, scheme, ax3: true });
}
for (const bn of BROWSERS) {
  const browser = await (bn === "wk" ? webkit : chromium).launch();
  try {
    for (const c of CONFIGS) {
      try { await run(browser, bn, c); } catch (e) { ok(`${bn} ${JSON.stringify(c)} прогон`, false, String(e).slice(0, 300)); }
    }
  } finally {
    await browser.close();
  }
}
const fail = results.filter((r) => !r.cond);
console.log(`\n${LABEL}: ${results.length - fail.length}/${results.length} PASS`);
writeFileSync(join(OUT, "results.txt"), results.map((r) => `${r.cond ? "PASS" : "FAIL"}  ${r.name}  ${r.extra}`).join("\n") + `\n${results.length - fail.length}/${results.length} PASS\n`);
process.exitCode = fail.length ? 1 : 0;
