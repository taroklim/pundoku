// Порядок в `styles/year.css`: блок `@media (forced-colors: active)` обязан стоять ниже базовых правил, которые он
// переопределяет (`.year-month`, `.ycell.today`, `.ycell`, `.ymark.is-today::after`…): при равной специфичности
// побеждает более позднее, и стоящий выше блок молча не работал бы (замечание QA PD-38).
import { describe, expect, it } from "vitest";
import css from "../styles/year.css?raw";

const start = css.indexOf("@media (forced-colors: active)");

/** Конец блока — по балансу фигурных скобок. */
function blockEnd(from: number): number {
  let depth = 0;
  for (let i = css.indexOf("{", from); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return i + 1;
  }
  return css.length;
}

describe("year.css: forced-colors", () => {
  it("блок есть и после него нет ни одного правила", () => {
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(blockEnd(start))).not.toContain("{");
  });

  it("базовые правила, которые блок переопределяет, объявлены выше него", () => {
    // внутри блока селекторы с отступом, так что «\n.селектор {» в начале строки — только базовые правила
    for (const sel of ["\n.year-month {", "\n.ycell.today {", "\n.ycell {", "\n.ymark.is-today::after {", "\n.ymark.is-missed::before {", "\n.ymark.has-corr {"]) {
      expect(css.includes(sel), sel).toBe(true);
      expect(css.lastIndexOf(sel), sel).toBeLessThan(start);
    }
  });
});
