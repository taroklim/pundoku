/**
 * Замер генерации Лжеца (числа в README «Лжец → Производительность»).
 *
 *   pnpm measure:liar [N=100] [difficulty[:minDepth] ...]
 *
 * `difficulty:minDepth` — замер с порогом (в) вместо `LIAR_MIN_DEPTH` (калибровка порога, PD-174).
 * Seed — `measure-liar-<difficulty>-<i>`. Печатает число основ, проверенных кандидатов, глубину
 * противоречия (из `meta` — точная только до порога, и пересчитанная поиском до `DEPTH_CAP` для распределения) и время: wall (зависит от нагрузки машины) и CPU процесса (`process.cpuUsage`, user+system —
 * от нагрузки почти не зависит, пока процесс однопоточный; на перегруженной машине сравнивать по нему).
 */
import { DIFFICULTIES, DIFFICULTY_PROFILES, LIAR_VERSION, TECHNIQUE_ORDER, type Difficulty } from "../src/index.js";
import { contradictionDepth, generateLiarWithDepth } from "../src/liar.js";

/** Глубина для распределения — поиск до DEPTH_CAP постановок (глубже — нижняя оценка, печатается как `>cap`). */
const DEPTH_CAP = 12;

const args = process.argv.slice(2);
const n = Number(args[0] ?? 100);
const wanted = args.slice(1).length > 0 ? args.slice(1) : [...DIFFICULTIES];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
const f = (xs: number[], d = 0) => {
  const s = [...xs].sort((a, b) => a - b);
  return [50, 95, 99, 100].map((p) => pct(s, p).toFixed(d)).join("/");
};

console.log(`liar v${LIAR_VERSION}, N=${n}, node ${process.version}`);
console.log("difficulty | failed | bases med/p95/p99/max | tried med/p95/p99/max | depth med/min | wall ms med/p95/p99/max | cpu ms med/p95/p99/max | depth histogram");
for (const spec of wanted) {
  const [name, md] = spec.split(":");
  const difficulty = name as Difficulty;
  const minDepth = md === undefined ? undefined : Number(md);
  const t = TECHNIQUE_ORDER.indexOf(DIFFICULTY_PROFILES[difficulty].technique as never);
  const maxTier = t < 0 ? TECHNIQUE_ORDER.length - 1 : t;
  const full: number[] = [];
  const bases: number[] = [];
  const tried: number[] = [];
  const depth: number[] = [];
  const times: number[] = [];
  const cpu: number[] = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    let mission: string | null = null;
    try {
      const p = generateLiarWithDepth({ difficulty, seed: `measure-liar-${difficulty}-${i}`, maxBases: 5000 }, minDepth);
      bases.push(p.meta.bases);
      tried.push(p.meta.candidatesTried);
      depth.push(p.meta.contradictionDepth);
      mission = p.mission;
    } catch {
      failed++;
    }
    times.push(performance.now() - t0);
    const dc = process.cpuUsage(c0);
    cpu.push((dc.user + dc.system) / 1000);
    if (mission !== null) full.push(contradictionDepth(mission, maxTier, DEPTH_CAP) ?? -1);
  }
  const ds = [...depth].sort((a, b) => a - b);
  const hist = new Map<number, number>();
  for (const d of [...full].sort((a, b) => a - b)) {
    const k = d > DEPTH_CAP ? DEPTH_CAP + 1 : d;
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  console.log(
    `${spec.padEnd(10)} | ${failed} | ${bases.length ? f(bases) : "-"} | ${tried.length ? f(tried) : "-"} | ${ds.length ? `${pct(ds, 50)}/${ds[0]}` : "-"} | ${f(times)} | ${f(cpu)} | ${[...hist].map(([d, c]) => `${d > DEPTH_CAP ? `>${DEPTH_CAP}` : d}:${c}`).join(" ")}`,
  );
}
