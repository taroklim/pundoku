import { afterEach, describe, expect, it, vi } from "vitest";
import { MARK_SMALL_CELL, MARK_SMALL_FIELD } from "../brand/markPaths";
import { drawFingerprint, FP_CAPTION_Y, FP_COLORS, FP_GRID, FP_HEIGHT, FP_MARK, FP_MARK_GAP, FP_PAD, FP_WIDTH } from "./fingerprint";

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
    const fills = calls.filter((c) => c[0] === "fill").map((c) => [(c[1] as FakePath).d, c[2]]);
    expect(fills).toEqual([
      [MARK_SMALL_FIELD, FP_COLORS.label2],
      [MARK_SMALL_CELL, FP_COLORS.label2],
    ]);
    expect(calls.some((c) => c[0] === "restore")).toBe(true);
  });

  it("левая подпись сдвинута на 44 + 16 px; правая остаётся у правого края сетки", () => {
    vi.stubGlobal("Path2D", FakePath);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    const texts = calls.filter((c) => c[0] === "fillText");
    expect(texts[0]!.slice(1, 4)).toEqual(["30 Sep", FP_PAD + FP_MARK + FP_MARK_GAP, FP_CAPTION_Y]);
    expect(texts[1]!.slice(1, 4)).toEqual(["easy · 4:10", FP_PAD + FP_GRID, FP_CAPTION_Y]);
  });

  it("без Path2D (старый движок) макет подписи как раньше: знака нет, сдвига нет", () => {
    vi.stubGlobal("Path2D", undefined);
    const { ctx, calls } = fakeCtx();
    drawFingerprint(ctx, layout, caption);
    expect(calls.some((c) => c[0] === "translate")).toBe(false);
    expect(calls.find((c) => c[0] === "fillText")!.slice(1, 4)).toEqual(["30 Sep", FP_PAD, FP_CAPTION_Y]);
  });
});
