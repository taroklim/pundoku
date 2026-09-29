// @vitest-environment jsdom
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

describe("M1: pop не переигрывается при стирании и undo", () => {
  it("ввод ставит pop, стирание и undo его снимают", () => {
    const s = playing();
    s.input(4); // клетка 2, решение 4
    expect(s.getSnapshot().pop?.cell).toBe(2);
    s.erase();
    expect(s.getSnapshot().pop).toBeNull();
    s.undo(); // возвращает цифру 4 в клетку 2
    expect(s.getSnapshot().play?.values[2]).toBe(4);
    expect(s.getSnapshot().pop).toBeNull();
  });

  it("undo переносит выбор на откатываемую клетку", () => {
    const s = playing();
    s.input(4);
    s.select(3);
    s.undo();
    expect(s.getSnapshot().selected).toBe(2);
  });
});
