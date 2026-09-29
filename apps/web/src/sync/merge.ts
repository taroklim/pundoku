/**
 * Слияние снапшотов при конфликте (`409 snapshot_conflict`) и при восстановлении с сервера (PD-14).
 * Чистые функции; политика — то, что зафиксировано в README `apps/web` (§ «Политика слияния»):
 *
 * 1. **Дни — объединение по датам.** Дни, которых нет с одной стороны, берутся с другой.
 * 2. **Конфликт по одному дню:** «решён» сильнее «не решён»; оба решены — побеждает более ранний
 *    `solvedAt` (первое решение — «настоящее»); равенство — детерминированно (запись с `moveLog`, затем
 *    по сериализации); оба не решены — больше `timeMs` (дальше продвинулись).
 * 3. **Grid ∞ (`installSeed`, `index`, набор улётов):** «первичной» берётся серверная сторона, если
 *    сервер новее по `version` (на 409 — всегда: сервер ушёл вперёд от последней синхронизации клиента),
 *    иначе клиентская. Её `installSeed` и `index` остаются. Улёты второй стороны добавляются по датам
 *    (одна дата — один улёт), в порядке дат; клетка, занятая другим улётом, сдвигается к ближайшей
 *    свободной (`landingCell`). Если у сторон `installSeed` совпал, а `index` разный — берётся сторона
 *    с большим `index` целиком (меньшая сетка уже дорешана).
 * 4. Слияние коммутативно при одинаковом `serverNewer`, идемпотентно и не теряет данные:
 *    `merge(a, a) = a`, повторное слияние с уже слитым — no-op. Поэтому ретраи безопасны.
 */
import { landingCell } from "../today/permanent";
import type { PermanentGridState } from "../today/permanent";
import type { DayRecord, SnapshotData } from "./schema";
import { SNAPSHOT_SCHEMA_VERSION } from "./schema";

/** Какая из двух записей одного дня побеждает. Возвращает «лучшую» (`a` при равенстве по всем признакам). */
export function pickDayRecord(a: DayRecord, b: DayRecord): DayRecord {
  if (a.status !== b.status) return a.status === "solved" ? a : b;
  if (a.status === "solved") {
    const ta = Date.parse(a.solvedAt ?? "");
    const tb = Date.parse(b.solvedAt ?? "");
    if (ta !== tb) return ta < tb ? a : b;
    const la = a.moveLog?.length ?? 0;
    const lb = b.moveLog?.length ?? 0;
    if ((la > 0) !== (lb > 0)) return la > 0 ? a : b;
  } else {
    const ta = a.timeMs ?? 0;
    const tb = b.timeMs ?? 0;
    if (ta !== tb) return ta > tb ? a : b;
  }
  return JSON.stringify(a) <= JSON.stringify(b) ? a : b;
}

export function mergeDays(a: Record<string, DayRecord>, b: Record<string, DayRecord>): Record<string, DayRecord> {
  const out: Record<string, DayRecord> = { ...a };
  for (const [date, rec] of Object.entries(b)) {
    const mine = out[date];
    out[date] = mine ? pickDayRecord(mine, rec) : rec;
  }
  return out;
}

/** Улёты Grid ∞ как множество по датам: `primary` + улёты `secondary`, которых там нет (см. п. 3 политики). */
export function mergeGrid(
  local: PermanentGridState | null,
  server: PermanentGridState | null,
  serverNewer: boolean,
): PermanentGridState | null {
  if (!local || !server) return local ?? server;
  let primary = serverNewer ? server : local;
  let secondary = serverNewer ? local : server;
  if (primary.installSeed === secondary.installSeed && secondary.index > primary.index) {
    [primary, secondary] = [secondary, primary];
  }
  if (primary.installSeed === secondary.installSeed && primary.index > secondary.index) return primary;
  // Одна сетка (или разные installSeed): улёты secondary добираются в primary по датам.
  let state: PermanentGridState = { installSeed: primary.installSeed, index: primary.index, cells: [...primary.cells] };
  const known = new Set(state.cells.map((c) => c.date));
  const extra = secondary.cells.filter((c) => !known.has(c.date)).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  for (const { cell, date } of extra) {
    const at = landingCell(state, cell);
    if (at === null) break; // сетка заполнена
    state = { ...state, cells: [...state.cells, { cell: at, date }] };
  }
  return state;
}

export interface MergeOptions {
  /** Серверный снапшот новее клиентского по `version` (на 409 и при восстановлении — всегда `true`). */
  serverNewer: boolean;
}

export function mergeSnapshots(local: SnapshotData, server: SnapshotData, o: MergeOptions): SnapshotData {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    grid: mergeGrid(local.grid, server.grid, o.serverNewer),
    days: mergeDays(local.days, server.days),
  };
}

const stable = (v: unknown): string => JSON.stringify(v);

export const sameDayRecord = (a: DayRecord | undefined, b: DayRecord | undefined): boolean => stable(a) === stable(b);

export const sameGrid = (a: PermanentGridState | null, b: PermanentGridState | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.installSeed !== b.installSeed || a.index !== b.index || a.cells.length !== b.cells.length) return false;
  const key = (c: { cell: number; date: string }) => `${c.date}:${c.cell}`;
  const set = new Set(a.cells.map(key));
  return b.cells.every((c) => set.has(key(c)));
};

/** Данные равны с точностью до порядка ключей/улётов. */
export const sameSnapshotData = (a: SnapshotData, b: SnapshotData): boolean => {
  const da = Object.keys(a.days);
  if (da.length !== Object.keys(b.days).length) return false;
  return sameGrid(a.grid, b.grid) && da.every((d) => sameDayRecord(a.days[d], b.days[d]));
};
