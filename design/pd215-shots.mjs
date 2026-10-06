// PD-215: полоса «где» в нижних угловых клетках блока (7/9) с заметками не выходит за скругление бокса (R 10);
// шит правила подсказки в Глифах говорит «знак»/«shape». Живая проверка на реальной сборке (vite preview), chromium +
// webkit, 320/390, обычный и AX3, Глифы и Классика. Кадры: design/pd215-shots/.
//   BASE=http://localhost:5315 node design/pd215-shots.mjs
// Playwright: PW_HOME (по умолчанию /tmp/pundoku-qa/pw). Браузер закрывается в finally.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium, webkit } = createRequire(join(process.env.PW_HOME ?? "/tmp/pundoku-qa/pw", "/"))("playwright");
const BASE = process.env.BASE ?? "http://localhost:5315";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd215-shots");
mkdirSync(OUT, { recursive: true });
const BROWSERS = (process.env.BROWSERS ?? "cr,wk").split(",");

// Та же позиция, что в PD-200/QA PD-213: Locked Candidates, вычёркивание 9 в клетках 30, 39, 75 (75 — 7-я клетка блока).
const ELIM = {
  moves: [[6, 3], [26, 1], [79, 8], [28, 1], [4, 8], [17, 8], [23, 3], [5, 6], [55, 6]],
  elim: [30, 39, 75],
  puzzle: {
    mission: "001000000000012650080000920000030000040020700075600800008300009904068000100000406",
    solution: "251986347793412658486573921612837594849125763375694812568341279924768135137259486",
    difficulty: "hard",
    seed: "2026-09-02/hard",
  },
};
// Правый угол (9-я клетка блока) в этой позиции полосы не получает (75 — 7-я, левый нижний угол блока 7). Заметки в
// пустую клетку 74 ставить нельзя — подсказка меняется; поэтому после открытия ступени 4 копируем в 74 (блок 6, nth 9)
// заметки и полосу клетки 75 — проверяем правую сторону тем же CSS.
const OTHER = 74;

