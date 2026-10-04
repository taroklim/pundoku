/**
 * «Тяжёлый» прогон Лжеца по всем классам (PD-165): независимая проверка критерия честности
 * (`assertHonestLiar`) на многих seed. Easy/medium — по 60, hard — 30, expert/master — по 15 (генерация
 * expert/master — от сотен мс до секунд CPU, см. README «Лжец → Производительность»). Время не проверяется.
 * Кусок — 5 seed с таймаутом 300 с: при load average ~250 кусок expert из 15 seed занимал 270 с wall (PD-165),
 * на свободной машине кусок — единицы секунд. С PD-172 `assertHonestLiar` ещё перебирает порядки синглов
 * (полный перебор до порога + случайные порядки) — кусок easy/medium дороже, порядка 5–10 с.
 */
import { describe, expect, it } from "vitest";
import { generateLiar } from "./index.js";
import type { Difficulty } from "./index.js";
import { assertHonestLiar } from "./liar.test-util.js";

const PLAN: readonly [Difficulty, number][] = [
  ["easy", 60],
  ["medium", 60],
  ["hard", 30],
  ["expert", 15],
  ["master", 15],
];
const CHUNK = 5;
const CHUNK_TIMEOUT_MS = 300_000;

describe("generateLiar — honesty on many seeds, all classes", () => {
  for (const [difficulty, n] of PLAN) {
    for (let from = 0; from < n; from += CHUNK) {
      const to = Math.min(n, from + CHUNK);
      it(
        `${difficulty} #${from}-${to - 1}`,
        () => {
          for (let i = from; i < to; i++) assertHonestLiar(generateLiar({ difficulty, seed: `heavy-liar-${difficulty}-${i}` }));
          expect(true).toBe(true);
        },
        CHUNK_TIMEOUT_MS,
      );
    }
  }
});
