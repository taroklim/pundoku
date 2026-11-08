/**
 * Корпус базовых сеток expert_plus (PD-304) → `src/fish-corpus.ts`.
 *
 *   pnpm --filter @pundoku/api exec tsx ../../packages/engine/scripts/build-fish-corpus.ts <from> <to> > part.txt
 *   (по строке «mission» на базу; части склеиваются и вписываются в fish-corpus.ts)
 *
 * Базы ищет сам генератор движка (`searchWithStats`, seed `fish-base-<i>`) — вычитание с потолком Swordfish до
 * 24 подсказок, сетке обязана понадобиться рыба. Детерминировано: те же <from>..<to> → те же строки. Рантайм не
 * ищет (медленно, см. README «expert_plus»), а берёт базу под случайной симметрией.
 */
import { searchWithStats } from "../src/generator.js";
import { countSolutions, rateDifficulty } from "../src/index.js";

const [from, to] = process.argv.slice(2).map(Number);
for (let i = from!; i < to!; i++) {
  const t0 = performance.now();
  const r = searchWithStats("expert_plus", `fish-base-${i}`, 20_000);
  const ms = performance.now() - t0;
  if (r === null) {
    console.error(`fish-base-${i}: not found`);
    continue;
  }
  if (countSolutions(r.mission) !== 1 || rateDifficulty(r.mission) !== "expert_plus") throw new Error(`fish-base-${i}: invalid`);
  console.log(r.mission);
  console.error(`fish-base-${i}: ${r.attempts} attempts, ${ms.toFixed(0)} ms`);
}
