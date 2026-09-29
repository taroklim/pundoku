/**
 * «Тяжёлый» прогон: по 100 сгенерированных сеток на каждый класс сложности (PD-9). Идёт в CI по
 * умолчанию; на ненагруженной машине — десятки секунд (см. README «Производительность»).
 * Проверяется корректность по обеим осям: единственность решения, техника не дороже потолка
 * профиля (и, где класс требует, ровно его), число подсказок == цель профиля, `rateDifficulty`
 * совпал с классом. Время генерации здесь не проверяется — только печатается замером в README.
 */
import { describe, expect, it } from "vitest";
import {
  DIFFICULTIES,
  DIFFICULTY_PROFILES,
  countSolutions,
  formatGrid,
  generate,
  rateDifficulty,
  solve,
  techniqueTier,
  techniquesUsed,
} from "./index.js";

const PER_DIFFICULTY = 100;

describe("generate — 100 puzzles per difficulty class", () => {
  for (const difficulty of DIFFICULTIES) {
    it(
      `${difficulty}: unique solution, technique within the class ceiling, exact clue count, rating == class`,
      () => {
        const profile = DIFFICULTY_PROFILES[difficulty];
        const ceiling = techniqueTier(profile.technique);
        for (let i = 0; i < PER_DIFFICULTY; i++) {
          const p = generate({ difficulty, seed: `heavy-${difficulty}-${i}` });
          if (countSolutions(p.mission) !== 1) throw new Error(`not unique: ${p.mission}`);
          if (formatGrid(solve(p.mission)!) !== p.solution) throw new Error(`solve mismatch: ${p.mission}`);
          const clues = p.mission.split("").filter((ch) => ch !== "0").length;
          if (clues !== profile.clues) throw new Error(`clues ${clues} != ${profile.clues}: ${p.mission}`);
          const used = techniquesUsed(p.mission);
          const top = Math.max(...used.map((t) => techniqueTier(t)));
          if (top > ceiling) throw new Error(`technique ${used.join(",")} above ${profile.technique}: ${p.mission}`);
          if (difficulty === "hard" && top !== 2) throw new Error(`hard without locked candidates: ${p.mission}`);
          if (difficulty === "expert" && top < 3) throw new Error(`expert without pairs: ${p.mission}`);
          if (difficulty === "master" && !used.includes("beyond")) throw new Error(`master solved by techniques: ${p.mission}`);
          if (rateDifficulty(p.mission) !== difficulty) throw new Error(`rating mismatch: ${p.mission}`);
        }
        expect(true).toBe(true);
      },
      180_000,
    );
  }
});
