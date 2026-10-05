/**
 * Лжец (PD-165, PD-172, PD-174): генератор, критерий честности, обвинение, метрики.
 *
 * Свойства проверяются НЕЗАВИСИМО от реализации критерия: перебором `countSolutions` по каждой подсказке
 * (а не через таблицу покрытия генератора), `conflicts`/`candidates`, `humanSolve`. «Тяжёлый» прогон по
 * всем классам — `liar.heavy.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  LIAR_DEFAULT_MAX_BASES,
  LIAR_MIN_DEPTH,
  LIAR_VERSION,
  Rng,
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
import { contradictionDepth, contradictionWave, lieChecker } from "./liar.js";
import {
  CEILING,
  TIER,
  assertHonestLiar,
  closedWaveReaches,
  earliestWithinOrders,
  earliestWithin,
  randomOrderDepth,
  toCells,
  visibleNow,
  withCell,
} from "./liar.test-util.js";

const TIERS = ["naked_single", "hidden_single", "locked_candidates", "naked_pair", "hidden_pair"];
const tierOf = (d: Difficulty): number => TIERS.indexOf(CEILING[d]);

/** QA PD-166: Лжец v1 для easy seed 'qa166-0' — у клеток 54/61/63 на старте единственный кандидат 5. */
/** Пороги `LIAR_MIN_DEPTH` (PD-174) — менять вместе с README и `LIAR_VERSION`. */
const EXPECTED_MIN_DEPTH = { easy: 4, medium: 4, hard: 5, expert: 4, master: 4 };

const QA166_V1_EASY = "690200030008043690304009001000720000400190080800054269002901703009472000100600924";

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
        "liarCell": 31,
        "liarDigit": 2,
        "mission": "020080504045200807080547360000020405004001709850700100460802000590003670010065200",
      }
    `);
    expect({ mission: m.mission, liarCell: m.liarCell, liarDigit: m.liarDigit }).toMatchInlineSnapshot(`
      {
        "liarCell": 61,
        "liarDigit": 1,
        "mission": "040050100057300400090480523002003000069002000000006802978004010016000340000000090",
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
    for (const bad of ["nope", "constructor", "toString", 5, undefined]) {
      expect(() => dailyLiarSeed("2026-10-04", bad as unknown as Difficulty)).toThrow(RangeError);
      expect(() => dailyLiarPuzzle("2026-10-04", bad as unknown as Difficulty)).toThrow(RangeError);
    }
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
    it(`${difficulty}: every (cell, digit) gets the same verdict (class threshold and threshold 0)`, () => {
      const base = generate({ difficulty, seed });
      const tier = tierOf(difficulty);
      const minDepth = LIAR_MIN_DEPTH[difficulty];
      const check = lieChecker(base.mission, base.solution, tier, minDepth);
      const check0 = lieChecker(base.mission, base.solution, tier, 0);
      let accepted0 = 0;
      let checked = 0;
      for (let c = 0; c < 81; c++) {
        if (base.mission[c] !== "0") continue;
        for (let d = 1; d <= 9; d++) {
          if (String(d) === base.solution[c]) {
            expect(check(c, d as Digit)).toBeNull();
            continue;
          }
          const m = withCell(base.mission, c, d);
          const fast = check(c, d as Digit);
          const full = validateLiar(m, { difficulty });
          if ((fast !== null) !== full.honest) throw new Error(`verdict mismatch at ${c}=${d}: fast ${fast !== null}, full ${full.honest}`);
          if (fast !== null) expect(fast).toEqual({ depth: full.contradictionDepth, technique: full.contradictionTechnique });
          const fast0 = check0(c, d as Digit) !== null;
          if (fast0 !== validateLiar(m, { difficulty, minDepth: 0 }).honest) throw new Error(`verdict mismatch (minDepth 0) at ${c}=${d}`);
          if (fast0) accepted0++;
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
      // Нетривиальность выборки: проверщик и принимает, и отвергает.
      expect(accepted0).toBeLessThan(checked);
      if (difficulty !== "hard") expect(accepted0).toBeGreaterThan(0);
      // Непустая клетка — не кандидат.
      const given = base.mission.split("").findIndex((ch) => ch !== "0");
      expect(check(given, 1)).toBeNull();
    }, 300_000);
  }
});

