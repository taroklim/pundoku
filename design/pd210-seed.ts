/**
 * PD-210: записи дней для кадра Year «Mode · Lantern» (`pd210-check.mjs`). Настоящие партии движка — фикстуры тестов
 * (`apps/web/src/sync/fixtures.ts`), флаг `lantern: true` у партии; формат `DayProgress` хранилища `days` IndexedDB.
 *
 *   pnpm --filter @pundoku/api exec tsx ../../design/pd210-seed.ts 2026-10-06 > /tmp/seed.json
 *
 * Выход: { year: DayProgress[], lanternDate, plainDate } — день Фонаря (сегодня − 1) и обычный день (сегодня − 2).
 */
import { progressOf } from "../apps/web/src/sync/fixtures";

const today = process.argv[2];
if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("usage: pd210-seed.ts YYYY-MM-DD");
const shift = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, dd + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const lanternDate = shift(today, -1);
const plainDate = shift(today, -2);
const lantern = progressOf(lanternDate, { solvedAt: `${lanternDate}T09:00:00.000Z` });
const year = [{ ...lantern, play: { ...lantern.play, lantern: true as const } }, progressOf(plainDate, { solvedAt: `${plainDate}T09:00:00.000Z` })];
process.stdout.write(JSON.stringify({ year, lanternDate, plainDate }));
