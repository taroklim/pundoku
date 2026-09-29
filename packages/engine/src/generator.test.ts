import { describe, expect, it } from "vitest";
import { generateWithStats } from "./generator.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DIFFICULTIES,
  DIFFICULTY_PROFILES,
  GENERATOR_VERSION,
  GenerationError,
  Rng,
  countSolutions,
  dailyPuzzle,
  dailySeed,
  formatGrid,
  generate,
  rateDifficulty,
  solve,
  techniqueTier,
  techniquesUsed,
} from "./index.js";

/**
 * Снапшоты: одна и та же seed-строка обязана давать байт-в-байт ту же сетку в любой сессии
 * и на любой платформе. Если генератор меняется намеренно — обновить строки осознанно, поднять
 * `GENERATOR_VERSION` и дописать changelog в README (это ломает «сетку дня» для всех, кто уже
 * играл по фолбэку). Строки — версия 2 (PD-9); easy совпадает с версией 1 (профиль easy не менялся).
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
    mission: "000031000028060090003970050200000800870300016091000500000003100406007000019680007",
    solution: "957231684128564793643978251264715839875329416391846572782493165436157928519682347",
  },
  {
    seed: "2026-09-29",
    difficulty: "hard",
    mission: "200090451000000008080040000300870000600000040001000002049007003000180500860000710",
    solution: "237698451914735628586241937352874196678912345491356872149567283723189564865423719",
  },
  {
    seed: "2026-09-29",
    difficulty: "expert",
    mission: "600028000000506000170009000090010002080002100060300800000000756900000040004000200",
    solution: "645128973839576421172439685493817562587962134261345897318294756926751348754683219",
  },
  {
    seed: "2026-09-29",
    difficulty: "master",
    mission: "320600000050070000000000398190008500000060030200000000036900480700000000000800026",
    solution: "329684175851379642647152398193248567478561239265793814536927481782416953914835726",
  },
  {
    seed: "pundoku",
    difficulty: "hard",
    mission: "000058090890630000060000030130000000000000382700006001480905000007000040009800006",
    solution: "273158694891634275564729138135482967946571382728396451482965713657213849319847526",
  },
  {
    seed: "pundoku",
    difficulty: "medium",
    mission: "980020005500700910060500028000006100006040083005100090000001540009800670100000800",
    solution: "981423765523768914467519328894236157716945283235187496678391542349852671152674839",
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

  it("GENERATOR_VERSION is 2 (PD-9: two-axis difficulty)", () => {
    expect(GENERATOR_VERSION).toBe(2);
  });

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

const CLUES_OF = (mission: string) => mission.split("").filter((ch) => ch !== "0").length;

describe("generate — validity", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty}: unique solution, solve() matches, rating matches, exact clue count, techniques`, () => {
      const p = generate({ difficulty, seed: `validity-${difficulty}` });
      const profile = DIFFICULTY_PROFILES[difficulty];
      expect(p.mission).toHaveLength(81);
      expect(p.solution).toHaveLength(81);
      expect(countSolutions(p.mission)).toBe(1);
      expect(formatGrid(solve(p.mission)!)).toBe(p.solution);
      expect(rateDifficulty(p.mission)).toBe(difficulty);
      expect(CLUES_OF(p.mission)).toBe(profile.clues);
      expect(p.techniques.length).toBeGreaterThan(0);
      // Техника не дороже потолка профиля; beyond — только у master.
      const top = Math.max(...p.techniques.map((t) => techniqueTier(t)));
      expect(top).toBeLessThanOrEqual(techniqueTier(profile.technique));
      if (difficulty === "master") expect(p.techniques.at(-1)).toBe("beyond");
      else expect(p.techniques).not.toContain("beyond");
      // Подсказки миссии совпадают с решением.
      for (let i = 0; i < 81; i++) if (p.mission[i] !== "0") expect(p.mission[i]).toBe(p.solution[i]);
    });
  }

  it("profiles: the documented two-axis ladder", () => {
    expect(DIFFICULTY_PROFILES).toEqual({
      easy: { clues: 38, technique: "hidden_single" },
      medium: { clues: 30, technique: "hidden_single" },
      hard: { clues: 26, technique: "locked_candidates" },
      expert: { clues: 24, technique: "hidden_pair" },
      master: { clues: 24, technique: "beyond" },
    });
  });

  it("clues option: the second axis is a parameter (exact count, own grid, validated)", () => {
    const p = generate({ difficulty: "easy", seed: "clues-opt", clues: 34 });
    expect(CLUES_OF(p.mission)).toBe(34);
    expect(countSolutions(p.mission)).toBe(1);
    expect(techniquesUsed(p.mission)).not.toContain("locked_candidates");
    expect(p.mission).not.toBe(generate({ difficulty: "easy", seed: "clues-opt" }).mission);
    // Явно заданное значение по умолчанию == отсутствие опции.
    expect(generate({ difficulty: "hard", seed: "clues-opt", clues: 26 })).toEqual(generate({ difficulty: "hard", seed: "clues-opt" }));
    for (const bad of [16, 81, 30.5, Number.NaN]) {
      expect(() => generate({ difficulty: "easy", seed: "x", clues: bad }), String(bad)).toThrow(RangeError);
    }
    expect(() => generate({ difficulty: "nightmare" as never, seed: "x" })).toThrow(RangeError);
    // null — не «опция не задана»: раньше `??` молча подставлял дефолт.
    expect(() => generate({ difficulty: "easy", seed: "x", clues: null as never })).toThrow(RangeError);
    // explicit undefined == опция не задана.
    expect(generate({ difficulty: "easy", seed: "clues-opt", clues: undefined })).toEqual(generate({ difficulty: "easy", seed: "clues-opt" }));
  });

  it("unknown difficulty: own properties only — prototype names get the right RangeError", () => {
    for (const bad of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "", "EASY"]) {
      expect(() => generate({ difficulty: bad as never, seed: "x" }), bad).toThrow(RangeError);
      expect(() => generate({ difficulty: bad as never, seed: "x" }), bad).toThrow(`Unknown difficulty '${bad}'`);
    }
    for (const bad of [undefined, null, 1, {}]) {
      expect(() => generate({ difficulty: bad as never, seed: "x" })).toThrow(/Unknown difficulty/);
    }
  });

  it("maxAttempts is validated: integer >= 1, otherwise RangeError (not GenerationError)", () => {
    for (const bad of [0, -1, Number.NaN, 1.5, Infinity, null, "5"]) {
      expect(() => generate({ difficulty: "easy", seed: "x", maxAttempts: bad as never }), String(bad)).toThrow(RangeError);
      expect(() => generate({ difficulty: "easy", seed: "x", maxAttempts: bad as never }), String(bad)).toThrow(/maxAttempts/);
    }
    // explicit undefined == по умолчанию.
    expect(generate({ difficulty: "easy", seed: "x", maxAttempts: undefined })).toEqual(generate({ difficulty: "easy", seed: "x" }));
  });

  it("throws GenerationError when attempts are exhausted", () => {
    // Профиль, до которого одна попытка почти не дотягивает: 1 — минимально допустимое maxAttempts.
    expect(() => generate({ difficulty: "expert", seed: "x", clues: 22, maxAttempts: 1 })).toThrow(GenerationError);
  });
});

describe("generate — maxAttempts (PD-8 d)", () => {
  // 'measure-expert-812' / expert (v2) по замеру требует 138 попыток — хвост 1000 seed (медиана expert ≈ 14).
  const TAIL = { difficulty: "expert", seed: "measure-expert-812", attempts: 138 } as const;

  it("default ceiling is 300 (≈ 2× максимума замера 1000 seed — expert, 138 попыток)", () => {
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
    expect(p.mission).toBe("000020000089000530000360100090700045560030000000002703000001000705000000008040010");
  });
});

describe("generate — performance smoke", () => {
  it("expert generation stays under 3 s", () => {
    const t0 = Date.now();
    generate({ difficulty: "expert", seed: "perf-smoke" });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("all five difficulties for one seed under 3 s total", () => {
    const t0 = Date.now();
    for (const difficulty of DIFFICULTIES) generate({ difficulty, seed: "perf-all" });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