function stub({ puzzle }) {
  const Real = window.Worker;
  class FakeWorker {
    constructor(url, opts) { this.url = String(url); this.opts = opts; this.onmessage = null; this.dead = false; }
    postMessage(req) {
      const reply = (res) => { if (!this.dead && this.onmessage) this.onmessage({ data: res }); };
      if (!puzzle || req.date !== undefined || req.liar || !/generate\.worker/.test(this.url)) {
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

// Снять/вернуть только правила PD-215 (угловые клетки 7/9 с заметками).
const RULES_OFF = () => {
  const removed = [];
  [...document.styleSheets].forEach((sh, si) => {
    let rules;
    try { rules = sh.cssRules; } catch { return; }
    for (let i = rules.length - 1; i >= 0; i--) {
      const t = rules[i].selectorText || "";
      if (/nth-child\([79]\):has\(> ?\.marks\) > \.hint-strip/.test(t)) { removed.push({ si, i, css: rules[i].cssText }); sh.deleteRule(i); }
    }
  });
  window.__pd215 = (window.__pd215 || []).concat(removed);
  return removed.length;
};
const RULES_ON = () => {
  const r = (window.__pd215 || []).sort((a, b) => a.si - b.si || a.i - b.i);
  for (const x of r) document.styleSheets[x.si].insertRule(x.css, x.i);
  window.__pd215 = [];
  return r.length;
};

// Геометрия всех полос: прямоугольник относительно клетки и вылет за скругление угла (та же формула, что в QA PD-213).
const GEO = (B) => {
  const out = [];
  for (const c of document.querySelectorAll(`${B} .cell`)) {
    const st = c.querySelector(":scope > .hint-strip");
    if (!st) continue;
    const cr = c.getBoundingClientRect(), sr = st.getBoundingClientRect();
    const nth = [...c.parentElement.children].indexOf(c) + 1;
    const R = parseFloat(getComputedStyle(c).getPropertyValue("--box-radius")) || 10;
    let overhang = 0;
    if (nth === 7 || nth === 9) {
      const xIn = nth === 7 ? sr.left - cr.left : cr.right - sr.right;
      const yFromBottom = cr.bottom - sr.bottom;
      const sRad = parseFloat(getComputedStyle(st).borderTopLeftRadius) || 0;
      for (let t = 0; t <= 40; t++) {
        const px = xIn + (sRad * t) / 40, py = yFromBottom + sRad - Math.sqrt(Math.max(0, sRad * sRad - (sRad - (sRad * t) / 40) ** 2));
        if (px < R && py < R) overhang = Math.max(overhang, -(R - Math.hypot(R - px, R - py)));
      }
    }
    out.push({
      i: +c.dataset.i, nth, marks: !!c.querySelector(":scope > .marks"), sel: c.classList.contains("sel"),
      cellW: +cr.width.toFixed(2), x0: +(sr.left - cr.left).toFixed(2), x1: +(cr.right - sr.right).toFixed(2),
      bottom: +(cr.bottom - sr.bottom).toFixed(2), h: +sr.height.toFixed(2), overhang: +overhang.toFixed(3),
    });
  }
  return out;
};

async function run(browser, bn, c) {
  const tag = `${bn}-${c.mode}-${c.w}${c.ax3 ? "-ax3" : ""}`;
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 3, colorScheme: "light", locale: "en-US", serviceWorkers: "block" });
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
    for (const i of ELIM.elim) {
      await cell(i).click();
      await page.keyboard.press("Digit9");
      await page.keyboard.press(`Digit${ELIM.puzzle.solution[i]}`);
      await page.keyboard.press("Digit7");
    }
    await page.keyboard.press("KeyN");
    await cell(2).click(); // данная клетка вдали от углов: кадры «до/после» без кольца выбора на 75
    await page.locator('[data-testid="hint-button"]').click();
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="hint-rule-go"]').count()) await page.locator('[data-testid="hint-rule-go"]').click();
    await page.locator('[data-testid="hint-dock"]').waitFor({ timeout: 10000 });
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(300);
      if ((await page.locator('[data-testid="hint-dock"]').getAttribute("data-step")) === "4") break;
      await page.locator('[data-testid="hint-more"]').click();
    }
    await page.waitForTimeout(600);
    const inject = await page.evaluate(({ B, OTHER }) => {
      const src = document.querySelector(`${B} .cell[data-i="75"]`);
      const dst = document.querySelector(`${B} .cell[data-i="${OTHER}"]`);
      if (!src || !dst || dst.querySelector(":scope > .marks, :scope > .hint-strip, .d")) return false;
      dst.appendChild(src.querySelector(":scope > .marks").cloneNode(true));
      dst.appendChild(src.querySelector(":scope > .hint-strip").cloneNode(true));
      return true;
    }, { B, OTHER });
    ok(`${tag} правый угол (клетка ${OTHER}, nth 9) с заметками и полосой подготовлен`, inject);

    const after = await page.evaluate(GEO, B);
    ok(`${tag} полоса на угловой клетке 75 (nth 7) и на ${OTHER} (nth 9)`, after.some((x) => x.i === 75 && x.marks) && after.some((x) => x.i === OTHER), after.map((x) => x.i).join(","));
    const nOff = await page.evaluate(RULES_OFF);
    const before = await page.evaluate(GEO, B);
    const shot = async (name, i) => {
      const b = await cell(i).boundingBox();
      await page.screenshot({ path: join(OUT, `${tag}-${name}-cell${i}.png`), clip: { x: b.x - 3, y: b.y - 3, width: b.width + 6, height: b.height + 6 } });
    };
    for (const i of [75, OTHER]) await shot("before", i);
    ok(`${tag} правил PD-215 снято 2`, nOff === 2, `n=${nOff}`);
    ok(`${tag} правила возвращены`, (await page.evaluate(RULES_ON)) === nOff);
    await page.waitForTimeout(200);
    for (const i of [75, OTHER]) await shot("after", i);

    for (const a of after) {
      const b = before.find((x) => x.i === a.i);
      const corner = a.marks && (a.nth === 7 || a.nth === 9);
      if (a.nth === 7 || a.nth === 9) ok(`${tag} cell${a.i}(nth${a.nth}${a.marks ? ",marks" : ""}): полоса в пределах скругления`, a.overhang <= 0.05, `overhang=${a.overhang}px (было ${b.overhang}) x=${a.nth === 7 ? a.x0 : a.x1} (было ${a.nth === 7 ? b.x0 : b.x1}) cell=${a.cellW}`);
      if (!corner) ok(`${tag} cell${a.i}(nth${a.nth}): не угловая/без заметок — геометрия полосы не изменилась`, JSON.stringify(a) === JSON.stringify(b), `x0=${a.x0} x1=${a.x1}`);
      else {
        const far = a.nth === 7 ? ["x1", "bottom", "h"] : ["x0", "bottom", "h"];
        ok(`${tag} cell${a.i}: дальняя сторона, низ и высота полосы не изменились`, far.every((k) => a[k] === b[k]), far.map((k) => `${k}=${a[k]}`).join(" "));
      }
    }
    // Выбранная клетка с полосой (кольцо выбора) — то же условие.
    await cell(75).click();
    await page.waitForTimeout(300);
    const sel = (await page.evaluate(GEO, B)).find((x) => x.i === 75);
    if (sel) ok(`${tag} cell75 выбрана: полоса в пределах скругления`, sel.overhang <= 0.05, `overhang=${sel.overhang}px sel=${sel.sel}`);
    await shot("sel", 75);
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ after, before, sel }, null, 1));
    ok(`${tag} консоль без ошибок`, errs.length === 0, errs.join(" | "));
  } finally {
    await ctx.close();
  }
}

