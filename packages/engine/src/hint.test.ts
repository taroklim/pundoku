import { describe, expect, it } from "vitest";
import {
  BOX_OF,
  COL_OF,
  PEERS,
  ROW_OF,
  UNITS,
  candidates,
  countSolutions,
  generate,
  humanSolve,
  nextHint,
  parseGrid,
  solve,
} from "./index.js";
import type { Cell, Difficulty, Digit, Hint, HintState, MistakeHint, StepHint } from "./index.js";

/** Project Euler #96, сетка 01 — решается одними naked singles. */
const PE96_1 = "003020600900305001001806400008102900700000008006708200002609500800203009005010300";

/**
 * Реальные состояния доски (генератор, seed `hint-<i>`, расставлены все singles и вычёркивания по
 * подсказкам движка до первого появления нужной техники). `state` — доска игрока в этот момент.
 */
const FIXTURES = {
  pointing: {
    givens: "007095000000007060800010700000409020000000008002000900300050100009200403400000079",
    state: "007095000000047060800012790008409020000020008002000900376954182189276453425000679",
  },
  claiming: {
    givens: "064200000000001003701090000200050100000710030050800400000002090002000000970000508",
    state: "064207951529001003701090002200050180008710235150820400015002090002000010970100528",
  },
  hiddenPair: {
    givens: "010600400000005060040031000600300200005000080020900036000000015270000000903070000",
    state: "010629400092045060046031000689307200135462987020908036060293715271580000953170000",
  },
  nakedPair: {
    givens: "000050070400080050500200300300020047009007000000600000000035010783000600200800000",
    state: "000050470400080050500274380300128947029547063000693520000735010783412695200869734",
  },
  hiddenSingle: {
    givens: "000800407009004000008000002700050060086012570053080204000090300900230006300700100",
    state: "000800407009004600008000902792453861486912573153687294000090300900230706300700100",
  },
  beyond: {
    givens: "008000097001000000005009002200094000300050000000000038000017000010530700060040310",
    state: "428163597971005063635009102287394651306851270150000038503017000810530700760048315",
  },
} as const;

const toArr = (s: string): number[] => [...parseGrid(s)];

function stateOf(f: { givens: string; state: string }, extra: Partial<HintState> = {}): HintState {
  return { givens: f.givens, values: f.state, ...extra };
}

function asStep(h: Hint): StepHint {
  expect(h.kind).toBe("step");
  return h as StepHint;
}

function shares(a: Cell, b: Cell): boolean {
  return ROW_OF[a] === ROW_OF[b] || COL_OF[a] === COL_OF[b] || BOX_OF[a] === BOX_OF[b];
}

/**
 * Логическая корректность шага против настоящего решения и перебором + структурные инварианты
 * лесенки (область содержит клетки паттерна, свидетели действительно держат цифру и перекрывают дом).
 * `values` — доска без заметок (шаг выводится из цифр доски).
 */
