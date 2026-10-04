/**
 * Лжец (PD-165): генератор, критерий честности, обвинение, метрики.
 *
 * Свойства проверяются НЕЗАВИСИМО от реализации критерия: перебором `countSolutions` по каждой подсказке
 * (а не через таблицу покрытия генератора), `conflicts`/`candidates`, `humanSolve`. «Тяжёлый» прогон по
 * всем классам — `liar.heavy.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  LIAR_DEFAULT_MAX_BASES,
  LIAR_VERSION,
  LiarGenerationError,
  accuse,
  candidates,
  conflicts,
  countSolutions,
  dailyLiarPuzzle,
  dailyLiarSeed,
  dailyPuzzle,
  generate,
  generateLiar,
  humanSolve,
  liarSummary,
  validateLiar,
} from "./index.js";
import type { Accusation, CellValue, Difficulty, Digit, LiarPuzzle, Move } from "./index.js";
import { lieChecker } from "./liar.js";
import { CEILING, assertHonestLiar, withCell } from "./liar.test-util.js";

describe("generateLiar — determinism and contract", () => {
  it("same seed → byte-identical puzzle; different seeds → different", () => {
    const a = generateLiar({ difficulty: "medium", seed: "det" });
    const b = generateLiar({ difficulty: "medium", seed: "det" });
    expect(b).toEqual(a);
    const c = generateLiar({ difficulty: "medium", seed: "det2" });
    expect(c.mission).not.toBe(a.mission);
    expect(a.meta.version).toBe(LIAR_VERSION);
    expect(a.seed).toBe("det");
    expect(a.difficulty).toBe("medium");
  }, 60_000);

  it("honest base is exactly generate() of meta.baseSeed (same class semantics)", () => {
    const p = generateLiar({ difficulty: "hard", seed: "base-link" });
    const base = generate({ difficulty: "hard", seed: p.meta.baseSeed });
    expect(base.mission).toBe(p.honestMission);
    expect(base.solution).toBe(p.solution);
    expect(p.techniques).toEqual(base.techniques);
    expect(p.meta.baseSeed).toBe(p.meta.bases === 1 ? "liar:base-link" : `liar:base-link:${p.meta.bases - 1}`);
  }, 60_000);

  it("snapshot: algorithm drift is caught (bump LIAR_VERSION if this changes on purpose)", () => {
    const e = generateLiar({ difficulty: "easy", seed: "snapshot" });
    const m = generateLiar({ difficulty: "medium", seed: "snapshot" });
    expect({ mission: e.mission, liarCell: e.liarCell, liarDigit: e.liarDigit }).toMatchInlineSnapshot(`
      {
        "liarCell": 39,
        "liarDigit": 9,
        "mission": "150306908600025010004198005270001006001970000008602700427003050800000120006259400",
      }
    `);
    expect({ mission: m.mission, liarCell: m.liarCell, liarDigit: m.liarDigit }).toMatchInlineSnapshot(`
      {
        "liarCell": 57,
        "liarDigit": 2,
        "mission": "040050100057300400090480523002003000069002000000006802978204000016000340000000090",
      }
    `);
  }, 60_000);

  it("maxBases: does not change the result; too small → LiarGenerationError", () => {
    // Ищем seed, которому понадобилось > 1 основы.
    let p: LiarPuzzle | null = null;
    for (let i = 0; i < 60 && p === null; i++) {
      const q = generateLiar({ difficulty: "medium", seed: `bases-${i}` });
      if (q.meta.bases > 1) p = q;
    }
    expect(p).not.toBeNull();
    const seed = p!.seed;
    expect(generateLiar({ difficulty: "medium", seed, maxBases: p!.meta.bases })).toEqual(p);
    expect(() => generateLiar({ difficulty: "medium", seed, maxBases: p!.meta.bases - 1 })).toThrow(LiarGenerationError);
    expect(LIAR_DEFAULT_MAX_BASES).toBeGreaterThanOrEqual(100);
  }, 60_000);

  it("rejects bad options", () => {
    expect(() => generateLiar({ difficulty: "nope" as Difficulty, seed: "x" })).toThrow(RangeError);
    expect(() => generateLiar({ difficulty: "constructor" as Difficulty, seed: "x" })).toThrow(RangeError);
    expect(() => generateLiar({ difficulty: "easy", seed: 5 as unknown as string })).toThrow(RangeError);
    for (const maxBases of [0, -1, 1.5, Number.NaN, Infinity, null as unknown as number]) {
      expect(() => generateLiar({ difficulty: "easy", seed: "x", maxBases })).toThrow(RangeError);
    }
  });
});

describe("daily liar", () => {
  it("seed convention, date validation, differs from the regular daily grid", () => {
    expect(dailyLiarSeed("2026-10-04", "medium")).toBe("2026-10-04/liar/medium");
    expect(() => dailyLiarSeed("2026-02-30", "medium")).toThrow(RangeError);
    expect(() => dailyLiarSeed("04.10.2026", "medium")).toThrow(RangeError);
    const p = dailyLiarPuzzle("2026-10-04", "medium");
    expect(p).toEqual(generateLiar({ difficulty: "medium", seed: "2026-10-04/liar/medium" }));
    expect(p.honestMission).not.toBe(dailyPuzzle("2026-10-04", "medium").mission);
    assertHonestLiar(p);
  }, 60_000);
});

describe("honesty property — many seeds (easy/medium; all classes in liar.heavy.test.ts)", () => {
  for (const difficulty of ["easy", "medium"] as const) {
    it(`${difficulty}: 40 seeds pass the independent honesty check`, () => {
      for (let i = 0; i < 40; i++) assertHonestLiar(generateLiar({ difficulty, seed: `prop-${difficulty}-${i}` }));
    }, 120_000);
  }
});

describe("lieChecker (generator fast path) == validateLiar on the full candidate sweep", () => {
  for (const [difficulty, seed] of [
    ["easy", "sweep-1"],
    ["medium", "sweep-2"],
    ["hard", "sweep-3"],
  ] as const) {
    it(`${difficulty}: every (cell, digit) gets the same verdict`, () => {
      const base = generate({ difficulty, seed });
      const tier = ["naked_single", "hidden_single", "locked_candidates", "naked_pair", "hidden_pair"].indexOf(CEILING[difficulty]);
      const check = lieChecker(base.mission, base.solution, tier);
      let accepted = 0;
      let checked = 0;
      for (let c = 0; c < 81; c++) {
        if (base.mission[c] !== "0") continue;
        for (let d = 1; d <= 9; d++) {
          if (String(d) === base.solution[c]) {
            expect(check(c, d as Digit)).toBeNull();
            continue;
          }
          const fast = check(c, d as Digit) !== null;
          const full = validateLiar(withCell(base.mission, c, d), { difficulty }).honest;
          if (fast !== full) throw new Error(`verdict mismatch at ${c}=${d}: fast ${fast}, full ${full}`);
          if (fast) accepted++;
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
      // Нетривиальность выборки: проверщик и принимает, и отвергает.
      expect(accepted).toBeLessThan(checked);
      if (difficulty !== "hard") expect(accepted).toBeGreaterThan(0);
      // Непустая клетка — не кандидат.
      const given = base.mission.split("").findIndex((ch) => ch !== "0");
      expect(check(given, 1)).toBeNull();
    }, 120_000);
  }
});

describe("lieChecker — slow path and depth boundary", () => {
  it("coverageLimit 1 (every clue checked one by one) gives the same verdicts as the coverage table", () => {
    const base = generate({ difficulty: "medium", seed: "slow-path" });
    const fast = lieChecker(base.mission, base.solution, 1);
    const slow = lieChecker(base.mission, base.solution, 1, { coverageLimit: 1 });
    let accepted = 0;
    let rejectedByAmbiguity = 0;
    for (let c = 0; c < 81; c++) {
      if (base.mission[c] !== "0") continue;
      for (let d = 1; d <= 9; d++) {
        const a = fast(c, d as Digit);
        expect(slow(c, d as Digit)).toEqual(a);
        if (a !== null) accepted++;
        else if (String(d) !== base.solution[c] && validateLiar(withCell(base.mission, c, d), { difficulty: "medium" }).failures.includes("ambiguous")) {
          rejectedByAmbiguity++;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejectedByAmbiguity).toBeGreaterThan(0);
  }, 120_000);

  it("minDepth boundary: depth == minDepth accepted, minDepth + 1 rejected", () => {
    const p = generateLiar({ difficulty: "medium", seed: "depth-boundary" });
    const d = p.meta.contradictionDepth;
    const at = lieChecker(p.honestMission, p.solution, 1, { minDepth: d });
    const above = lieChecker(p.honestMission, p.solution, 1, { minDepth: d + 1 });
    expect(at(p.liarCell, p.liarDigit)).toEqual({ depth: d, technique: p.meta.contradictionTechnique });
    expect(above(p.liarCell, p.liarDigit)).toBeNull();
  });
});

describe("validateLiar — each criterion is detected", () => {
  const p = generateLiar({ difficulty: "medium", seed: "neg" });

  it("an honest liar passes with exact metadata", () => {
    const v = validateLiar(p.mission, { difficulty: "medium" });
    expect(v).toEqual({
      honest: true,
      liarCell: p.liarCell,
      suspects: [p.liarCell],
      solution: p.solution,
      contradictionDepth: p.meta.contradictionDepth,
      contradictionTechnique: p.meta.contradictionTechnique,
      minDepth: p.meta.minDepth,
      failures: [],
    });
    // Массив тоже принимается.
    expect(validateLiar(p.givens, { difficulty: "medium" }).honest).toBe(true);
  });

  it("not_refutable: a regular puzzle (no lie) has a solution", () => {
    const v = validateLiar(p.honestMission);
    expect(v.failures).toContain("not_refutable");
    expect(v.honest).toBe(false);
    expect(v.liarCell).toBeNull();
    expect(v.solution).toBeNull();
  });

  it("ambiguous: another clue's removal also yields solutions (verified by brute force)", () => {
    const base = generate({ difficulty: "expert", seed: "amb" });
    let found = false;
    for (let c = 0; c < 81 && !found; c++) {
      if (base.mission[c] !== "0") continue;
      for (const d of candidates(base.mission, c)) {
        if (String(d) === base.solution[c]) continue;
        const m = withCell(base.mission, c, d);
        const v = validateLiar(m);
        if (!v.failures.includes("ambiguous")) continue;
        expect(v.honest).toBe(false);
        expect(v.suspects.length).toBeGreaterThan(1);
        expect(v.suspects).toContain(c);
        expect(v.liarCell).toBeNull();
        expect(v.failures).toContain("not_resolvable");
        for (const s of v.suspects) expect(countSolutions(withCell(m, s, 0), 1)).toBe(1);
        // и каждая НЕ-подозреваемая подсказка действительно даёт 0 решений
        for (let x = 0; x < 81; x++) {
          if (m[x] === "0" || v.suspects.includes(x)) continue;
          expect(countSolutions(withCell(m, x, 0), 1)).toBe(0);
        }
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 60_000);

  it("not_resolvable: two lies — no single clue explains the contradiction", () => {
    // Вторая ложь в другую пустую клетку, не повторяющая соседей.
    let m: string | null = null;
    for (let c = 0; c < 81 && m === null; c++) {
      if (p.mission[c] !== "0") continue;
      for (const d of candidates(p.mission, c)) {
        if (String(d) !== p.solution[c]) {
          m = withCell(p.mission, c, d);
          break;
        }
      }
    }
    const v = validateLiar(m!);
    expect(v.failures).toContain("not_resolvable");
    expect(v.honest).toBe(false);
    expect(v.liarCell).toBeNull();
  });

  it("visible_at_start: a lie repeating a peer digit; and a hidden 'no place for a digit' is also visible", () => {
    // Повтор цифры соседа: ставим в клетку лжеца цифру подсказки-соседа по строке.
    const row = Math.floor(p.liarCell / 9);
    let peerDigit = 0;
    for (let col = 0; col < 9; col++) {
      const ch = p.honestMission[row * 9 + col]!;
      if (ch !== "0") peerDigit = Number(ch);
    }
    const dup = withCell(p.honestMission, p.liarCell, peerDigit);
    expect(conflicts(dup).length).toBeGreaterThan(0);
    expect(validateLiar(dup).failures).toContain("visible_at_start");
    // Пустая клетка без кандидатов → видно сразу.
    const g: CellValue[] = Array.from({ length: 81 }, () => 0);
    for (let i = 0; i < 8; i++) g[i] = (i + 1) as Digit; // r1: 1..8, r1c9 — только 9
    g[80] = 9; // 9 в столбце 9 → у r1c9 нет кандидатов, повторов нет
    expect(conflicts(g)).toEqual([]);
    expect(validateLiar(g).failures).toContain("visible_at_start");
  });

  it("too_shallow: boundary at minDepth", () => {
    const d = p.meta.contradictionDepth;
    expect(validateLiar(p.mission, { difficulty: "medium", minDepth: d }).honest).toBe(true);
    const v = validateLiar(p.mission, { difficulty: "medium", minDepth: d + 1 });
    expect(v.failures).toEqual(["too_shallow"]);
    expect(v.contradictionDepth).toBe(d);
  });

  it("not_deducible: the contradiction needs a technique above the ceiling", () => {
    let hit: { mission: string } | null = null;
    for (let i = 0; i < 20 && hit === null; i++) {
      const q = generateLiar({ difficulty: "hard", seed: `nd-${i}` });
      const v = validateLiar(q.mission, { maxTechnique: "naked_single" });
      if (v.failures.includes("not_deducible")) {
        expect(humanSolve(q.mission, { maxTechnique: "naked_single" }).contradiction).toBe(false);
        expect(v.contradictionDepth).toBeNull();
        expect(v.contradictionTechnique).toBeNull();
        hit = q;
      }
    }
    expect(hit).not.toBeNull();
  }, 60_000);

  it("difficulty option sets the ceiling; explicit maxTechnique wins", () => {
    // Для singles-класса потолок — hidden_single: глубина та же, что у humanSolve с этим потолком.
    const v = validateLiar(p.mission, { difficulty: "medium" });
    const res = humanSolve(p.mission, { maxTechnique: "hidden_single" });
    expect(v.contradictionDepth).toBe(res.steps.filter((s) => s.cell !== undefined).length);
    expect(validateLiar(p.mission, { difficulty: "medium", maxTechnique: "hidden_pair" }).contradictionDepth).toBe(
      humanSolve(p.mission).steps.filter((s) => s.cell !== undefined).length,
    );
  });

  it("rejects bad options", () => {
    expect(() => validateLiar(p.mission, { minDepth: -1 })).toThrow(RangeError);
    expect(() => validateLiar(p.mission, { minDepth: 1.5 })).toThrow(RangeError);
    expect(() => validateLiar(p.mission, { difficulty: "toString" as Difficulty })).toThrow(RangeError);
    expect(() => validateLiar("123")).toThrow(RangeError);
  });
});

describe("accuse", () => {
  const p = generateLiar({ difficulty: "easy", seed: "acc" });
  const honestGiven = p.mission.split("").findIndex((ch, i) => ch !== "0" && i !== p.liarCell);
  const empty = p.mission.indexOf("0");

  it("liar / honest / not_a_given", () => {
    expect(accuse(p, p.liarCell)).toEqual({ kind: "liar", cell: p.liarCell, trueDigit: p.trueDigit });
    expect(accuse(p, honestGiven)).toEqual({ kind: "honest", cell: honestGiven });
    expect(accuse(p, empty)).toEqual({ kind: "not_a_given", cell: empty });
    // '.' — тоже пусто.
    const dotted = { ...p, mission: p.mission.replaceAll("0", ".") };
    expect(accuse(dotted, empty).kind).toBe("not_a_given");
  });

  it("every given except the liar is honest", () => {
    for (let c = 0; c < 81; c++) {
      const k = accuse(p, c).kind;
      if (c === p.liarCell) expect(k).toBe("liar");
      else expect(k).toBe(p.mission[c] === "0" ? "not_a_given" : "honest");
    }
  });

  it("RangeError on a bad cell", () => {
    for (const c of [-1, 81, 1.5, Number.NaN]) expect(() => accuse(p, c)).toThrow(RangeError);
  });
});

describe("liarSummary", () => {
  const p = generateLiar({ difficulty: "easy", seed: "sum" });
  const honestGiven = p.mission.split("").findIndex((ch, i) => ch !== "0" && i !== p.liarCell);
  const empty = p.mission.indexOf("0");
  const place = (t: number, cell: number, extra: Partial<Move> = {}): Move => ({ t, cell, kind: "place", digit: 1, ...extra });
  const log: Move[] = [
    place(100, 1),
    { t: 150, cell: 1, kind: "note_add", digit: 2 },
    place(200, 2),
    { t: 250, cell: 2, kind: "erase" },
    place(300, 3, { correct: false, blot: true }),
    place(300, 3, { correct: true, blot: true }), // авто-замена кляксы — не постановка игрока
    place(400, 4),
  ];

  it("not caught", () => {
    expect(liarSummary(p, [], log)).toEqual({
      caught: false,
      wrongAccusations: 0,
      firstTry: false,
      catchT: null,
      catchPlacement: null,
      invalidAccusations: 0,
    });
    expect(liarSummary(p, [{ t: 10, cell: honestGiven, moveIndex: 0 }], log).wrongAccusations).toBe(1);
  });

  it("first-try catch counts player placements before moveIndex (blot auto-replacement excluded)", () => {
    const acc: Accusation[] = [{ t: 350, cell: p.liarCell, moveIndex: 6 }];
    // до индекса 6: place(1), place(2), place(3, клякса) — 3; erase/note/авто-замена не считаются
    expect(liarSummary(p, acc, log)).toEqual({
      caught: true,
      wrongAccusations: 0,
      firstTry: true,
      catchT: 350,
      catchPlacement: 3,
      invalidAccusations: 0,
    });
    expect(liarSummary(p, [{ t: 0, cell: p.liarCell, moveIndex: 0 }], log).catchPlacement).toBe(0);
    expect(liarSummary(p, [{ t: 999, cell: p.liarCell, moveIndex: log.length }], log).catchPlacement).toBe(4);
  });

  it("wrong then right: not first try; invalid accusations do not count; later catches ignored", () => {
    const acc: Accusation[] = [
      { t: 120, cell: empty, moveIndex: 1 },
      { t: 210, cell: honestGiven, moveIndex: 3 },
      { t: 260, cell: p.liarCell, moveIndex: 4 },
      { t: 500, cell: p.liarCell, moveIndex: 7 },
      { t: 600, cell: honestGiven, moveIndex: 7 },
    ];
    expect(liarSummary(p, acc, log)).toEqual({
      caught: true,
      wrongAccusations: 2,
      firstTry: false,
      catchT: 260,
      catchPlacement: 2,
      invalidAccusations: 1,
    });
    // невалидное обвинение до верного не отнимает «с первой попытки»
    expect(
      liarSummary(
        p,
        [
          { t: 1, cell: empty, moveIndex: 0 },
          { t: 2, cell: p.liarCell, moveIndex: 0 },
        ],
        log,
      ).firstTry,
    ).toBe(true);
  });

  it("RangeError on moveIndex outside the log", () => {
    for (const moveIndex of [-1, log.length + 1, 0.5]) {
      expect(() => liarSummary(p, [{ t: 0, cell: p.liarCell, moveIndex }], log)).toThrow(RangeError);
    }
  });
});

describe("performance smoke", () => {
  it("easy + medium liar < 3 s together", () => {
    const t0 = Date.now();
    generateLiar({ difficulty: "easy", seed: "perf" });
    generateLiar({ difficulty: "medium", seed: "perf" });
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 60_000);
});
