// PD-253: решения жеста «назад» от левого края — захват (полоса/угол/slop) и отпускание (35 % ширины или бросок).
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDGE_BACK, edgeClaim, isStandalone, releaseVelocity, shouldGoBack } from "./edgeBack";

describe("edgeClaim: захват при dx ≥ 24 и угле ≤ 30°", () => {
  it.each([
    [24, 0, "back"],
    [24, 13, "back"], // tan 30° · 24 ≈ 13,86
    [40, 23, "back"],
    [24, 14, "abandon"], // круче 30°
    [30, -20, "abandon"],
    [23, 0, "undecided"],
    [5, 5, "undecided"], // ещё в slop
    [12, 9, "undecided"],
    [0, 10, "abandon"], // вертикаль набрала slop — прокрутка
    [16, 9, "undecided"], // вертикаль ещё в slop
    [16, 10, "abandon"], // 10 > 16 · tan 30° ≈ 9,24 — круче угла и набрала slop
    [20, 10, "undecided"], // 10 ≤ 20 · tan 30° ≈ 11,5 — пологий, ждём захвата
    [-10, 0, "abandon"], // влево — не наш
    [-9, 0, "undecided"],
  ] as const)("dx=%d dy=%d → %s", (dx, dy, verdict) => {
    expect(edgeClaim(dx, dy)).toBe(verdict);
  });
});

describe("shouldGoBack: 35 % ширины или бросок вправо", () => {
  const W = 390;
  it("дистанция: ≥ 35 % — назад, меньше — возврат", () => {
    expect(shouldGoBack(Math.ceil(W * EDGE_BACK.COMMIT_FRAC), W, 0)).toBe(true);
    expect(shouldGoBack(Math.floor(W * EDGE_BACK.COMMIT_FRAC) - 1, W, 0)).toBe(false);
  });
  it("бросок вправо — назад даже с малой дистанции; влево — возврат даже с большой", () => {
    expect(shouldGoBack(40, W, EDGE_BACK.FLICK)).toBe(true);
    expect(shouldGoBack(300, W, -EDGE_BACK.FLICK)).toBe(false);
  });
  it("экран на месте — никогда не назад", () => {
    expect(shouldGoBack(0, W, 2)).toBe(false);
  });
});

describe("releaseVelocity: по движениям за последние 100 мс до отпускания", () => {
  const moves = [
    { t: 0, x: 0 },
    { t: 40, x: 40 },
    { t: 80, x: 80 },
    { t: 120, x: 120 },
  ];
  it("отпустил сразу (даже с задержкой события ~50 мс) — скорость последнего отрезка", () => {
    expect(releaseVelocity(moves, 125)).toBeCloseTo(1);
    expect(releaseVelocity(moves, 170)).toBeCloseTo(1);
  });
  it("постоял дольше окна — 0 (не бросок)", () => {
    expect(releaseVelocity(moves, 300)).toBe(0);
    expect(releaseVelocity(moves, 215)).toBe(0); // в окне одна точка
  });
  it("влево — отрицательная", () => {
    expect(releaseVelocity([{ t: 0, x: 300 }, { t: 16, x: 220 }], 20)).toBeCloseTo(-5);
  });
});

describe("isStandalone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { standalone?: boolean }).standalone;
  });
  it("iOS: navigator.standalone", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(isStandalone()).toBe(false);
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });
  it("display-mode: standalone; браузерная вкладка — нет", () => {
    const mm = (on: boolean) => (q: string) => ({ matches: on && q === "(display-mode: standalone)" });
    vi.stubGlobal("matchMedia", mm(true));
    expect(isStandalone()).toBe(true);
    vi.stubGlobal("matchMedia", mm(false));
    expect(isStandalone()).toBe(false);
  });
});
