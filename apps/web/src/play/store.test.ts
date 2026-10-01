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

describe("QA PD-23, Low 1: clearEffects", () => {
  it("сбрасывает pop и wave, чтобы возврат на вкладку не проигрывал стухшие M1/M3", () => {
    const s = playing();
    s.input(4);
    const inner = s as unknown as { snap: Record<string, unknown> };
    inner.snap = { ...inner.snap, wave: { cells: [0, 1, 2], id: 1 }, echo: { digit: 4, cells: [2], delay: 60, id: 1 } };
    expect(s.getSnapshot().pop).not.toBeNull();
    let notified = 0;
    s.subscribe(() => notified++);
    s.clearEffects();
    expect(s.getSnapshot().pop).toBeNull();
    expect(s.getSnapshot().wave).toBeNull();
    expect(s.getSnapshot().echo ?? null).toBeNull();
    expect(notified).toBe(1);
    s.clearEffects(); // уже чисто — без лишних уведомлений
    expect(notified).toBe(1);
  });
});

/** Верно ставит все пустые клетки цифры `d` (по решению); возвращает последний снапшот перед последней клеткой и после. */
function closeDigit(s: PlayStore, d: number): { before: ReturnType<PlayStore["getSnapshot"]>; after: ReturnType<PlayStore["getSnapshot"]> } {
  const open = [...Array(81).keys()].filter((i) => SOLUTION[i] === String(d) && MISSION[i] === "0");
  for (const c of open.slice(0, -1)) {
    s.select(c);
    s.input(d);
  }
  const before = s.getSnapshot();
  s.select(open[open.length - 1] as number);
  s.input(d);
  return { before, after: s.getSnapshot() };
}

describe("PD-89 M3: волна по всем закрытым юнитам", () => {
  it("ход, закрывший строку, даёт волну со всеми её клетками и шагами от поставленной", () => {
    const s = playing();
    for (const c of [3, 5, 6, 7, 8]) {
      s.select(c);
      s.input(Number(SOLUTION[c]));
    }
    expect(s.getSnapshot().wave).toBeNull();
    s.select(2);
    s.input(4); // последняя пустая клетка строки 0
    const w = s.getSnapshot().wave!;
    expect(w).not.toBeNull();
    for (let c = 0; c < 9; c++) expect(w.cells).toContain(c);
    expect(w.steps).toHaveLength(w.cells.length);
    expect(w.steps![w.cells.indexOf(2)]).toBe(0);
    expect(w.steps![w.cells.indexOf(8)]).toBe(6);
  });
});

describe("PD-89 M8: цифра закрыта (9 из 9)", () => {
  it("последняя клетка цифры даёт echo: все девять клеток в порядке постановки, задержка 60 мс без волны", () => {
    const s = playing();
    // Цифра 5: чтобы последний ход не закрывал юнит — берём цифру и проверяем только факт события.
    const { before, after } = closeDigit(s, 5);
    expect(before.echo ?? null).toBeNull();
    expect(after.echo).not.toBeNull();
    expect(after.echo!.digit).toBe(5);
    expect(after.echo!.cells).toHaveLength(9);
    expect(after.echo!.delay).toBe(after.wave ? 180 : 60);
  });

  it("повторный ввод в уже закрытую цифру и стирание echo не дают", () => {
    const s = playing();
    closeDigit(s, 5);
    s.erase();
    expect(s.getSnapshot().echo ?? null).toBeNull();
  });
});