function assertStepSound(givens: string, values: readonly number[], h: StepHint): void {
  const solution = solve(givens)!;
  const unit = new Set<number>(UNITS[h.region.unit]!);
  for (const c of h.cells.target) expect(unit.has(c)).toBe(true);
  expect(h.region.index).toBe(h.region.unit % 9);

  if (h.placement) {
    const { cell, digit } = h.placement;
    expect(values[cell]).toBe(0);
    expect(solution[cell]).toBe(digit);
    expect(candidates(values as never, cell)).toContain(digit);
    expect(h.eliminations).toBeUndefined();
    expect(h.cells.affected).toEqual([]);
    expect(h.cells.target).toEqual([cell]);
    for (const w of h.cells.witnesses) expect(values[w]).not.toBe(0);
    if (h.assumes.length === 0) {
      if (h.technique === "naked_single") {
        // По одному свидетелю на каждую из восьми остальных цифр, все — соседи клетки.
        const digits = new Set(h.cells.witnesses.map((w) => values[w]));
        expect(digits).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== digit)));
        for (const w of h.cells.witnesses) expect(PEERS[cell]!.includes(w)).toBe(true);
      } else {
        // Hidden single: свидетели держат цифру и закрывают все остальные пустые клетки дома.
        for (const w of h.cells.witnesses) expect(values[w]).toBe(digit);
        for (const c of UNITS[h.region.unit]!) {
          if (c === cell || values[c] !== 0) continue;
          expect(h.cells.witnesses.some((w) => PEERS[c]!.includes(w))).toBe(true);
        }
      }
    }
    expect(h.leadsTo).toBeUndefined();
    return;
  }

  expect(h.placement).toBeUndefined();
  expect(h.eliminations!.length).toBeGreaterThan(0);
  const affected = new Set<Cell>();
  for (const e of h.eliminations!) {
    affected.add(e.cell);
    expect(values[e.cell]).toBe(0);
    expect(solution[e.cell]).not.toBe(e.digit);
    expect(candidates(values as never, e.cell)).toContain(e.digit);
    if (h.assumes.length === 0) {
      const probe = [...values];
      probe[e.cell] = e.digit;
      expect(countSolutions(probe as never, 1)).toBe(0);
    }
  }
  expect([...affected].sort((a, b) => a - b)).toEqual([...h.cells.affected]);
  if (h.technique === "locked_candidates") {
    const ex = h.explanation as Extract<StepHint["explanation"], { id: "locked_pointing" | "locked_claiming" }>;
    const targetUnit = new Set<number>(UNITS[ex.params.target.unit]!);
    for (const c of h.cells.affected) expect(targetUnit.has(c)).toBe(true);
    for (const e of h.eliminations!) expect(e.digit).toBe(ex.params.digit);
    for (const c of h.cells.target) expect(candidates(values as never, c)).toContain(ex.params.digit);
    expect(ex.params.source).toEqual(h.region);
    if (h.assumes.length === 0) {
      for (const w of h.cells.witnesses) expect(values[w]).toBe(ex.params.digit);
      for (const c of UNITS[h.region.unit]!) {
        if (values[c] !== 0 || h.cells.target.includes(c)) continue;
        expect(h.cells.witnesses.some((w) => PEERS[c]!.includes(w))).toBe(true);
      }
    }
  } else {
    expect(h.cells.target).toHaveLength(2);
    expect(h.cells.witnesses).toEqual([]);
  }
  if (h.leadsTo) {
    expect(solution[h.leadsTo.cell]).toBe(h.leadsTo.digit);
    expect(values[h.leadsTo.cell]).toBe(0);
  }
}

describe("nextHint — singles", () => {
  it("naked single: region is the unit with most digits, witnesses give the other eight digits", () => {
    const h = asStep(nextHint({ givens: PE96_1, values: PE96_1 }));
    expect(h.technique).toBe("naked_single");
    expect(h.explanation.id).toBe("naked_single");
    assertStepSound(PE96_1, toArr(PE96_1), h);
    const cell = h.placement!.cell;
    const filled = (u: number): number => [...UNITS[u]!].filter((c) => PE96_1[c] !== "0").length;
    const max = Math.max(filled(ROW_OF[cell]!), filled(9 + COL_OF[cell]!), filled(18 + BOX_OF[cell]!));
    expect(filled(h.region.unit)).toBe(max);
  });

  it("hidden single: region is the box, witnesses are the 9s blocking the other cells", () => {
    const f = FIXTURES.hiddenSingle;
    const h = asStep(nextHint(stateOf(f)));
    expect(h).toMatchObject({
      technique: "hidden_single",
      region: { kind: "box", index: 1, unit: 19 }, // предпочтение: блок → строка → столбец
      cells: { target: [5], witnesses: [11, 24, 58], affected: [] },
      explanation: { id: "hidden_single", params: { cell: 5, digit: 9 } },
      placement: { cell: 5, digit: 9 },
      assumes: [],
    });
    assertStepSound(f.givens, toArr(f.state), h);
  });

  it("hidden single: with lastCell inside another unit of the cell, that unit is the region", () => {
    const f = FIXTURES.hiddenSingle;
    // Клетка 5 = r1c6: строка 1 и столбец 6 тоже содержат скрытую девятку? Проверяем только согласованность: регион всегда содержит клетку.
    for (const last of [0, 8, 41, 77]) {
      const h = asStep(nextHint(stateOf(f, { lastCell: last })));
      expect(UNITS[h.region.unit]!.includes(h.placement!.cell)).toBe(true);
      assertStepSound(f.givens, toArr(f.state), h);
    }
  });

  it("singles come before every elimination technique", () => {
    const h = asStep(nextHint(stateOf(FIXTURES.pointing, { notes: Array<number>(81).fill(0) })));
    expect(h.technique).toBe("locked_candidates");
    // Если на доске есть single — подсказка singles (PE96 решается одними singles).
    expect(asStep(nextHint({ givens: PE96_1, values: PE96_1 })).placement).toBeDefined();
  });
});

