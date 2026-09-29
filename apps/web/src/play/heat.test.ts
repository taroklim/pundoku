import { describe, expect, it } from "vitest";
import { HEAT_LEGEND_STEPS, HEAT_MAX, HEAT_MIN, heatLegend, heatOpacities } from "./heat";

describe("heatOpacities", () => {
  it("подсказки и незаполненные клетки — null, остальные нормированы по рангу", () => {
    const out = heatOpacities([null, 0.1, 0.9, 0.5, null]);
    expect(out[0]).toBeNull();
    expect(out[4]).toBeNull();
    expect(out[1]).toBe(HEAT_MIN);
    expect(out[2]).toBe(HEAT_MAX);
    expect(out[3]).toBeCloseTo((HEAT_MIN + HEAT_MAX) / 2, 3);
  });

  it("одна долгая пауза не сжимает карту: ранги равномерны при неравномерном времени", () => {
    const out = heatOpacities([0.01, 0.02, 0.03, 0.99]);
    const steps = [out[1]! - out[0]!, out[2]! - out[1]!, out[3]! - out[2]!];
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.002);
  });

  it("одна заполненная клетка — минимальная непрозрачность, без деления на ноль", () => {
    expect(heatOpacities([null, 0.4])).toEqual([null, HEAT_MIN]);
  });

  it("равные моменты не дают NaN и различаются детерминированно (по номеру клетки)", () => {
    const out = heatOpacities([0.5, 0.5, 0.5]);
    expect(out.every((o) => o !== null && Number.isFinite(o))).toBe(true);
    expect(out[0]!).toBeLessThan(out[2]!);
  });

  it("пустая карта", () => {
    expect(heatOpacities([])).toEqual([]);
  });
});

describe("heatLegend", () => {
  it("девять ступеней от HEAT_MIN до HEAT_MAX (как в макете: 0.12 → 0.98)", () => {
    const l = heatLegend();
    expect(l).toHaveLength(HEAT_LEGEND_STEPS);
    expect(l[0]).toBe(HEAT_MIN);
    expect(l[l.length - 1]).toBe(HEAT_MAX);
    expect([...l].sort((a, b) => a - b)).toEqual(l);
  });
});
