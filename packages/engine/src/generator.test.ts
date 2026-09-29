import { describe, expect, it } from "vitest";
import { generateWithStats } from "./generator.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DIFFICULTIES,
  GenerationError,
  Rng,
  countSolutions,
  dailyPuzzle,
  dailySeed,
  formatGrid,
  generate,
  rateDifficulty,
  solve,
} from "./index.js";

/**
 * Снапшоты: одна и та же seed-строка обязана давать байт-в-байт ту же сетку в любой сессии
 * и на любой платформе. Если генератор меняется намеренно — обновить строки осознанно
 * (это ломает «сетку дня» для всех, кто уже играл по фолбэку).
 */
const SNAPSHOTS = [
  {
    seed: "2026-09-29",
    difficulty: "easy",
    mission: "104708500025030704087009020050060070270300019009017000503072001700150000608003250",
    solution: "164728593925631784387549126851964372276385419439217865593872641742156938618493257",
  },
  {
    seed: "2026-09-29",
    difficulty: "medium",
    mission: "400600370000010020200000054030900401891400532040100000054001007107050000000300000",
    solution: "415628379973514826268793154732985461891476532546132798354261987127859643689347215",
  },
  {
    seed: "2026-09-29",
    difficulty: "hard",
    mission: "000089100002100000000050370005043000090600002000008934720090003000000080006005090",
    solution: "673489125952137648418256379285943716394671852167528934721894563539762481846315297",
  },
  {
    seed: "2026-09-29",
    difficulty: "expert",
    mission: "830901020000850030001070000005300600000549070400000800602000080000000005190000300",
    solution: "834961527967852431521473968215387694386549172479216853652134789743698215198725346",
  },
  {
    seed: "pundoku",
    difficulty: "hard",
    mission: "007908000000300205504000030000000090003502000000830007600000000720000400000040018",
    solution: "237958164986314275514627839875461392493572681162839547641785923728193456359246718",
  },
] as const;

describe("generate — reproducibility", () => {
  for (const snap of SNAPSHOTS) {
    it(`${snap.difficulty} / '${snap.seed}' matches the stored snapshot`, () => {
      const a = generate({ difficulty: snap.difficulty, seed: snap.seed });
      const b = generate({ difficulty: snap.difficulty, seed: snap.seed });
      expect(a.mission).toBe(snap.mission);
      expect(a.solution).toBe(snap.solution);
      expect(b).toEqual(a);
      expect(a.difficulty).toBe(snap.difficulty);
      expect(a.givens.join("")).toBe(snap.mission);
      expect(a.seed).toBe(snap.seed);
    });
  }

  it("different seeds or difficulties give different puzzles", () => {
    const a = generate({ difficulty: "medium", seed: "a" });
    const b = generate({ difficulty: "medium", seed: "b" });
    const c = generate({ difficulty: "hard", seed: "a" });
    expect(a.mission).not.toBe(b.mission);
    expect(a.mission).not.toBe(c.mission);
  });

  it("Rng is deterministic and platform-independent (fixed first values)", () => {
    const r = new Rng("2026-09-29");
    const first = [r.nextU32(), r.nextU32(), r.nextU32()];
    const r2 = new Rng("2026-09-29");
    expect([r2.nextU32(), r2.nextU32(), r2.nextU32()]).toEqual(first);
    expect(first.every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32)).toBe(true);
    expect(new Rng("2026-09-30").nextU32()).not.toBe(first[0]);
  });
});