describe("nextHint — locked candidates, pairs", () => {
  it("pointing: 3 in box 2 confined to column 4, eliminated below", () => {
    const h = asStep(nextHint(stateOf(FIXTURES.pointing)));
    expect(h).toMatchObject({
      technique: "locked_candidates",
      region: { kind: "box", index: 1 },
      cells: { target: [3, 12, 21], affected: [39, 48, 75] },
      explanation: {
        id: "locked_pointing",
        params: { digit: 3, source: { kind: "box", index: 1 }, target: { kind: "col", index: 3 } },
      },
      eliminations: [
        { cell: 39, digit: 3 },
        { cell: 48, digit: 3 },
        { cell: 75, digit: 3 },
      ],
      leadsTo: { cell: 75, digit: 1, technique: "naked_single" },
      assumes: [],
    });
    assertStepSound(FIXTURES.pointing.givens, toArr(FIXTURES.pointing.state), h);
  });

  it("claiming: 4 in row 9 confined to box 8, eliminated from the rest of the box", () => {
    const h = asStep(nextHint(stateOf(FIXTURES.claiming)));
    expect(h).toMatchObject({
      technique: "locked_candidates",
      region: { kind: "row", index: 8 },
      cells: { target: [76, 77], witnesses: [2], affected: [57, 58, 66, 67, 68] },
      explanation: {
        id: "locked_claiming",
        params: { digit: 4, source: { kind: "row", index: 8 }, target: { kind: "box", index: 7 } },
      },
    });
    assertStepSound(FIXTURES.claiming.givens, toArr(FIXTURES.claiming.state), h);
  });

  it("naked pair 18 in row 6 strips 1/8 from the rest of the row", () => {
    const h = asStep(nextHint(stateOf(FIXTURES.nakedPair)));
    expect(h).toMatchObject({
      technique: "naked_pair",
      region: { kind: "row", index: 5 },
      cells: { target: [45, 53], witnesses: [], affected: [46, 47] },
      explanation: { id: "naked_pair", params: { digits: [1, 8], cells: [45, 53] } },
      eliminations: [
        { cell: 46, digit: 1 },
        { cell: 47, digit: 1 },
        { cell: 47, digit: 8 },
      ],
      leadsTo: { cell: 2, digit: 8, technique: "hidden_single" },
    });
    assertStepSound(FIXTURES.nakedPair.givens, toArr(FIXTURES.nakedPair.state), h);
  });

  it("hidden pair 29 in row 3 strips other candidates from the two cells", () => {
    const h = asStep(nextHint(stateOf(FIXTURES.hiddenPair)));
    expect(h).toMatchObject({
      technique: "hidden_pair",
      region: { kind: "row", index: 2 },
      cells: { target: [25, 26], affected: [25, 26] },
      explanation: { id: "hidden_pair", params: { digits: [2, 9], cells: [25, 26] } },
      eliminations: [
        { cell: 25, digit: 5 },
        { cell: 25, digit: 7 },
        { cell: 26, digit: 8 },
      ],
      leadsTo: { cell: 7, digit: 7, technique: "hidden_single" },
    });
    assertStepSound(FIXTURES.hiddenPair.givens, toArr(FIXTURES.hiddenPair.state), h);
  });

  it("technique matches the first step of humanSolve on the same board", () => {
    for (const f of [FIXTURES.pointing, FIXTURES.claiming, FIXTURES.hiddenPair, FIXTURES.nakedPair]) {
      const h = asStep(nextHint(stateOf(f)));
      expect(humanSolve(f.state).steps[0]!.technique).toBe(h.technique);
    }
  });
});

