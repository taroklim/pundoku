// @vitest-environment jsdom
/** Чернильный режим (PD-71) в Play: вход, блокировка, отвергнутые ходы на уровне стора. */
import { blotsOf } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { createPlay } from "./logic";
import { PlayStore } from "./store";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

function playing(): PlayStore {
  const store = new PlayStore();
  const inner = store as unknown as { snap: Record<string, unknown> };
  inner.snap = { ...inner.snap, phase: "playing", play: createPlay({ mission: MISSION, solution: SOLUTION }), selected: 2 };
  return store;
}

describe("Play: Чернильный режим", () => {
  it("по умолчанию выключен; включается до первого хода, после хода — нет", () => {
    const s = playing();
    expect(s.getSnapshot().play!.ink).toBeUndefined();
    expect(s.setInk(true)).toBe(true);
    s.input(4);
    expect(s.setInk(false)).toBe(false);
    expect(s.getSnapshot().play!.ink).toBe(true);
  });

  it("undo и erase стора отвергаются; клякса даёт эффект blot без pop", () => {
    const s = playing();
    s.setInk(true);
    s.input(1); // клетка 2, решение 4 — ошибка
    const snap = s.getSnapshot();
    expect(snap.blot).toMatchObject({ cell: 2, digit: 1 });
    expect(snap.pop).toBeNull();
    expect(snap.play!.values[2]).toBe(4);
    expect(blotsOf(snap.play!.log)).toHaveLength(1);
    const before = snap.play;
    s.undo();
    s.erase();
    expect(s.getSnapshot().play).toBe(before);
  });
});