// Шит правила подсказки: ru/uk/en, Глифы и Классика (первое открытие лампочки).
async function sheet(browser, bn, lang, mode) {
  const tag = `${bn}-sheet-${lang}-${mode}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", locale: "en-US", serviceWorkers: "block" });
  try {
    await ctx.addInitScript(stub, { puzzle: ELIM.puzzle });
    await ctx.addInitScript((lang) => { try { localStorage.setItem("pundoku.locale", lang); } catch {} }, lang);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/play`);
    await page.locator(`[data-testid="mode-${mode}"]`).waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    await page.locator(`[data-testid="mode-${mode}"]`).click();
    await page.locator('[data-testid="sheet-start"]').waitFor();
    await page.waitForTimeout(350);
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator(`${B} .cell .d.given`).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="hint-button"]').click();
    await page.locator('[data-testid="hint-rule-sheet"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const text = await page.locator('[data-testid="hint-rule-sheet"]').innerText();
    const digit = lang === "en" ? /\bdigits?\b/i : /цифр/i;
    const shape = lang === "en" ? /\bshapes?\b/i : /знак/i;
    if (mode === "glyphs") ok(`${tag}: шит без «цифры», знак назван`, !digit.test(text) && shape.test(text), text.split("\n").find((l) => shape.test(l)) ?? "");
    else ok(`${tag}: Классика — шит прежний (без «знака»)`, !shape.test(text));
    await page.screenshot({ path: join(OUT, `${tag}.png`) });
  } finally {
    await ctx.close();
  }
}

const CONFIGS = [];
for (const mode of ["glyphs", "classic"]) for (const [w, h] of [[320, 568], [390, 844]]) for (const ax3 of [false, true]) CONFIGS.push({ mode, w, h, ax3 });
for (const bn of BROWSERS) {
  const browser = await (bn === "wk" ? webkit : chromium).launch();
  try {
    for (const c of CONFIGS) {
      try { await run(browser, bn, c); } catch (e) { ok(`${bn} ${JSON.stringify(c)} прогон`, false, String(e).slice(0, 300)); }
    }
    for (const lang of ["ru", "uk", "en"]) for (const mode of ["glyphs", "classic"]) {
      if (bn === "wk" && lang !== "ru") continue;
      try { await sheet(browser, bn, lang, mode); } catch (e) { ok(`${bn} sheet ${lang} ${mode}`, false, String(e).slice(0, 300)); }
    }
  } finally {
    await browser.close();
  }
}
const fail = results.filter((r) => !r.cond);
console.log(`\nPD-215: ${results.length - fail.length}/${results.length} PASS`);
writeFileSync(join(OUT, "results.txt"), results.map((r) => `${r.cond ? "PASS" : "FAIL"}  ${r.name}  ${r.extra}`).join("\n") + `\n${results.length - fail.length}/${results.length} PASS\n`);
process.exitCode = fail.length ? 1 : 0;