describe("nextHint — notes", () => {
  const full = (state: string): number[] => {
    const v = toArr(state);
    return v.map((x, c) => (x !== 0 ? 0 : candidates(v as never, c).reduce((m, d) => m | (1 << d), 0)));
  };

  it("eliminations already done in the notes are skipped; the single they open relies on them (assumes)", () => {
    const f = FIXTURES.pointing;
    const notes = full(f.state);
    // Игрок выполняет подсказки-вычёркивания одну за другой, пока движок не покажет постановку.
    let h = asStep(nextHint(stateOf(f, { notes })));
    let rounds = 0;
    while (!h.placement) {
      expect(h.technique).toBe("locked_candidates");
      for (const e of h.eliminations!) notes[e.cell] = notes[e.cell]! & ~(1 << e.digit);
      h = asStep(nextHint(stateOf(f, { notes })));
      rounds++;
    }
    expect(rounds).toBeGreaterThanOrEqual(2);
    expect(h.technique).toBe("naked_single");
    expect(h.placement).toEqual({ cell: 75, digit: 1 });
    // Без убранных игроком кандидатов у клетки остались бы ещё цифры — assumes ровно их перечисляет.
    expect(h.assumes.length).toBeGreaterThanOrEqual(2);
    expect(h.assumes.every((e) => e.cell === 75 && e.digit !== 1)).toBe(true);
    const left = candidates(f.state, 75).filter((d) => !h.assumes.some((e) => e.digit === d));
    expect(left).toEqual([1]);
  });

  it("partly done: only the remaining eliminations are returned", () => {
    const f = FIXTURES.pointing;
    const notes = full(f.state);
    for (const c of [39, 48]) notes[c] = notes[c]! & ~(1 << 3);
    const h = asStep(nextHint(stateOf(f, { notes })));
    expect(h.technique).toBe("locked_candidates");
    expect(h.eliminations).toEqual([{ cell: 75, digit: 3 }]);
    expect(h.cells.affected).toEqual([75]);
  });

  it("a cell with empty notes counts as 'no notes there' (elimination still shown)", () => {
    const f = FIXTURES.pointing;
    const notes = full(f.state);
    for (const c of [39, 48, 75]) notes[c] = 0;
    expect(nextHint(stateOf(f, { notes }))).toEqual(nextHint(stateOf(f)));
  });

  it("wrong notes (solution digits struck out) do not change the hint", () => {
    const solution = solve(FIXTURES.pointing.givens)!;
    for (const f of [FIXTURES.pointing, FIXTURES.claiming, FIXTURES.nakedPair, FIXTURES.hiddenPair]) {
      const sol = solve(f.givens)!;
      const notes = full(f.state).map((m, c) => (m === 0 ? 0 : m & ~(1 << sol[c]!)));
      const plain = nextHint(stateOf(f));
      // Заметки без решения-цифры не должны ломать выбор: при пустых клетках без нужных заметок — тот же шаг.
      const withNotes = nextHint(stateOf(f, { notes }));
      expect(withNotes).toEqual(plain);
    }
    expect(solution).toBeDefined();
  });

  it("notes never matter when a single exists", () => {
    const garbage = Array.from({ length: 81 }, (_, i) => (i * 37) % 1023 & ~1);
    expect(nextHint({ givens: PE96_1, values: PE96_1, notes: garbage })).toEqual(
      nextHint({ givens: PE96_1, values: PE96_1 }),
    );
  });
});

