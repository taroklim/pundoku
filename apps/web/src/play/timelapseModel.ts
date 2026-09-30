/**
 * Таймлапс (PD-75): чистая логика без React и canvas — расписание проигрывания, кадры контактного листа,
 * клетки-кляксы, размеры квадратов отпечатка. Макет PD-69 (`design/pd69-notes.md` §3, §7).
 */
import type { TimelapseFingerprint, TimelapseFrame } from "@pundoku/engine";

export type TimelapseSpeed = "slow" | "normal" | "fast";

/** Бюджет одной партии на экране по скорости (решение владельца: ~60/30/15 с), мс. */
export const BUDGET_MS: Readonly<Record<TimelapseSpeed, number>> = { slow: 60000, normal: 30000, fast: 15000 };
/** Самая долгая пауза между кадрами — не более этой доли бюджета (решение владельца: 6 %). */
export const PAUSE_CAP = 0.06;
/** Кадр не короче этого (мгновенные ходы не сливаются в мельтешение), мс. */
export const MIN_FRAME_MS = 90;
/** Кадр с неверной цифрой-кляксой и её замена — между ними клякса должна быть видна, мс. */
export const BLOT_HOLD_MS = 280;
/** Задержка в конце перед повтором, мс. */
export const LOOP_HOLD_MS = 800;
/** Этапов контактного листа. */
export const CONTACT_STAGES = 9;

/** Вторая часть пары «клякса → замена»: тот же ход по клетке, обе с `blot`. */
export function isBlotReplacement(frames: readonly TimelapseFrame[], j: number): boolean {
  const f = frames[j];
  const prev = frames[j - 1];
  return f?.blot === true && prev?.blot === true && f.cell !== null && f.cell === prev.cell;
}

export interface PlaybackSchedule {
  /** `offsets[j]` — момент показа кадра `j` от начала проигрывания, мс; `offsets[0] = 0`, не убывает. */
  readonly offsets: readonly number[];
  /** Момент показа последнего кадра, мс. */
  readonly totalMs: number;
}

/**
 * Расписание: реальный ритм, но ни одна пауза не длиннее `PAUSE_CAP · budget`, а вся партия укладывается
 * в `budget`. Вес кадра `w = clamp(g · s, floor, cap)`; масштаб `s` подбирается делением пополам так, чтобы
 * `Σw = budget` (у короткой партии, где это недостижимо, потолок поднимается до `budget / n`).
 * `offsets[j]` — момент показа кадра `j` на экране (мс, `offsets[0] = 0`); реальные паузы берутся из `frame.t`.
 */
export function playbackSchedule(frames: readonly TimelapseFrame[], budgetMs: number): PlaybackSchedule {
  const n = frames.length - 1;
  if (n <= 0) return { offsets: [0], totalMs: 0 };
  const gaps: number[] = [];
  const floors: number[] = [];
  let real = 0;
  for (let j = 1; j <= n; j++) {
    gaps.push(Math.max(0, frames[j]!.t - frames[j - 1]!.t));
    real += gaps[j - 1]!;
    floors.push(isBlotReplacement(frames, j) ? BLOT_HOLD_MS : MIN_FRAME_MS);
  }
  const offsets: number[] = [0];
  const push = (w: readonly number[]) => {
    let acc = 0;
    for (const x of w) offsets.push((acc += x));
  };
  if (real <= 0) {
    // Партия целиком в одном мгновении — равномерно по ходам.
    push(gaps.map(() => budgetMs / n));
    return { offsets, totalMs: offsets[n]! };
  }
  const cap = Math.max(PAUSE_CAP * budgetMs, budgetMs / n);
  const floorSum = floors.reduce((a, b) => a + b, 0);
  if (floorSum >= budgetMs) {
    // Кадров слишком много для бюджета — пропорционально ужимаем минимумы.
    push(floors.map((f) => (f * budgetMs) / floorSum));
    return { offsets, totalMs: offsets[n]! };
  }
  const weights = (s: number) => gaps.map((g, i) => Math.min(cap, Math.max(floors[i]!, g * s)));
  const sum = (w: readonly number[]) => w.reduce((a, b) => a + b, 0);
  let lo = 0;
  let hi = 1;
  while (sum(weights(hi)) < budgetMs && hi < 1e12) hi *= 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (sum(weights(mid)) < budgetMs) lo = mid;
    else hi = mid;
  }
  push(weights(hi));
  return { offsets, totalMs: offsets[n]! };
}

