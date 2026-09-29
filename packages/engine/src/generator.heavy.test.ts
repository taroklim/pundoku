/**
 * «Тяжёлый» прогон: по 200 сгенерированных сеток на каждую сложность. Идёт в CI по
 * умолчанию; на Node занимает ~20–30 с суммарно (см. README «Производительность»).
 */
import { describe, expect, it } from "vitest";
import { DIFFICULTIES, countSolutions, formatGrid, generate, rateDifficulty, solve } from "./index.js";

const PER_DIFFICULTY = 200;

describe("generate — 200 puzzles per difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    it(
      `${difficulty}: every puzzle has exactly one solution equal to .solution and the target rating`,
      () => {
        const t0 = performance.now();
        let clues = 0;
        for (let i = 0; i < PER_DIFFICULTY; i++) {
          const p = generate({ difficulty, seed: `heavy-${difficulty}-${i}` });
          if (countSolutions(p.mission) !== 1) throw new Error(`not unique: ${p.mission}`);
          if (formatGrid(solve(p.mission)!) !== p.solution) throw new Error(`solve mismatch: ${p.mission}`);
          if (rateDifficulty(p.mission) !== difficulty) throw new Error(`rating mismatch: ${p.mission}`);
          for (let c = 0; c < 81; c++) if (p.mission[c] !== "0") clues++;
        }
        const ms = performance.now() - t0;
        // Ориентир: среднее число подсказок в разумных пределах, время — в бюджете CI.
        expect(clues / PER_DIFFICULTY).toBeGreaterThan(17);
        expect(clues / PER_DIFFICULTY).toBeLessThan(45);
        expect(ms).toBeLessThan(45_000);
      },
      60_000,
    );
  }
});