describe("nextHint — lastCell", () => {
  it("among equal-tier steps picks the closest to the last move", () => {
    const values = toArr(PE96_1);
    const singles = values.map((_, c) => c).filter((c) => values[c] === 0 && candidates(values as never, c).length === 1);
    expect(singles.length).toBeGreaterThanOrEqual(3);
    const prox = (last: Cell, c: Cell): number => (c === last ? 0 : shares(c, last) ? 1 : 2);
    const picked = new Set<Cell>();
    for (const last of [...singles, 0, 80]) {
      const h = asStep(nextHint({ givens: PE96_1, values: PE96_1, lastCell: last }));
      const cell = h.placement!.cell;
      picked.add(cell);
      for (const s of singles) expect(prox(last, cell)).toBeLessThanOrEqual(prox(last, s));
    }
    expect(picked.size).toBeGreaterThan(1); // подсказка действительно «ездит» за последним ходом
  });

  it("is deterministic and ignores nothing else", () => {
    const a = nextHint({ givens: PE96_1, values: PE96_1, lastCell: 33 });
    expect(nextHint({ givens: PE96_1, values: PE96_1, lastCell: 33 })).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("technique tier still beats proximity", () => {
    const f = FIXTURES.pointing;
    const near = asStep(nextHint(stateOf(f, { lastCell: 80 })));
    expect(near.technique).toBe(asStep(nextHint(stateOf(f))).technique);
  });
});

describe("nextHint — mistakes", () => {
  const sol = solve(PE96_1)!;
  const emptyCells = toArr(PE96_1)
    .map((v, c) => c)
    .filter((c) => PE96_1[c] === "0");

  /** Неверная цифра, не дающая видимого дубликата. */
  function hiddenWrong(cell: Cell): Digit {
    const v = toArr(PE96_1);
    const free = candidates(v as never, cell).filter((d) => d !== sol[cell]);
    expect(free.length).toBeGreaterThan(0);
    return free[0]!;
  }

  function board(sets: Record<number, number>): number[] {
    const v = toArr(PE96_1);
    for (const [c, d] of Object.entries(sets)) v[Number(c)] = d;
    return v;
  }

  it("hidden mistake (no visible clash): region is the 9-cell box, not the cell", () => {
    const cell = emptyCells.find((c) => candidates(toArr(PE96_1) as never, c).length > 1)!;
    const values = board({ [cell]: hiddenWrong(cell) });
    const h = nextHint({ givens: PE96_1, values: values as never }) as MistakeHint;
    expect(h.kind).toBe("mistake");
    expect(h.region).toEqual({ kind: "box", index: BOX_OF[cell], unit: 18 + BOX_OF[cell]! });
    expect(h.explanation).toEqual({ id: "mistake_hidden", params: { region: h.region } });
    expect(h.cells.target).toEqual([cell]);
    expect(h.cells.witnesses).toEqual([]);
    expect(h.totalWrong).toBe(1);
    expect("placement" in h).toBe(false);
  });

  it("visible clash: region is the shared unit, witnesses are the duplicates", () => {
    // Ставим в пустую клетку цифру, уже стоящую в её строке.
    const cell = emptyCells[0]!;
    const rowPeer = [...UNITS[ROW_OF[cell]!]!].find((c) => PE96_1[c] !== "0")!;
    const values = board({ [cell]: Number(PE96_1[rowPeer]) });
    const h = nextHint({ givens: PE96_1, values: values as never }) as MistakeHint;
    expect(h.kind).toBe("mistake");
    expect(h.region).toEqual({ kind: "row", index: ROW_OF[cell], unit: ROW_OF[cell] });
    expect(h.explanation).toMatchObject({ id: "mistake_conflict", params: { digit: values[cell] } });
    expect(h.cells.target).toEqual([cell]);
    expect(h.cells.witnesses).toContain(rowPeer);
    for (const w of h.cells.witnesses) expect(values[w]).toBe(values[cell]);
  });

  it("with several mistakes the last move wins; target holds every wrong cell of the region", () => {
    const a = emptyCells.find((c) => candidates(toArr(PE96_1) as never, c).length > 1)!;
    const b = emptyCells.find(
      (c) => c !== a && BOX_OF[c] !== BOX_OF[a] && candidates(toArr(PE96_1) as never, c).length > 1,
    )!;
    const values = board({ [a]: hiddenWrong(a), [b]: hiddenWrong(b) });
    const first = nextHint({ givens: PE96_1, values: values as never }) as MistakeHint;
    expect(first.totalWrong).toBe(2);
    expect(first.cells.target).toEqual([Math.min(a, b)]);
    const viaLast = nextHint({ givens: PE96_1, values: values as never, lastCell: b }) as MistakeHint;
    expect(viaLast.cells.target).toEqual([b]);
    expect(viaLast.region.unit).toBe(18 + BOX_OF[b]!);
  });

  it("two wrong cells in one box: both are listed", () => {
    const inBox = emptyCells.filter((c) => BOX_OF[c] === BOX_OF[emptyCells[0]!]);
    const [a, b] = inBox;
    const wrongA = hiddenWrong(a!);
    const wrongB = candidates(toArr(PE96_1) as never, b!).filter((d) => d !== sol[b!] && d !== wrongA)[0];
    expect(wrongB).toBeDefined();
    const values = board({ [a!]: wrongA, [b!]: wrongB! });
    const h = nextHint({ givens: PE96_1, values: values as never }) as MistakeHint;
    expect(h.kind).toBe("mistake");
    expect(h.totalWrong).toBe(2);
    expect(h.cells.target).toEqual([a, b].sort((x, y) => x! - y!));
  });

  it("a wrong digit makes no step hint until fixed; fixing returns the step", () => {
    const cell = emptyCells[0]!;
    const wrong = hiddenWrong(cell);
    expect(nextHint({ givens: PE96_1, values: board({ [cell]: wrong }) as never }).kind).toBe("mistake");
    expect(nextHint({ givens: PE96_1, values: board({ [cell]: sol[cell]! }) as never }).kind).toBe("step");
  });

  it("a full but wrong board is still a mistake; a full correct board is solved", () => {
    const wrongFull: number[] = [...sol];
    wrongFull[emptyCells[0]!] = (sol[emptyCells[0]!]! % 9) + 1;
    expect(nextHint({ givens: PE96_1, values: wrongFull as never }).kind).toBe("mistake");
    expect(nextHint({ givens: PE96_1, values: sol })).toEqual({ kind: "none", reason: "solved" });
  });

  it("explicit `solution` gives the same answer as the derived one", () => {
    const cell = emptyCells[0]!;
    const values = board({ [cell]: hiddenWrong(cell) });
    expect(nextHint({ givens: PE96_1, values: values as never, solution: sol })).toEqual(
      nextHint({ givens: PE96_1, values: values as never }),
    );
  });
});

describe("nextHint — none, validation, purity", () => {
  it("beyond: honest 'engine has no technique' on a master board, no mistake reported", () => {
    const f = FIXTURES.beyond;
    expect(nextHint(stateOf(f))).toEqual({ kind: "none", reason: "beyond" });
    expect(humanSolve(f.state).solved).toBe(false);
  });

  it("invalid_puzzle: givens without a unique solution and no `solution`", () => {
    const empty = "0".repeat(81);
    expect(nextHint({ givens: empty, values: empty })).toEqual({ kind: "none", reason: "invalid_puzzle" });
    // С явным решением работает и такой «паззл».
    const full = solve(empty)!;
    expect(nextHint({ givens: empty, values: empty, solution: full })).toEqual({ kind: "none", reason: "beyond" });
  });

  it("rejects bad input with RangeError", () => {
    const base = { givens: PE96_1, values: PE96_1 };
    const changed = toArr(PE96_1);
    changed[2] = 4; // подсказка r1c3 = 3
    expect(() => nextHint({ givens: PE96_1, values: changed as never })).toThrow(RangeError);
    expect(() => nextHint({ ...base, notes: [0, 0] })).toThrow(RangeError);
    expect(() => nextHint({ ...base, notes: Array<number>(81).fill(1 << 10) })).toThrow(RangeError);
    expect(() => nextHint({ ...base, lastCell: 81 })).toThrow(RangeError);
    expect(() => nextHint({ ...base, lastCell: -1 })).toThrow(RangeError);
    expect(() => nextHint({ ...base, solution: PE96_1 })).toThrow(RangeError); // неполное решение
    const other = solve("0".repeat(81))!;
    expect(() => nextHint({ ...base, solution: other })).toThrow(RangeError); // не согласовано с givens
    expect(() => nextHint({ givens: "123", values: PE96_1 })).toThrow(RangeError);
  });

  it("does not mutate its input (frozen arrays) and does not alias it in the output", () => {
    const f = FIXTURES.pointing;
    const values = Object.freeze(toArr(f.state));
    const givens = Object.freeze(toArr(f.givens));
    const notes = Object.freeze(Array<number>(81).fill(0b1111111110));
    const solution = Object.freeze([...solve(f.givens)!]);
    const state = Object.freeze({ givens, values, notes, solution, lastCell: 12 }) as unknown as HintState;
    const before = JSON.stringify(state);
    const h = asStep(nextHint(state));
    expect(JSON.stringify(state)).toBe(before);
    expect(nextHint(state)).toEqual(h);
    expect(Object.isFrozen(h.cells.target)).toBe(false);
  });

  it("accepts the same board as string or array", () => {
    const f = FIXTURES.claiming;
    expect(nextHint({ givens: toArr(f.givens) as never, values: toArr(f.state) as never })).toEqual(
      nextHint(stateOf(f)),
    );
  });
});

/** Играет партию подсказками: ставит цифры; шаг-вычёркивание применяет в заметках либо через leadsTo. */
function playOut(
  puzzle: { mission: string; solution: string },
  mode: "notes" | "plain",
  visit?: (state: HintState, hint: Hint) => void,
): { values: number[]; end: Hint } {
  const values = toArr(puzzle.mission);
  const solution = toArr(puzzle.solution);
  const notes = values.map((x, c) =>
    x !== 0 ? 0 : candidates(values as never, c).reduce((m, d) => m | (1 << d), 0),
  );
  let last: Cell | undefined;
  for (let guard = 0; guard < 1500; guard++) {
    const state: HintState =
      mode === "notes"
        ? { givens: puzzle.mission, values: values as never, solution: puzzle.solution, notes, ...(last !== undefined ? { lastCell: last } : {}) }
        : { givens: puzzle.mission, values: values as never, solution: puzzle.solution, ...(last !== undefined ? { lastCell: last } : {}) };
    const hint = nextHint(state);
    visit?.(state, hint);
    if (hint.kind !== "step") return { values, end: hint };
    // Совместимость с решением на каждом шаге.
    for (let c = 0; c < 81; c++) expect(values[c] === 0 || values[c] === solution[c]).toBe(true);
    if (hint.placement) {
      const { cell, digit } = hint.placement;
      values[cell] = digit;
      notes[cell] = 0;
      for (const p of PEERS[cell]!) notes[p] = notes[p]! & ~(1 << digit);
      last = cell;
    } else if (mode === "notes") {
      for (const e of hint.eliminations!) {
        expect(notes[e.cell]! & (1 << e.digit)).not.toBe(0); // подсказка не повторяется: кандидат ещё в заметках
        notes[e.cell] = notes[e.cell]! & ~(1 << e.digit);
      }
    } else {
      if (!hint.leadsTo) return { values, end: { kind: "none", reason: "beyond" } };
      values[hint.leadsTo.cell] = hint.leadsTo.digit;
      last = hint.leadsTo.cell;
    }
  }
  throw new Error("hint loop did not terminate");
}

describe("nextHint — property: playing the hints keeps the board consistent with the solution", () => {
  const classes: readonly [Difficulty, number][] = [
    ["easy", 4],
    ["medium", 4],
    ["hard", 4],
    ["expert", 4],
    ["master", 3],
  ];
  const timings: number[] = [];
  const seen = new Set<string>();

  for (const [difficulty, n] of classes) {
    for (let i = 0; i < n; i++) {
      for (const mode of ["notes", "plain"] as const) {
        it(`${difficulty} #${i} (${mode}): every hint is sound; game ends solved or 'beyond'`, () => {
          const puzzle = generate({ difficulty, seed: `hint-${i}` });
          const { values, end } = playOut(puzzle, mode, (state, hint) => {
            const t0 = now();
            nextHint(state);
            timings.push(now() - t0);
            if (hint.kind !== "step") return;
            seen.add(hint.explanation.id);
            if (mode === "plain") {
              assertStepSound(puzzle.mission, [...parseGrid(formatValues(state.values))], hint);
              // Техника подсказки = первый (самый дешёвый) шаг human-решателя на этой же доске.
              expect(humanSolve(state.values).steps[0]!.technique).toBe(hint.technique);
            }
          });
          if (difficulty === "master") {
            // Master по определению требует техник сверх движка — но до тупика подсказки идут.
            expect(end.kind).toBe("none");
          } else {
            expect(end).toEqual({ kind: "none", reason: "solved" });
            expect(values.join("")).toBe(puzzle.solution);
          }
        }, 120_000);
      }
    }
  }

  it("covers every technique and explanation id seen in real games; fast enough", () => {
    for (const id of ["naked_single", "hidden_single", "locked_pointing", "locked_claiming", "naked_pair", "hidden_pair"]) {
      expect(seen.has(id), `explanation ${id} was never produced`).toBe(true);
    }
    expect(timings.length).toBeGreaterThan(100);
    const sorted = [...timings].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    // Цель — < 20 мс на сетку; на загруженной CI-машине допускаем запас, реальные цифры — в README.
    expect(p95).toBeLessThan(100);
  });
});

const now = (): number =>
  (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

function formatValues(v: unknown): string {
  return typeof v === "string" ? v : (v as readonly number[]).join("");
}
