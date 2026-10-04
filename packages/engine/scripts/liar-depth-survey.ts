/**
 * Обзор достижимой глубины Лжеца (данные для `LIAR_MIN_DEPTH`, README «Лжец → Порог глубины»).
 *
 *   pnpm --filter @pundoku/api exec tsx ../../packages/engine/scripts/liar-depth-survey.ts [N=60] [cap=8] [difficulty ...]
 *
 * Для N честных основ класса (`generate`, seed `survey-<класс>-<i>`) перебирает ВСЕ кандидаты (клетка, ложная
 * цифра), прошедшие (2) и (а) (`lieChecker` с порогом 0), и считает их глубину (в) с поиском до `cap` постановок
 * (глубже — нижняя оценка). Печатает долю основ, у которых есть ложь глубины ≥ k, и распределение глубин лжей.
 */
import { DIFFICULTIES, DIFFICULTY_PROFILES, TECHNIQUE_ORDER, generate, type Difficulty, type Digit } from "../src/index.js";
import { contradictionDepth, lieChecker } from "../src/liar.js";

const args = process.argv.slice(2);
const n = Number(args[0] ?? 60);
const cap = Number(args[1] ?? 8);
const wanted = (args.slice(2).length > 0 ? args.slice(2) : [...DIFFICULTIES]) as Difficulty[];

for (const difficulty of wanted) {
  const tier = Math.min(TECHNIQUE_ORDER.indexOf(DIFFICULTY_PROFILES[difficulty].technique as never), 4);
  const maxTier = tier < 0 ? 4 : tier;
  const bestPerBase: number[] = [];
  const hist = new Map<number, number>();
  let lies = 0;
  const c0 = process.cpuUsage();
  for (let i = 0; i < n; i++) {
    const base = generate({ difficulty, seed: `survey-${difficulty}-${i}` });
    const check = lieChecker(base.mission, base.solution, maxTier, 0);
    let best = -1;
    for (let c = 0; c < 81; c++) {
      if (base.mission[c] !== "0") continue;
      for (let d = 1; d <= 9; d++) {
        if (check(c, d as Digit) === null) continue;
        const m = base.mission.slice(0, c) + String(d) + base.mission.slice(c + 1);
        const depth = contradictionDepth(m, maxTier, cap) ?? -1;
        lies++;
        hist.set(depth, (hist.get(depth) ?? 0) + 1);
        if (depth > best) best = depth;
      }
    }
    bestPerBase.push(best);
  }
  const cpu = process.cpuUsage(c0);
  const share = (k: number) => `${((100 * bestPerBase.filter((b) => b >= k).length) / n).toFixed(1)}%`;
  const ks = Array.from({ length: cap + 2 }, (_, k) => k);
  console.log(
    `${difficulty} (tier ${maxTier}, N=${n}, cap=${cap}, ${(((cpu.user + cpu.system) / 1000) | 0)} ms cpu): lies=${lies}; ` +
      `bases with a lie of depth >=k: ${ks.map((k) => `>=${k} ${share(k)}`).join(", ")}`,
  );
  console.log(`  depth histogram (-1 = not deducible): ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([d, c]) => `${d}:${c}`).join(" ")}`);
}
