/**
 * Тепловая карта пути (карточка дня, макет `.heat`): непрозрачность клетки = место в порядке
 * заполнения. Движок отдаёт момент заполнения, нормированный к времени партии (0..1); на
 * карту он переводится в РАНГ (0 — заполнена первой, 1 — последней): иначе одна долгая пауза
 * сжала бы всю карту в два оттенка, а макет показывает именно порядок («every cell shaded by
 * when you filled it»). `null` — подсказка (given) либо клетка, не заполненная верно.
 */
export const HEAT_MIN = 0.12;
export const HEAT_MAX = 0.98;
export const HEAT_LEGEND_STEPS = 9;

const opacityAt = (share: number): number => HEAT_MIN + (HEAT_MAX - HEAT_MIN) * share;

export function heatOpacities(times: readonly (number | null)[]): (number | null)[] {
  const filled = times
    .map((t, cell) => ({ t, cell }))
    .filter((e): e is { t: number; cell: number } => e.t !== null)
    .sort((a, b) => a.t - b.t || a.cell - b.cell);
  const out: (number | null)[] = times.map(() => null);
  const span = Math.max(1, filled.length - 1);
  filled.forEach((e, rank) => {
    out[e.cell] = Number(opacityAt(rank / span).toFixed(3));
  });
  return out;
}

/** Ступени легенды «Early → Late» (те же крайние значения, что у карты). */
export function heatLegend(steps: number = HEAT_LEGEND_STEPS): number[] {
  return Array.from({ length: steps }, (_, s) => Number(opacityAt(s / (steps - 1)).toFixed(3)));
}
