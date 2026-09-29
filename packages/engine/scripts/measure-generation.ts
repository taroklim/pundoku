/**
 * Замер попыток и времени генерации по классам сложности (числа в README «Попытки и время генерации»).
 *
 *   pnpm measure:engine [N=100] [difficulty ...]     # напр.: pnpm measure:engine 200 hard expert
 *
 * Seed — `measure-<difficulty>-<i>`, потолок попыток поднят до 5000, чтобы увидеть настоящий хвост.
 * Время — на этой машине и под её нагрузкой (числа в README — ориентир, не гарантия).
 */
import { DIFFICULTIES, GENERATOR_VERSION, type Difficulty } from "../src/index.js";
import { generateWithStats } from "../src/generator.js";

const args = process.argv.slice(2);
const n = Number(args[0] ?? 100);
const wanted = (args.slice(1).length > 0 ? args.slice(1) : [...DIFFICULTIES]) as Difficulty[];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

console.log(`generator v${GENERATOR_VERSION}, N=${n}, node ${process.version}`);
console.log("difficulty | failed | attempts med/p95/p99/max | ms med/p95/p99/max");
for (const difficulty of wanted) {
  const attempts: number[] = [];
  const times: number[] = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try {
      const { attempts: a } = generateWithStats({ difficulty, seed: `measure-${difficulty}-${i}`, maxAttempts: 5000 });
      attempts.push(a);
    } catch {
      failed++;
    }
    times.push(performance.now() - t0);
  }
  attempts.sort((a, b) => a - b);
  times.sort((a, b) => a - b);
  const f = (xs: number[], d = 0) => [50, 95, 99, 100].map((p) => pct(xs, p).toFixed(d)).join("/");
  console.log(`${difficulty.padEnd(10)} | ${failed} | ${attempts.length ? f(attempts) : "-"} | ${f(times)}`);
}