describe("generate — validity", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty}: unique solution, solve() matches, rating matches, techniques listed`, () => {
      const p = generate({ difficulty, seed: `validity-${difficulty}` });
      expect(p.mission).toHaveLength(81);
      expect(p.solution).toHaveLength(81);
      expect(countSolutions(p.mission)).toBe(1);
      expect(formatGrid(solve(p.mission)!)).toBe(p.solution);
      expect(rateDifficulty(p.mission)).toBe(difficulty);
      expect(p.techniques.length).toBeGreaterThan(0);
      if (difficulty === "expert") expect(p.techniques.at(-1)).toBe("beyond");
      else expect(p.techniques).not.toContain("beyond");
      // Подсказки миссии совпадают с решением.
      for (let i = 0; i < 81; i++) if (p.mission[i] !== "0") expect(p.mission[i]).toBe(p.solution[i]);
    });
  }

  it("throws GenerationError when attempts are exhausted", () => {
    expect(() => generate({ difficulty: "expert", seed: "x", maxAttempts: 0 })).toThrow(GenerationError);
  });
});

describe("generate — maxAttempts (PD-8 d)", () => {
  // 'measure2-811' / hard по замеру требует 74 попытки — «хвост» распределения (медиана hard ≈ 6).
  const TAIL = { difficulty: "hard", seed: "measure2-811", attempts: 74 } as const;

  it("default ceiling is 300 (было 100 — на грани для хвоста hard)", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(300);
  });

  it("a tail seed needs many attempts; ceiling below that throws, default succeeds", () => {
    const { puzzle, attempts } = generateWithStats({ difficulty: TAIL.difficulty, seed: TAIL.seed });
    expect(attempts).toBe(TAIL.attempts);
    expect(() => generate({ difficulty: TAIL.difficulty, seed: TAIL.seed, maxAttempts: TAIL.attempts - 1 })).toThrow(GenerationError);
    expect(generate({ difficulty: TAIL.difficulty, seed: TAIL.seed }).mission).toBe(puzzle.mission);
  }, 120_000);

  it("RNG is sequential: raising maxAttempts never changes an existing grid", () => {
    // Сетки, которые укладывались в старые 100 попыток, байт-в-байт те же при любом потолке ≥ их числа попыток.
    for (const seed of ["2026-09-29", "pundoku", "measure-3"]) {
      const { puzzle, attempts } = generateWithStats({ difficulty: "hard", seed });
      expect(generate({ difficulty: "hard", seed, maxAttempts: attempts }).mission).toBe(puzzle.mission);
      expect(generate({ difficulty: "hard", seed, maxAttempts: 100 }).mission).toBe(puzzle.mission);
      expect(generate({ difficulty: "hard", seed, maxAttempts: 1000 }).mission).toBe(puzzle.mission);
    }
  });
});

describe("dailySeed / dailyPuzzle", () => {
  it("builds a seed from the date and difficulty", () => {
    expect(dailySeed("2026-09-29", "medium")).toBe("2026-09-29/medium");
    expect(() => dailySeed("29.09.2026", "medium")).toThrow(RangeError);
  });

  it("rejects dates that do not exist or are garbage", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2026-00-10", "2026-04-31", "2026-01-00", "2025-02-29", "", "abc", "2026-9-29", "2026-09-29T00:00", " 2026-09-29"]) {
      expect(() => dailySeed(bad, "easy"), bad).toThrow(RangeError);
      expect(() => dailyPuzzle(bad, "easy"), bad).toThrow(/Date/);
    }
    expect(() => dailySeed(undefined as unknown as string, "easy")).toThrow(RangeError);
  });

  it("accepts real edge dates (leap day, month ends)", () => {
    expect(dailySeed("2024-02-29", "easy")).toBe("2024-02-29/easy");
    expect(dailySeed("2000-02-29", "easy")).toBe("2000-02-29/easy");
    expect(dailySeed("2026-12-31", "hard")).toBe("2026-12-31/hard");
    expect(() => dailySeed("1900-02-29", "easy")).toThrow(RangeError);
  });

  it("dailyPuzzle is generate() with the daily seed", () => {
    const p = dailyPuzzle("2026-09-29", "expert");
    expect(p).toEqual(generate({ difficulty: "expert", seed: "2026-09-29/expert" }));
    expect(p.mission).toBe("000050080048063000760009030104000000000326000005040820000000003406007000007200005");
  });
});

describe("generate — performance smoke", () => {
  it("expert generation stays under 3 s", () => {
    const t0 = Date.now();
    generate({ difficulty: "expert", seed: "perf-smoke" });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("all four difficulties for one seed under 3 s total", () => {
    const t0 = Date.now();
    for (const difficulty of DIFFICULTIES) generate({ difficulty, seed: "perf-all" });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
