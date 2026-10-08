/** PD-251: учёт гаснущих слоёв тумана Фонаря (lanternFade.ts) — чистая логика без DOM. */
import { describe, expect, it, vi } from "vitest";
import type { Light } from "./lanternFade";
import { FOG_FADE_MS, FOG_GHOST_SLACK_MS, nextExpiry, stepFade, veilOf } from "./lanternFade";

const L = (...ls: Light[]) => ls;
const W = [false, false, false];
const yes = () => true;

describe("stepFade", () => {
  it("первый кадр — призраков нет", () => {
    const t = stepFade(null, L("lit", "shadow", "peek"), [5 * 1024, 5 * 1024, 4], W, 0, yes);
    expect(t.ghost).toEqual([null, null, null]);
    expect(nextExpiry(t)).toBeNull();
  });

  it("свет → тень: призрак чёткого слоя (с видом осмотра/ошибки в момент смены); тень → свет: призрак тумана; lit ↔ peek — не смена", () => {
    const a = stepFade(null, L("lit", "shadow", "lit", "peek"), [5 * 1024, 6 * 1024, 7 * 1024, 8 * 1024], [true, false, false, false], 0, yes);
    const b = stepFade(a, L("shadow", "lit", "peek", "shadow"), a.sig, [false, false, false, false], 100, yes);
    expect(b.ghost[0]).toEqual({ veil: "clear", peek: false, err: true, until: 100 + FOG_FADE_MS + FOG_GHOST_SLACK_MS });
    expect(b.ghost[1]).toEqual({ veil: "fog", peek: false, err: false, until: 100 + FOG_FADE_MS + FOG_GHOST_SLACK_MS });
    expect(b.ghost[2]).toBeNull();
    expect(b.ghost[3]).toMatchObject({ veil: "clear", peek: true });
    expect(nextExpiry(b)).toBe(100 + FOG_FADE_MS + FOG_GHOST_SLACK_MS);
  });

  it("идемпотентна: тот же вход — те же объекты призраков; призрак живёт до `until` и снимается", () => {
    const a = stepFade(null, L("lit"), [1024], [false], 0, yes);
    const b = stepFade(a, L("shadow"), [1024], [false], 10, yes);
    const c = stepFade(b, L("shadow"), [1024], [false], 20, yes);
    expect(c.ghost[0]).toBe(b.ghost[0]);
    const until = b.ghost[0]!.until;
    expect(stepFade(c, L("shadow"), [1024], [false], until - 1, yes).ghost[0]).toBe(b.ghost[0]);
    expect(stepFade(c, L("shadow"), [1024], [false], until, yes).ghost[0]).toBeNull();
  });

  it("смена туда-обратно: один призрак — прежнего вида, срок от последней смены", () => {
    const a = stepFade(null, L("lit"), [1024], [false], 0, yes);
    const b = stepFade(a, L("shadow"), [1024], [false], 10, yes);
    const c = stepFade(b, L("lit"), [1024], [false], 70, yes);
    expect(c.ghost[0]).toMatchObject({ veil: "fog", until: 70 + FOG_FADE_MS + FOG_GHOST_SLACK_MS });
  });

  it("без призрака: Reduce Motion, смена содержимого, пустая клетка/подсказка (sig 0), выход из Фонаря (null)", () => {
    const a = stepFade(null, L("lit", "lit", "lit", "lit"), [1024, 1024, 0, 1024], [false, false, false, false], 0, yes);
    const rm = stepFade(a, L("shadow", "shadow", "shadow", "shadow"), a.sig, a.wrong, 10, () => false);
    expect(rm.ghost).toEqual([null, null, null, null]);
    const b = stepFade(a, L("shadow", "shadow", "shadow", null), [1024, 2048, 0, 1024], a.wrong, 10, yes);
    expect(b.ghost[0]).not.toBeNull();
    expect(b.ghost[1]).toBeNull(); // содержимое сменилось
    expect(b.ghost[2]).toBeNull(); // пусто / подсказка
    expect(b.ghost[3]).toBeNull(); // не Фонарь
    // Содержимое сменилось уже во время перехода — призрак снимается.
    expect(stepFade(b, L("shadow", "shadow", "shadow", null), [1024 + 2, 2048, 0, 1024], a.wrong, 20, yes).ghost[0]).toBeNull();
  });

  it("Reduce Motion спрашивается лениво — только когда свет какой-то клетки сменился", () => {
    const motion = vi.fn(() => true);
    const a = stepFade(null, L("lit", "lit"), [1024, 1024], [false, false], 0, motion);
    stepFade(a, L("lit", "peek"), [1024, 1024], [false, false], 1, motion);
    expect(motion).not.toHaveBeenCalled();
    stepFade(a, L("shadow", "shadow"), [1024, 1024], [false, false], 1, motion);
    expect(motion).toHaveBeenCalledTimes(1);
  });

  it("veilOf", () => {
    expect([veilOf("lit"), veilOf("peek"), veilOf("shadow"), veilOf(null)]).toEqual(["clear", "clear", "fog", null]);
  });
});