/** Индекс кадра, показываемого в момент `elapsedMs` от начала: последний, чей `offset ≤ elapsedMs`. */
export function frameAt(offsets: readonly number[], elapsedMs: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= elapsedMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Кадры контактного листа: `round(N · s / 9)`, `s = 1..9`; повторы (короткая партия) убраны, минимум — кадр 1. */
export function contactStages(moves: number, count: number = CONTACT_STAGES): number[] {
  if (moves <= 0) return [];
  const out: number[] = [];
  for (let s = 1; s <= count; s++) {
    const idx = Math.min(moves, Math.max(1, Math.round((moves * s) / count)));
    if (out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

/** Для каждой клетки — индекс первого кадра с кляксой (`blot`), либо нет записи. Клякса остаётся пятном до конца. */
export function firstBlotFrames(frames: readonly TimelapseFrame[]): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  frames.forEach((f, j) => {
    if (f.blot === true && f.cell !== null && !out.has(f.cell)) out.set(f.cell, j);
  });
  return out;
}

/** Есть ли в партии хоть одна клякса (ink-день). */
export function hasBlots(frames: readonly TimelapseFrame[]): boolean {
  return frames.some((f) => f.blot === true);
}

/** Число клякс партии — клеток, где была клякса. */
export function blotCount(frames: readonly TimelapseFrame[]): number {
  return firstBlotFrames(frames).size;
}

/**
 * «Сколько думал» на клетку отпечатка, 0 (мгновенно) … 1 (самая долгая пауза). Из `timelapseFingerprint` с
 * `maxGapMs: Infinity`: пауза перед клеткой = её момент минус момент предыдущей по порядку. Первая клетка (пауза
 * включает чтение сетки) получает медиану остальных; нормировка — корень от доли опорной паузы (max из 90-го
 * перцентиля и удвоенной медианы), чтобы один выброс не сплющил остальные, а ровный темп не дал «всем дольше всех». `null` — подсказка/не заполнена.
 */
export function dwellScales(fp: TimelapseFingerprint): (number | null)[] {
  const ordered = fp.cells
    .map((c, cell) => ({ c, cell }))
    .filter((e): e is { c: NonNullable<typeof e.c>; cell: number } => e.c !== null)
    .sort((a, b) => a.c.order - b.c.order);
  const out: (number | null)[] = fp.cells.map(() => null);
  if (ordered.length === 0) return out;
  const d: number[] = ordered.map((e, k) => (k === 0 ? 0 : Math.max(0, e.c.t - ordered[k - 1]!.c.t)));
  const rest = d.slice(1).sort((a, b) => a - b);
  const median = rest.length ? (rest[(rest.length - 1) >> 1]! + rest[rest.length >> 1]!) / 2 : 0;
  d[0] = median;
  const sorted = [...d].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(0.9 * (sorted.length - 1)))]!;
  // Опорная пауза не меньше удвоенной медианы: при ровном темпе квадраты средние и одинаковые, а не все «дольше всех».
  const ref = Math.max(p90, 2 * median);
  ordered.forEach((e, k) => {
    out[e.cell] = ref > 0 ? Math.sqrt(Math.min(1, d[k]! / ref)) : 0;
  });
  return out;
}

/** Размер квадрата отпечатка относительно ячейки по «сколько думал»: 1.0 (мгновенно) … 0.45 (дольше всех). */
export const RHYTHM_MIN_SCALE = 0.45;
export function rhythmScale(dwell: number): number {
  return 1 - (1 - RHYTHM_MIN_SCALE) * Math.min(1, Math.max(0, dwell));
}
