// Система движения (PD-89): reduced motion живёт в ОДНОМ месте — множители `--mo`/`--mk` в tokens.css; остальные
// таблицы стилей не дублируют `@media (prefers-reduced-motion)`. Reduced-transparency и forced-colors остаются.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles");
const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
// Комментарии вырезаны: в них правило упоминается словами.
const read = (f) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("CSS движения", () => {
  it("prefers-reduced-motion объявлен ровно один раз — в tokens.css, и обнуляет --mo", () => {
    const hits = files.filter((f) => /@media\s*\(prefers-reduced-motion/.test(read(f)));
    expect(hits).toEqual(["tokens.css"]);
    expect(read("tokens.css")).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--mo:\s*0;\s*--mk:\s*0?\.72;/);
  });

  it("по умолчанию множители равны 1 и заведены кривые", () => {
    const css = read("tokens.css");
    expect(css).toMatch(/--mo:\s*1;/);
    expect(css).toMatch(/--mk:\s*1;/);
    for (const k of ["--e-out", "--e-spring", "--e-ring"]) expect(css).toContain(k);
  });

  it("PD-95: content-visibility секции Grid ∞ — только при reduced (цель полёта при движении не пропускается), печать — visible", () => {
    const tokens = read("tokens.css");
    expect(tokens).toMatch(/:root\s*\{[^}]*--cv-grid:\s*visible;/);
    expect(tokens).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{[^}]*--cv-grid:\s*auto;/);
    const today = read("today.css");
    expect(today).toMatch(/\[data-testid="grid-inf-section"\]\s*\{[^}]*content-visibility:\s*var\(--cv-grid\);[^}]*contain-intrinsic-size:\s*auto\s/);
    expect(today).toMatch(/@media print\s*\{\s*\[data-testid="grid-inf-section"\]\s*\{\s*content-visibility:\s*visible;/);
    // ни одного безусловного auto/hidden на цели полёта и на карточке
    expect(files.map(read).join("\n")).not.toMatch(/content-visibility:\s*(auto|hidden)/);
  });

  it("forced-colors и reduced-transparency не потеряны", () => {
    expect(files.some((f) => read(f).includes("forced-colors: active"))).toBe(true);
    expect(files.some((f) => read(f).includes("prefers-reduced-transparency"))).toBe(true);
  });

  it("в keyframes движения только transform/opacity/цвет: нет анимации размеров и позиции", () => {
    const css = files.map(read).join("\n");
    const kf = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]).join("\n");
    expect(kf).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
});

// --- множитель --mo: при 0 все transform в keyframes единичные (PD-94, QA PD-91: раньше ловилось только вживую) ---

/** Тела всех @keyframes (учёт вложенных скобок), пара [имя, тело]. */
function keyframes() {
  const out = [];
  for (const f of files) {
    const css = read(f);
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < css.length && depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
      out.push([m[1], css.slice(start, i - 1), f]);
    }
  }
  return out;
}

/** Числовое значение CSS-аргумента: подставляет --mo, считает calc(); единицы (px, %, ms) отбрасываются. */
function evalArg(arg, mo) {
  let expr = arg.replace(/var\(--mo\)/g, String(mo));
  expr = expr.replace(/calc\(/g, "(").replace(/(\d*\.?\d+)(px|%|ms|s|deg|em|rem)(?![a-z])/g, "$1");
  if (/var\(|[^\d+\-*/().\s]/.test(expr)) throw new Error(`не разобрал аргумент: ${arg}`);
  return Function(`"use strict"; return (${expr});`)();
}

/** Верхнеуровневые аргументы функции transform: `translateY(calc(a * b))` -> ["calc(a * b)"]. */
function transformCalls(value) {
  const calls = [];
  for (const m of value.matchAll(/\b(translate[XYZ]?|scale[XY]?|rotate|skew[XY]?)\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < value.length && depth > 0; i++) depth += value[i] === "(" ? 1 : value[i] === ")" ? -1 : 0;
    const args = [];
    let d = 0;
    let cur = "";
    for (const ch of value.slice(start, i - 1)) {
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (ch === "," && d === 0) (args.push(cur.trim()), (cur = ""));
      else cur += ch;
    }
    args.push(cur.trim());
    calls.push([m[1], args]);
  }
  return calls;
}

describe("множитель --mo (reduced motion одной переменной)", () => {
  const kfs = keyframes();
  const rows = kfs.flatMap(([name, body, f]) =>
    [...body.matchAll(/transform:\s*([^;]+);/g)].map((m) => ({ name, file: f, value: m[1] })),
  );

  it("находит keyframes с transform (тест не вырожден)", () => {
    expect(kfs.length).toBeGreaterThan(10);
    expect(rows.some((r) => /var\(--mo\)/.test(r.value))).toBe(true);
  });

  // Бесконечный индикатор занятости: вращение — его смысл, при reduced он не гаснет, а замедляется (длительность ×3, settings.css).
  const SPINNERS = new Set(["settings-spin"]);

  it("при --mo:0 каждый transform в keyframes единичный: translate 0, scale 1, rotate 0", () => {
    const bad = [];
    for (const r of rows) {
      if (SPINNERS.has(r.name)) continue;
      for (const [fn, args] of transformCalls(r.value)) {
        for (const a of args) {
          const v = evalArg(a, 0);
          const unit = fn.startsWith("scale") ? 1 : 0;
          if (Math.abs(v - unit) > 1e-9) bad.push(`${r.file} @keyframes ${r.name}: ${fn}(${a}) = ${v} при --mo:0, ждали ${unit}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("при --mo:1 амплитуды ненулевые хотя бы у части keyframes (множитель что-то меняет)", () => {
    let moving = 0;
    for (const r of rows) {
      for (const [fn, args] of transformCalls(r.value)) {
        if (args.some((a) => /var\(--mo\)/.test(a) && Math.abs(evalArg(a, 1) - (fn.startsWith("scale") ? 1 : 0)) > 1e-9)) moving++;
      }
    }
    expect(moving).toBeGreaterThan(5);
  });
});
