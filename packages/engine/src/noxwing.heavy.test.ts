/**
 * «Тяжёлый» прогон PD-304: 200 сеток `generate({ difficulty: 'expert', noXWing: true })` с разными seed (класс,
 * ради которого опция заведена: «Эксперт без X-Wing») — решатель подтверждает, что X-Wing/Swordfish и перебор не
 * нужны, а решение единственное. Плюс expert_plus по пользовательскому числу подсказок (чистый поиск, без корпуса).
 */
import { describe, expect, it } from "vitest";
import { countSolutions, formatGrid, generate, humanSolve, rateDifficulty, solve, techniquesUsed } from "./index.js";

const TOTAL = 200;
const CHUNK = 20;
const CHUNK_TIMEOUT_MS = 120_000;

describe("noXWing: 200 expert grids, solver confirms no fish and a unique solution", () => {
  for (let from = 0; from < TOTAL; from += CHUNK) {
    const to = from + CHUNK;
    it(
      `expert noXWing #${from}-${to - 1}`,
      () => {
        for (let i = from; i < to; i++) {
          const p = generate({ difficulty: "expert", seed: `noxwing-${i}`, noXWing: true });
          if (countSolutions(p.mission) !== 1) throw new Error(`not unique: ${p.mission}`);
          if (formatGrid(solve(p.mission)!) !== p.solution) throw new Error(`solve mismatch: ${p.mission}`);
          // Строго ниже X-Wing: решается одними singles/locked/pairs ...
          if (!humanSolve(p.mission, { maxTechnique: "hidden_pair" }).solved) throw new Error(`needs more than pairs: ${p.mission}`);
          // ... и полный решатель (с рыбами) рыбу ни разу не применил и не застрял.
          const used = techniquesUsed(p.mission);
          if (used.includes("x_wing") || used.includes("swordfish") || used.includes("beyond")) {
            throw new Error(`fish/beyond in ${used.join(",")}: ${p.mission}`);
          }
          if (rateDifficulty(p.mission) !== "expert") throw new Error(`rating mismatch: ${p.mission}`);
        }
        expect(true).toBe(true);
      },
      CHUNK_TIMEOUT_MS,
    );
  }
});

describe("expert_plus with a custom clue count (plain search, no corpus)", () => {
  it("25 clues: unique, fish required, no backtracking", () => {
    const p = generate({ difficulty: "expert_plus", seed: "fish-clues-25", clues: 25, maxAttempts: 5000 });
    expect(p.mission.split("").filter((ch) => ch !== "0")).toHaveLength(25);
    expect(countSolutions(p.mission)).toBe(1);
    expect(humanSolve(p.mission, { maxTechnique: "hidden_pair" }).solved).toBe(false);
    expect(humanSolve(p.mission).solved).toBe(true);
  }, 300_000);
});