describe("lieChecker — slow path and depth boundary", () => {
  it("coverageLimit 1 (every clue checked one by one) gives the same verdicts as the coverage table", () => {
    const base = generate({ difficulty: "medium", seed: "slow-path" });
    const fast = lieChecker(base.mission, base.solution, 1, 0);
    const slow = lieChecker(base.mission, base.solution, 1, 0, { coverageLimit: 1 });
    let accepted = 0;
    let rejectedByAmbiguity = 0;
    for (let c = 0; c < 81; c++) {
      if (base.mission[c] !== "0") continue;
      for (let d = 1; d <= 9; d++) {
        const a = fast(c, d as Digit);
        expect(slow(c, d as Digit)).toEqual(a);
        if (a !== null) accepted++;
        else if (String(d) !== base.solution[c] && validateLiar(withCell(base.mission, c, d), { difficulty: "medium", minDepth: 0 }).failures.includes("ambiguous")) {
          rejectedByAmbiguity++;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejectedByAmbiguity).toBeGreaterThan(0);
  }, 120_000);

  it("minDepth boundary: depth == minDepth accepted, minDepth + 1 rejected", () => {
    const p = exactDepthLiar();
    const d = p.meta.contradictionDepth;
    const at = lieChecker(p.honestMission, p.solution, 1, d);
    const above = lieChecker(p.honestMission, p.solution, 1, d + 1);
    expect(at(p.liarCell, p.liarDigit)).toEqual({ depth: d, technique: p.meta.contradictionTechnique });
    expect(above(p.liarCell, p.liarDigit)).toBeNull();
  }, 60_000);
});

/** Medium-Лжец, у которого глубина ровно порог (значит, посчитана точно, а не нижней оценкой). */
function exactDepthLiar(): LiarPuzzle {
  for (let i = 0; ; i++) {
    const p = generateLiar({ difficulty: "medium", seed: `depth-boundary-${i}` });
    if (p.meta.contradictionDepth === LIAR_MIN_DEPTH.medium) return p;
  }
}

describe("criterion 4 (PD-172): no early contradiction under ANY order of moves", () => {
  it("QA PD-166 regression: two forced singles of one digit in a unit are visible at start", () => {
    const g = toCells(QA166_V1_EASY);
    for (const c of [54, 61, 63]) expect(candidates(QA166_V1_EASY, c)).toEqual([5]);
    expect(conflicts(QA166_V1_EASY)).toEqual([]);
    expect(visibleNow(g)).toMatch(/two singles of 5/);
    const v = validateLiar(QA166_V1_EASY, { difficulty: "easy" });
    expect(v.failures).toContain("visible_at_start");
    expect(v.failures).toContain("too_shallow");
    expect(v.contradictionDepth).toBe(0);
    expect(v.honest).toBe(false);
    // Новый генератор на том же seed даёт другую, честную сетку.
    const p = generateLiar({ difficulty: "easy", seed: "qa166-0" });
    expect(p.mission).not.toBe(QA166_V1_EASY);
    assertHonestLiar(p);
  }, 60_000);

  it("a cell forced to two digits (two hidden singles) is visible at start", () => {
    // r1c1 — единственное место для 1 в строке 1 и для 2 в столбце 1; повторов и пустых клеток без кандидатов нет.
    const g: CellValue[] = Array.from({ length: 81 }, () => 0);
    g[1] = 3;
    g[2] = 4;
    g[9] = 5;
    g[12] = 1;
    g[18] = 6;
    g[24] = 1;
    g[37] = 2;
    g[65] = 2;
    expect(conflicts(g)).toEqual([]);
    for (let c = 0; c < 81; c++) if (g[c] === 0) expect(candidates(g, c).length).toBeGreaterThan(0);
    expect(visibleNow(g as number[])).toMatch(/cell 0 forced to/);
    expect(validateLiar(g).failures).toContain("visible_at_start");
  });

  it("thresholds: per class, documented in README; every class is at least 1 (PD-174)", () => {
    expect(LIAR_MIN_DEPTH).toEqual(EXPECTED_MIN_DEPTH);
    for (const d of Object.values(LIAR_MIN_DEPTH)) expect(d).toBeGreaterThanOrEqual(1);
    expect(Object.isFrozen(LIAR_MIN_DEPTH)).toBe(true);
  });

  for (const difficulty of ["easy", "medium", "hard"] as const) {
    it(`${difficulty}: exhaustive and random orders of moves never see the lie before the threshold`, () => {
      const min = LIAR_MIN_DEPTH[difficulty];
      const tier = TIER[difficulty];
      const n = difficulty === "hard" ? 6 : 15;
      const rng = new Rng(`orders-${difficulty}`);
      const randomDepths: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = generateLiar({ difficulty, seed: `orders-${difficulty}-${i}` });
        expect(visibleNow(toCells(p.mission), tier)).toBeNull();
        expect(earliestWithin(toCells(p.mission), min - 1, tier)).toBeNull();
        for (let r = 0; r < 30; r++) {
          const d = randomOrderDepth(toCells(p.mission), rng, tier);
          if (d !== null) {
            expect(d).toBeGreaterThanOrEqual(min);
            randomDepths.push(d);
          }
        }
      }
      expect(randomDepths.length).toBeGreaterThan(0);
    }, 300_000);
  }

  it("the threshold is tight: the engine's depth equals the exhaustive singles search when it is exact", () => {
    const p = exactDepthLiar();
    // singles-класс: глубина критерия = минимум по всем порядкам синглов (независимый перебор).
    expect(earliestWithin(toCells(p.mission), p.meta.contradictionDepth)).toBe(p.meta.contradictionDepth);
  }, 60_000);
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

  it("ambiguous: two liar candidates (another clue's removal also gives a UNIQUE solution) — rejected", () => {
    const base = generate({ difficulty: "expert", seed: "amb" });
    const check = lieChecker(base.mission, base.solution, TIER.expert, 0);
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
        // Генератор такую ложь не берёт ни при каком пороге.
        expect(check(c, d as Digit)).toBeNull();
        for (const s of v.suspects) expect(countSolutions(withCell(m, s, 0), 2)).toBe(1);
        // и ни одна НЕ-подозреваемая подсказка не даёт единственного решения (0 или ≥ 2)
        for (let x = 0; x < 81; x++) {
          if (m[x] === "0" || v.suspects.includes(x)) continue;
          expect(countSolutions(withCell(m, x, 0), 2)).not.toBe(1);
        }
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 60_000);

  it("PD-174: a clue whose removal gives ≥ 2 solutions is NOT a liar candidate (report 05 criterion)", () => {
    // Ищем сгенерированного Лжеца, у которого есть честная подсказка, без которой решений ≥ 2: по строгому
    // критерию PD-165 он был бы отвергнут, по критерию однозначности — честный.
    let found: { p: LiarPuzzle; x: number } | null = null;
    for (let i = 0; i < 40 && found === null; i++) {
      const p = generateLiar({ difficulty: "hard", seed: `weak-${i}` });
      for (let x = 0; x < 81 && found === null; x++) {
        if (x === p.liarCell || p.mission[x] === "0") continue;
        if (countSolutions(withCell(p.mission, x, 0), 2) === 2) found = { p, x };
      }
    }
    expect(found).not.toBeNull();
    const { p, x } = found!;
    const v = validateLiar(p.mission, { difficulty: "hard" });
    expect(v.honest).toBe(true);
    expect(v.suspects).toEqual([p.liarCell]);
    expect(v.suspects).not.toContain(x);
    assertHonestLiar(p);
  }, 120_000);

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
    const q = exactDepthLiar();
    const d = q.meta.contradictionDepth;
    expect(validateLiar(q.mission, { difficulty: "medium", minDepth: d }).honest).toBe(true);
    const v = validateLiar(q.mission, { difficulty: "medium", minDepth: d + 1 });
    expect(v.failures).toEqual(["too_shallow"]);
    expect(v.contradictionDepth).toBe(d);
  });

  it("visible_at_start (PD-174): a lie visible only through the class techniques (locked / pairs) is rejected", () => {
    // Для каждого яруса ищем ложь, которую синглы на старте не видят, а вычёркивания яруса без постановок — видят.
    for (const [difficulty, tier, lowerTier, lowerTechnique] of [
      ["hard", TIER.hard, 1, "hidden_single"],
      ["expert", TIER.expert, TIER.hard, "locked_candidates"],
    ] as const) {
      let found = false;
      for (let i = 0; i < 10 && !found; i++) {
        const base = generate({ difficulty, seed: `vis-${difficulty}-${i}` });
        const check = lieChecker(base.mission, base.solution, tier, 0);
        const checkLower = lieChecker(base.mission, base.solution, lowerTier, 0);
        for (let c = 0; c < 81 && !found; c++) {
          if (base.mission[c] !== "0") continue;
          for (const d of candidates(base.mission, c)) {
            if (String(d) === base.solution[c]) continue;
            const m = withCell(base.mission, c, d);
            // Независимая модель: ниже потолка класса на старте не видно, с потолком — видно.
            if (visibleNow(toCells(m), lowerTier) !== null || visibleNow(toCells(m), tier) === null) continue;
            // Движок с потолком ниже класса ложь принял бы. (Пары немонотонны: в редких случаях независимая модель в
            // своём порядке вычёркиваний видит ложь, а решатель в своём — нет; такие кандидаты здесь не берём —
            // README «Лжец → модель игрока».)
            if (checkLower(c, d as Digit) === null) continue;
            if (check(c, d as Digit) !== null) continue;
            const v = validateLiar(m, { difficulty, minDepth: 0 });
            expect(v.failures).toContain("visible_at_start");
            expect(v.honest).toBe(false);
            expect(validateLiar(m, { maxTechnique: lowerTechnique, minDepth: 0 }).failures).not.toContain("visible_at_start");
            found = true;
            break;
          }
        }
      }
      expect(found, `no ${difficulty} lie visible only via its class techniques`).toBe(true);
    }
  }, 300_000);

  it("visible_at_start: a generated lie visible to singles at start is rejected by the generator and the validator", () => {
    const base = generate({ difficulty: "medium", seed: "vis-singles" });
    const check = lieChecker(base.mission, base.solution, 1, 0);
    let seen = 0;
    for (let c = 0; c < 81; c++) {
      if (base.mission[c] !== "0") continue;
      for (const d of candidates(base.mission, c)) {
        if (String(d) === base.solution[c]) continue;
        const m = withCell(base.mission, c, d);
        if (visibleNow(toCells(m)) === null) continue;
        expect(check(c, d as Digit)).toBeNull();
        expect(validateLiar(m, { difficulty: "medium" }).failures).toContain("visible_at_start");
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 120_000);

  it("not_deducible: no contradiction is reachable within the ceiling", () => {
    // Обычная hard-сетка: противоречия нет вообще, а одними naked singles она к тому же не решается.
    const base = generate({ difficulty: "hard", seed: "nd" });
    const v = validateLiar(base.mission, { maxTechnique: "naked_single" });
    expect(v.failures).toContain("not_deducible");
    expect(v.contradictionDepth).toBeNull();
    expect(v.contradictionTechnique).toBeNull();
    expect(humanSolve(base.mission, { maxTechnique: "naked_single" }).contradiction).toBe(false);
  });

  it("difficulty option sets the ceiling and the default threshold; explicit maxTechnique wins", () => {
    const v = validateLiar(p.mission, { difficulty: "medium" });
    expect(v.minDepth).toBe(LIAR_MIN_DEPTH.medium);
    expect(validateLiar(p.mission).minDepth).toBe(0);
    expect(validateLiar(p.mission, { difficulty: "expert" }).minDepth).toBe(LIAR_MIN_DEPTH.expert);
    // Тот же потолок явно — та же глубина.
    expect(validateLiar(p.mission, { maxTechnique: "hidden_single", minDepth: v.minDepth }).contradictionDepth).toBe(
      v.contradictionDepth,
    );
    // Потолок выше — противоречие не позже.
    const all = validateLiar(p.mission, { difficulty: "medium", maxTechnique: "hidden_pair" });
    expect(all.contradictionDepth!).toBeLessThanOrEqual(v.contradictionDepth!);
  });

  it("rejects bad options", () => {
    expect(() => validateLiar(p.mission, { minDepth: -1 })).toThrow(RangeError);
    expect(() => validateLiar(p.mission, { minDepth: 1.5 })).toThrow(RangeError);
    expect(() => validateLiar(p.mission, { difficulty: "toString" as Difficulty })).toThrow(RangeError);
    expect(() => validateLiar("123")).toThrow(RangeError);
  });
});

describe("mutation guards (PD-177, QA PD-166b M4/M5/M17)", () => {
  /**
   * Hard-ложь, сгенерированная под мутацией M4 (hard считается в порядке решателя, seed `qa-m4-0`): в порядке
   * решателя глубина 6, в замкнутой форме locked candidates (PD-174) — 4 < порога 5. Лжец 4 = цифра 5.
   */
  const HARD_CLOSED_DEPTH_4 = "600580720907300500000000001046000082700006000320000100000100403004025007000003000";

  it("M4: hard depth is the closed locked-candidates form (PD-174), not the solver order", () => {
    const g = toCells(HARD_CLOSED_DEPTH_4);
    // Независимая замкнутая волна — нижняя оценка по всем игрокам — уже ниже порога.
    expect(closedWaveReaches(g, TIER.hard)).toBeLessThan(LIAR_MIN_DEPTH.hard);
    const v = validateLiar(HARD_CLOSED_DEPTH_4, { difficulty: "hard" });
    expect(v.suspects).toEqual([4]);
    expect(v.contradictionDepth).toBe(4);
    expect(v.failures).toEqual(["too_shallow"]);
    expect(v.honest).toBe(false);
  }, 60_000);

  it("M5: exactly two suspects is already ambiguous", () => {
    // Medium-основа `amb2` + ложь 4 в r1c8: удаление r1c8 и r4c4 даёт по единственному решению.
    const m = "506021749003000201000000060061205807900006300070010000600000008400560900002003006";
    const independent: number[] = [];
    for (let x = 0; x < 81; x++) if (m[x] !== "0" && countSolutions(withCell(m, x, 0), 2) === 1) independent.push(x);
    expect(independent).toEqual([7, 30]);
    const v = validateLiar(m);
    expect(v.suspects).toEqual([7, 30]);
    expect(v.failures).toEqual(["ambiguous", "not_resolvable"]);
    expect(v.liarCell).toBeNull();
    expect(v.honest).toBe(false);
  });

  it("M17: the wave probe uses closed hidden pairs (expert/master lower bound = independent closed model)", () => {
    // Expert-основа `wave-1` + ложь 6 в r2c3: противоречие видно на старте только через замкнутую hidden pair.
    const m = "070060045506900000003080000090800361007090000000302000004001800000050100900000007";
    expect(closedWaveReaches(toCells(m), 3)).toBe(2);
    expect(closedWaveReaches(toCells(m), 4)).toBe(0);
    expect(contradictionWave(m, 3)).toBe(2);
    expect(contradictionWave(m, 4)).toBe(0);
    // Сверка на всех лжах одной expert-основы: фикс-точка монотонных правил не зависит от порядка — совпадение точное.
    const base = generate({ difficulty: "expert", seed: "wave-1" });
    let checked = 0;
    let pairsMatter = 0;
    for (let c = 0; c < 81; c++) {
      if (base.mission[c] !== "0") continue;
      for (const d of candidates(base.mission, c)) {
        if (String(d) === base.solution[c]) continue;
        const lie = withCell(base.mission, c, d);
        for (const t of [2, 3, 4]) {
          const mine = contradictionWave(lie, t);
          if (mine !== closedWaveReaches(toCells(lie), t)) throw new Error(`wave mismatch at ${c}=${d}, tier ${t}`);
          checked++;
        }
        if (contradictionWave(lie, 4) !== contradictionWave(lie, 3)) pairsMatter++;
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(pairsMatter).toBeGreaterThan(0);
  }, 120_000);
});

describe("PD-177: expert/master — other orders of eliminations (QA PD-166b)", () => {
  // Сетки `LIAR_VERSION` 3 (только порядок решателя): другой порядок вычёркиваний пар/locked видел ложь на 3-й
  // постановке при пороге 4.
  const V3 = {
    "qa166b-4655096ef6f8": "000000073008500000047019200800060000005002090200700000060003009090607180000000400",
    "2026-10-09/liar/master": "230010000008700030070000405000060000000504009002001380000000000080103096607000050",
  } as const;

  it("(a) in other orders: a lie the solver order does not see at start, but another order does — visible_at_start, depth 0", () => {
    // Expert-основа `vis-sweep-0` + ложь 3 в r1c5: порядок решателя на старте противоречия не видит (глубина 1),
    // применение другого шага первым — видит.
    const m = "700030200000000409100058000000079002060003900970004601000821000030000000000090700";
    const v = validateLiar(m, { difficulty: "expert", minDepth: 0 });
    expect(v.failures).toEqual(["visible_at_start"]);
    expect(v.contradictionDepth).toBe(0);
    expect(validateLiar(m, { difficulty: "expert" }).failures).toEqual(["visible_at_start", "too_shallow"]);
  }, 60_000);

  for (const [seed, mission] of Object.entries(V3)) {
    it(`master ${seed} (v3): too_shallow — depth 3 in another order`, () => {
      // Независимая модель: свой порядок вычёркиваний, состояния склеиваются по значениям И кандидатам.
      expect(earliestWithinOrders(toCells(mission), 3, TIER.master, 1, "pd177")).toBe(3);
      const v = validateLiar(mission, { difficulty: "master" });
      expect(v.contradictionDepth).toBe(3);
      expect(v.failures).toEqual(["too_shallow"]);
      // Генератор тот же seed больше не принимает: новая сетка, глубже порога и в той же независимой модели.
      const p = generateLiar({ difficulty: "master", seed });
      expect(p.mission).not.toBe(mission);
      expect(p.meta.contradictionDepth).toBeGreaterThanOrEqual(LIAR_MIN_DEPTH.master);
      expect(earliestWithinOrders(toCells(p.mission), LIAR_MIN_DEPTH.master - 1, TIER.master, 1, "pd177")).toBeNull();
    }, 300_000);
  }
});

describe("mutation guards: settleSweep (PD-186, QA PD-179 M23/M24/M27)", () => {
  // Лжи на основах `generate({ difficulty, seed: "pd186-N" })`: ложь видна на 1-й постановке только с вычёркиваниями
  // `settleSweep`. С поиском до 1 постановки (`cap` 1 — другие порядки только на старте) глубина 2: порядок решателя
  // ложь на 1-й постановке не видит. Под мутацией — глубина 2+ и с `cap` 2, и критерий (в) с minDepth 2 проходит.

  it("M23: sweep continues each first step in BOTH orders (solver order too, not only reverse)", () => {
    // Expert-основа `pd186-1` + ложь 1 в r3c1 (единственный кандидат в лжецы — клетка 18).
    const m = "057080900800460000100200030000002400030000008090035700004070100060190070000000000";
    expect(contradictionDepth(m, TIER.expert, 1)).toBe(2);
    expect(contradictionDepth(m, TIER.expert, 2)).toBe(1); // под M23 — 2
    const v = validateLiar(m, { difficulty: "expert", minDepth: 2 });
    expect(v.suspects).toEqual([18]);
    expect(v.contradictionDepth).toBe(1);
    expect(v.failures).toEqual(["too_shallow"]);
  }, 60_000);

  it("M24: sweep repeats rounds while the union grows (one round is not the fixpoint)", () => {
    // Master-основа `pd186-4` + ложь 3 в r7c5.
    const m = "009000002000400010000010700060370200008000400000501080075030600800004000910006050";
    expect(contradictionDepth(m, TIER.master, 1)).toBe(2);
    expect(contradictionDepth(m, TIER.master, 2)).toBe(1); // под M24 — 2
    const v = validateLiar(m, { difficulty: "master", minDepth: 2 });
    expect(v.contradictionDepth).toBe(1);
    expect(v.failures).toEqual(["ambiguous", "not_resolvable", "too_shallow"]);
  }, 60_000);

  it("M27: player steps of the sweep include naked pairs", () => {
    // Expert-основа `pd186-0` + ложь 2 в r6c1.
    const m = "000805002000906100000000370090400805100000090204000600002100400000083200080000001";
    expect(contradictionDepth(m, TIER.expert, 1)).toBe(2);
    expect(contradictionDepth(m, TIER.expert, 2)).toBe(1); // под M27 — 2
    const v = validateLiar(m, { difficulty: "expert", minDepth: 2 });
    expect(v.contradictionDepth).toBe(1);
    expect(v.failures).toEqual(["ambiguous", "not_resolvable", "too_shallow"]);
  }, 60_000);
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
      repeatedAccusations: 0,
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
      repeatedAccusations: 0,
    });
    expect(liarSummary(p, [{ t: 0, cell: p.liarCell, moveIndex: 0 }], log).catchPlacement).toBe(0);
    expect(liarSummary(p, [{ t: 999, cell: p.liarCell, moveIndex: log.length }], log).catchPlacement).toBe(4);
  });

  it("wrong then right: not first try; invalid accusations do not count; repeats are ignored", () => {
    const acc: Accusation[] = [
      { t: 120, cell: empty, moveIndex: 1 },
      { t: 210, cell: honestGiven, moveIndex: 3 },
      { t: 260, cell: p.liarCell, moveIndex: 4 },
      { t: 500, cell: p.liarCell, moveIndex: 7 },
      { t: 600, cell: honestGiven, moveIndex: 7 },
    ];
    expect(liarSummary(p, acc, log)).toEqual({
      caught: true,
      wrongAccusations: 1,
      firstTry: false,
      catchT: 260,
      catchPlacement: 2,
      invalidAccusations: 1,
      repeatedAccusations: 2,
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

  it("repeated accusation of one cell: deterministic, only the first verdict counts", () => {
    // Повтор честной подсказки не добавляет неверных и не отнимает «с первой попытки» у следующего верного.
    const twiceWrong: Accusation[] = [
      { t: 1, cell: honestGiven, moveIndex: 0 },
      { t: 2, cell: honestGiven, moveIndex: 0 },
      { t: 3, cell: p.liarCell, moveIndex: 1 },
    ];
    const s = liarSummary(p, twiceWrong, log);
    expect(s).toMatchObject({ caught: true, wrongAccusations: 1, firstTry: false, catchT: 3, repeatedAccusations: 1 });
    // Повтор лжеца после поимки — ничего не меняет; повтор пустой клетки — тоже.
    const twiceLiar: Accusation[] = [
      { t: 5, cell: p.liarCell, moveIndex: 2 },
      { t: 6, cell: p.liarCell, moveIndex: 3 },
      { t: 7, cell: empty, moveIndex: 3 },
      { t: 8, cell: empty, moveIndex: 3 },
    ];
    expect(liarSummary(p, twiceLiar, log)).toEqual({
      caught: true,
      wrongAccusations: 0,
      firstTry: true,
      catchT: 5,
      catchPlacement: 1,
      invalidAccusations: 1,
      repeatedAccusations: 2,
    });
    // Та же последовательность — тот же результат; accuse — чистая функция.
    expect(liarSummary(p, twiceLiar, log)).toEqual(liarSummary(p, [...twiceLiar], log));
    expect(accuse(p, p.liarCell)).toEqual(accuse(p, p.liarCell));
    // Повтор с некорректным moveIndex — всё равно RangeError (валидация до дедупликации).
    expect(() => liarSummary(p, [twiceLiar[0]!, { t: 9, cell: p.liarCell, moveIndex: -1 }], log)).toThrow(RangeError);
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
