// usage: node stats.mjs a.json [b.json ...]  — объединяет прогоны, медианы, p90, U-критерий Манна-Уитни (нормальное приближение), доля пар br<base
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2);
const runs = { base: { cold: [], warm: [] }, br: { cold: [], warm: [] } };
for (const f of files) { const j = JSON.parse(readFileSync(f, 'utf8')); for (const l of ['base', 'br']) for (const k of ['cold', 'warm']) runs[l][k].push(...j.runs[l][k].map((x) => x.t)); }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
function mw(a, b) { const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]); const r = new Array(all.length); for (let i = 0; i < all.length;) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; for (let k = i; k <= j; k++) r[k] = (i + j) / 2 + 1; i = j + 1; } let ra = 0; all.forEach((x, i) => { if (x[1] === 0) ra += r[i]; }); const n1 = a.length, n2 = b.length; const U = ra - n1 * (n1 + 1) / 2; const mu = n1 * n2 / 2, sd = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12); const z = (U - mu) / sd; const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))); return { z: +z.toFixed(2), p: +p.toFixed(3) }; }
function erf(x) { const t = 1 / (1 + 0.3275911 * x); return 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); }
for (const k of ['cold', 'warm']) { const a = runs.base[k], b = runs.br[k]; console.log(k, `n=${a.length}/${b.length}`, `base med ${Math.round(med(a))} p90 ${Math.round(q(a, .9))} | br med ${Math.round(med(b))} p90 ${Math.round(q(b, .9))} | delta med ${Math.round(med(b) - med(a))} ms`, 'MW(base vs br)', mw(a, b)); }
