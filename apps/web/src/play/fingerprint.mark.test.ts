import { afterEach, describe, expect, it, vi } from "vitest";
import { MARK_SMALL_CELL, MARK_SMALL_FIELD } from "../brand/markPaths";
import { WORDMARK_DOKU } from "../brand/wordmarkGeometry";
import {
  drawFingerprint,
  FP_CAPTION_Y,
  FP_COLORS,
  FP_GRID,
  FP_HEIGHT,
  FP_MARK,
  FP_MARK_GAP,
  FP_PAD,
  FP_WIDTH,
  FP_WORDMARK_H,
  FP_WORDMARK_W,
} from "./fingerprint";

// Знак D5 в строке подписи PNG отпечатка (PD-102, §18.5д): рисуется малой геометрией, нейтральным цветом, сдвигает подпись.
class FakePath {
  constructor(readonly d: string) {}
}
function fakeCtx() {
  const calls: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => {
        if (k === "measureText") return (s: string) => ({ width: s.length * 20 });
        if (k in state) return state[k];
        return (...a: unknown[]) => void calls.push([k, ...a, state.fillStyle]);
      },
      set: (_t, k: string, v) => ((state[k] = v), true),
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

afterEach(() => vi.unstubAllGlobals());
const layout = { width: FP_WIDTH, height: FP_HEIGHT, squares: [] };
const caption = { left: "30 Sep", right: "easy · 4:10" };

describe("PNG отпечатка: знак в подписи", () => {
  it("знак: translate к левому краю на 44 px выше базовой линии, масштаб 44/16, пути малой геометрии, цвет label2", () => {
    vi.stubGlobal("Path2D", FakePath);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    expect(calls.find((c) => c[0] === "translate")!.slice(1, 3)).toEqual([FP_PAD, FP_CAPTION_Y - FP_MARK]);
    expect(calls.find((c) => c[0] === "scale")!.slice(1, 3)).toEqual([2.75, 2.75]);
    const fills = calls.filter((c) => c[0] === "fill" && c[1] instanceof FakePath).map((c) => [(c[1] as FakePath).d, c[2]]);
    expect(fills).toEqual([
      [MARK_SMALL_FIELD, FP_COLORS.label2],
      [MARK_SMALL_CELL, FP_COLORS.label2],
    ]);
    expect(calls.some((c) => c[0] === "restore")).toBe(true);
  });

  it("вместо набранного слова слева — вордмарк (PD-152); правая подпись остаётся у правого края сетки", () => {
    vi.stubGlobal("Path2D", FakePath);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    const texts = calls.filter((c) => c[0] === "fillText");
    expect(texts).toHaveLength(1);
    expect(texts[0]!.slice(1, 4)).toEqual(["easy · 4:10", FP_PAD + FP_GRID, FP_CAPTION_Y]);
  });

  it("без Path2D (старый движок) макет подписи как раньше: знака нет, сдвига нет", () => {
    vi.stubGlobal("Path2D", undefined);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    expect(calls.some((c) => c[0] === "translate")).toBe(false);
    expect(calls.find((c) => c[0] === "fillText")!.slice(1, 4)).toEqual(["30 Sep", FP_PAD, FP_CAPTION_Y]);
  });
});

describe("PNG отпечатка: клеточный вордмарк в подписи (PD-152)", () => {
  it("23 клетки roundRect заливкой label, 4 штриха doku Path2D, одноцветно; сдвиг на знак 44 + 16", () => {
    vi.stubGlobal("Path2D", FakePath);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    const k = FP_WORDMARK_H / 116;
    const translates = calls.filter((c) => c[0] === "translate").map((c) => c.slice(1, 3));
    // знак, затем вордмарк: x = левый край + знак + отступ; верх такой, что базовая линия (106 во viewBox) на FP_CAPTION_Y
    expect(translates[1]).toEqual([FP_PAD + FP_MARK + FP_MARK_GAP, FP_CAPTION_Y - 106 * k]);
    expect(translates[2]).toEqual([2, -94]);
    const scales = calls.filter((c) => c[0] === "scale").map((c) => c.slice(1, 3));
    expect(scales[1]).toEqual([k, k]);
    // клетки: после знака (2 fill) идут 23 fill с цветом label
    const cellFills = calls.filter((c) => c[0] === "fill" && c[1] === FP_COLORS.label); // fill() без аргументов: [fill, fillStyle]
    expect(cellFills).toHaveLength(23);
    const strokes = calls.filter((c) => c[0] === "stroke");
    expect(strokes).toHaveLength(4);
    expect(strokes.map((s) => (s[1] as FakePath).d)).toEqual(WORDMARK_DOKU.map((l) => l.d));
    // ни одного чернильного цвета в подписи: «Pun» не должно читаться поставленной клеткой
    expect(calls.some((c) => c[c.length - 1] === FP_COLORS.ink)).toBe(false);
    expect(FP_WORDMARK_W).toBe(Math.round(35 * (614 / 116)));
  });

  it("клетки лежат на сетке вордмарка: первая — (0,96), последняя — (236,177) во внутренних координатах", () => {
    vi.stubGlobal("Path2D", FakePath);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    const moves = calls.filter((c) => c[0] === "moveTo");
    // roundRectPath начинает с moveTo(x + r, y): ищем клетки по первой и последней точке старта
    const starts = moves.map((m) => [m[1], m[2]]);
    const wordStarts = starts.slice(-23);
    expect(wordStarts[0]).toEqual([0 + 4, 96]);
    expect(wordStarts[22]).toEqual([236 + 4, 177]);
  });

  it("без Path2D слева набранное слово «как раньше», вордмарка нет", () => {
    vi.stubGlobal("Path2D", undefined);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    expect(calls.filter((c) => c[0] === "stroke")).toHaveLength(0);
    expect(calls.filter((c) => c[0] === "fillText").map((c) => c[1])).toEqual(["30 Sep", "easy · 4:10"]);
  });
});
