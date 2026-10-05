/**
 * Геометрия кляксы-питомца, вариант A «Капля» (PD-170, согласован владельцем; реализация PD-180).
 *
 * Перенесено ДОСЛОВНО из макета `design/pd170-pet-glyphs.html` (`MOOD`, `PV.A`, `bodyPath`, `smoothClosed`, `eyes`,
 * `drops`): те же гармоники, те же 40 точек контура, те же глаза и капельки. Своих вариаций формы не вводить — рисунок
 * согласован. Варианты B/C макета сюда не перенесены.
 *
 * Поле 48×48, «земля» на y = 39: тело стоит на ней (тяжелее книзу), глаза вырезаются маской, капельки — отдельные круги.
 */
import type { PetMood } from "@pundoku/engine";

interface MoodShape {
  readonly ry: number;
  readonly rx: number;
  readonly widen: number;
  readonly lift: number;
}

/** Поза по настроению (макет `MOOD`): доволен — ровная капля, устал — осела, удивлён — вытянулась и приподнята, спит — лужица. */
export const MOOD_SHAPE: Readonly<Record<PetMood, MoodShape>> = {
  happy: { ry: 13, rx: 15, widen: 0.12, lift: 0 },
  tired: { ry: 10.5, rx: 16.5, widen: 0.18, lift: 0 },
  surprised: { ry: 14.5, rx: 14, widen: 0.06, lift: 1.6 },
  asleep: { ry: 7.5, rx: 18, widen: 0.15, lift: 0 },
};

const GROUND = 39;
/** Вариант A «Капля» (макет `PV.A`): три мягкие гармоники, 40 точек, без выплесков. */
const HARM: readonly (readonly [number, number, number])[] = [
  [2, 0.03, 0.4],
  [3, 0.035, 1.3],
  [5, 0.015, 2.1],
];
const N = 40;

const f = (v: number) => v.toFixed(2);

function smoothClosed(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n] as readonly [number, number];
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0] as number)} ${f(c1[1] as number)} ${f(c2[0] as number)} ${f(c2[1] as number)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "z";
}

function bodyPath(m: MoodShape): { d: string; cx: number; cy: number } {
  const cx = 24;
  const cy = GROUND - 0.82 * m.ry - m.lift;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    const s = Math.sin(t);
    const c = Math.cos(t);
    let r = 1;
    for (const [k, a, ph] of HARM) r += a * Math.cos(k * t + ph);
    pts.push([cx + m.rx * c * r * (1 + m.widen * Math.max(0, s)), cy + m.ry * s * r * (s > 0 ? 0.82 : 1)]);
  }
  return { d: smoothClosed(pts), cx, cy };
}

/** Глаза-прорези (рисуются чёрным в маске → сквозь них видна подложка). */
export type EyeShape =
  | { readonly kind: "stroke"; readonly d: string }
  | { readonly kind: "fill"; readonly d: string }
  | { readonly kind: "circles"; readonly cx: readonly [number, number]; readonly cy: number; readonly r: number };

function eyes(mood: PetMood, m: MoodShape, cx: number, cy: number): EyeShape {
  const ex = Math.max(4.6, m.rx * 0.33);
  const ey = cy - m.ry * (mood === "asleep" ? 0 : 0.12);
  const L = cx - ex;
  const R = cx + ex;
  switch (mood) {
    case "happy":
      return { kind: "stroke", d: `M${L - 2.6} ${ey + 1.2}q2.6-3.6 5.2 0M${R - 2.6} ${ey + 1.2}q2.6-3.6 5.2 0` };
    case "tired":
      return { kind: "fill", d: `M${L - 3} ${ey}h6a3 3 0 0 1-6 0zM${R - 3} ${ey}h6a3 3 0 0 1-6 0z` };
    case "surprised":
      return { kind: "circles", cx: [L, R], cy: ey, r: 3.6 };
    default:
      return { kind: "stroke", d: `M${L - 2.7} ${ey}h5.4M${R - 2.7} ${ey}h5.4` };
  }
}

/** Отлетевшие капельки варианта A (`drops: "few"`): 1–2 на настроение. `[x, y, r]`. */
function drops(mood: PetMood, m: MoodShape, cx: number, cy: number): [number, number, number][] {
  const top = cy - m.ry;
  const bot = cy + 0.82 * m.ry;
  switch (mood) {
    case "happy":
      return [[cx + m.rx + 4, bot - 3.5, 1.7]];
    case "tired":
      return [
        [cx - m.rx - 3.4, bot - 1.6, 1.5],
        [cx + m.rx + 3, bot - 1, 1.1],
      ];
    case "surprised":
      return [
        [cx + m.rx * 0.55, top - 4.5, 2.0],
        [cx - m.rx * 0.5, top - 3, 1.4],
      ];
    default:
      return [[cx + m.rx + 3.4, bot - 2.4, 1.4]];
  }
}

export interface PetShape {
  readonly body: string;
  readonly eyes: EyeShape;
  readonly drops: readonly (readonly [number, number, number])[];
}

const cache = new Map<PetMood, PetShape>();

/** Готовая геометрия настроения (кешируется: детерминирована). */
export function petShape(mood: PetMood): PetShape {
  const hit = cache.get(mood);
  if (hit) return hit;
  const m = MOOD_SHAPE[mood];
  const b = bodyPath(m);
  const shape: PetShape = { body: b.d, eyes: eyes(mood, m, b.cx, b.cy), drops: drops(mood, m, b.cx, b.cy) };
  cache.set(mood, shape);
  return shape;
}
