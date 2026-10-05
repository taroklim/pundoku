/**
 * PD-180: записи дней для кадров питомца (`pd180-shots.mjs`). Настоящие партии движка — те же фикстуры, что в тестах
 * (`apps/web/src/sync/fixtures.ts`), в формате `DayProgress` хранилища `days` IndexedDB.
 *
 *   pnpm --filter @pundoku/api exec tsx ../../design/pd180-seed.ts 2026-10-05 > /tmp/seed.json
 *
 * Выход: { card: { happy, tired, surprised }: DayProgress[] (сегодня + история), year: DayProgress[], dates }.
 */
import { progressOf } from "../apps/web/src/sync/fixtures";
import type { DayProgress } from "../apps/web/src/today/repository";

const today = process.argv[2];
if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("usage: pd180-seed.ts YYYY-MM-DD");
const shift = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, dd + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
/** Растянуть/сжать тайминги лога: время решения × factor. */
const timed = (p: DayProgress, factor: number): DayProgress => {
  const log = p.play.log.map((m) => ({ ...m, t: Math.round(m.t * factor) }));
  return { ...p, play: { ...p.play, log }, elapsedMs: log.length ? log[log.length - 1]!.t : 0 };
};
const at = (d: string) => `${d}T09:00:00.000Z`;

const card = {
  happy: [progressOf(today, { solvedAt: at(today) })],
  tired: [progressOf(today, { withFix: true, solvedAt: at(today) })],
  // Рекорд: сегодня вдвое быстрее единственного прежнего дня той же сложности.
  surprised: [timed(progressOf(shift(today, -1), { solvedAt: at(shift(today, -1)) }), 2), progressOf(today, { solvedAt: at(today) })],
};
const d = { slow: shift(today, -4), asleep: shift(today, -3), tired: shift(today, -2), surprised: shift(today, -1) };
const year = [
  timed(progressOf(d.slow, { solvedAt: at(d.slow) }), 2), // доволен
  timed(progressOf(d.tired, { withFix: true, solvedAt: at(d.tired) }), 3), // устал (медленнее — не рекорд: рекорд сильнее правок)
  progressOf(d.surprised, { solvedAt: at(d.surprised) }), // рекорд → удивлён
];
process.stdout.write(JSON.stringify({ card, year, dates: { happy: d.slow, asleep: d.asleep, tired: d.tired, surprised: d.surprised } }));
