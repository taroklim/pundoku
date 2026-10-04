/**
 * Замер генерации Лжеца (числа в README «Лжец → Производительность»).
 *
 *   pnpm measure:liar [N=100] [difficulty ...]
 *
 * Seed — `measure-liar-<difficulty>-<i>`. Печатает число основ, проверенных кандидатов, глубину
 * противоречия и время: wall (зависит от нагрузки машины) и CPU процесса (`process.cpuUsage`, user+system —
 * от нагрузки почти не зависит, пока процесс однопоточный; на перегруженной машине сравнивать по нему).
 */
import { DIFFICULTIES, LIAR_VERSION, generateLiar, type Difficulty } from "../src/index.js";

const args = process.argv.slice(2);
const n = Number(args[0] ?? 100);
const wanted = (args.slice(1).length > 0 ? args.slice(1) : [...DIFFICULTIES]) as Difficulty[];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
const f = (xs: number[], d = 0) => {
  const s = [...xs].sort((a, b) => a - b);
  return [50, 95, 99, 100].map((p) => pct(s, p).toFixed(d)).join("/");
};

console.log(`liar v${LIAR_VERSION}, N=${n}, node ${process.version}`);
console.log("difficulty | failed | bases med/p95/p99/max | tried med/p95/p99/max | depth med/min | wall ms med/p95/p99/max | cpu ms med/p95/p99/max");
for (const difficulty of wanted) {
  const bases: number[] = [];
  const tried: number[] = [];
  const depth: number[] = [];
  const times: number[] = [];
  const cpu: number[] = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    try {
      const p = generateLiar({ difficulty, seed: `measure-liar-${difficulty}-${i}`, maxBases: 5000 });
      bases.push(p.meta.bases);
      tried.push(p.meta.candidatesTried);
      depth.push(p.meta.contradictionDepth);
    } catch {
      failed++;
    }
    times.push(performance.now() - t0);
    const dc = process.cpuUsage(c0);
    cpu.push((dc.user + dc.system) / 1000);
  }
  const ds = [...depth].sort((a, b) => a - b);
  console.log(
    `${difficulty.padEnd(10)} | ${failed} | ${bases.length ? f(bases) : "-"} | ${tried.length ? f(tried) : "-"} | ${ds.length ? `${pct(ds, 50)}/${ds[0]}` : "-"} | ${f(times)} | ${f(cpu)}`,
  );
}
