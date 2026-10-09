/**
 * PD-260: записи дней для живой проверки движения Питомца (`pd260-check.mjs`). Настоящие партии движка — фикстуры тестов
 * (`apps/web/src/sync/fixtures.ts`) в формате `DayProgress` хранилища `days` IndexedDB.
 *
 *   pnpm --filter @pundoku/api exec tsx ../../design/pd260-seed.ts 2026-10-09 > /tmp/seed.json
 *
 * Выход:
 *   pending[mood]  — сегодня НЕ решён, осталась одна клетка (`last`: индекс клетки и цифра): решаем в UI → «решили сейчас»;
 *                    для «удивлён» в истории вчерашний день той же сложности вдвое медленнее (рекорд).
 *   solved[mood]   — сегодня уже решён (повторное открытие карточки → только покой).
 *   year, dates    — лист дня Year: доволен / спит / устал / удивлён + `wake` (решённый день, прежде показанный «спит»).
 */
import { progressOf } from "../apps/web/src/sync/fixtures";
import type { DayProgress } from "../apps/web/src/today/repository";

const today = process.argv[2];
if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("usage: pd260-seed.ts YYYY-MM-DD");
const shift = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, dd + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const timed = (p: DayProgress, factor: number): DayProgress => {
  const log = p.play.log.map((m) => ({ ...m, t: Math.round(m.t * factor) }));
  return { ...p, play: { ...p.play, log }, elapsedMs: log.length ? log[log.length - 1]!.t : 0 };
};
const at = (d: string) => `${d}T09:00:00.000Z`;

/** Сегодня без последней клетки: та же партия, что и решённая, но последняя пустая клетка миссии не поставлена. */
function pendingOf(opts: { withFix?: boolean }): { day: DayProgress; last: { cell: number; digit: number } } {
  const full = progressOf(today, { ...opts });
  const empty = full.play.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  const day = progressOf(today, { ...opts, solved: false, moves: empty.length - 1 });
  const cell = empty[empty.length - 1]!;
  return { day, last: { cell, digit: full.play.solution[cell]! } };
}

const yest = shift(today, -1);
const ph = pendingOf({});
const pt = pendingOf({ withFix: true });
const pending = {
  happy: { days: [ph.day], last: ph.last },
  tired: { days: [pt.day], last: pt.last },
  // Рекорд: вчерашний день той же сложности втрое медленнее (живое время решения последней клетки добавит секунды).
  surprised: { days: [timed(progressOf(yest, { solvedAt: at(yest) }), 3), ph.day], last: ph.last },
};
const solved = {
  happy: [progressOf(today, { solvedAt: at(today) })],
  tired: [progressOf(today, { withFix: true, solvedAt: at(today) })],
};

const d = { slow: shift(today, -5), asleep: shift(today, -4), tired: shift(today, -3), surprised: shift(today, -2), wake: shift(today, -6) };
const year = [
  timed(progressOf(d.slow, { solvedAt: at(d.slow) }), 2), // доволен
  timed(progressOf(d.tired, { withFix: true, solvedAt: at(d.tired) }), 3), // устал
  progressOf(d.surprised, { solvedAt: at(d.surprised) }), // рекорд → удивлён
  timed(progressOf(d.wake, { solvedAt: at(d.wake) }), 1.5), // первое решение (не рекорд) → доволен; в памяти показа «спит» → «проснуться»
];
process.stdout.write(JSON.stringify({ today, pending, solved, year, dates: { happy: d.slow, asleep: d.asleep, tired: d.tired, surprised: d.surprised, wake: d.wake } }));
