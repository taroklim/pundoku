/**
 * Модель экрана Year (PD-25): чистые функции без DOM/React. Из прогресса дней (`DayProgress` из
 * `ProgressRepository`) получается «метка дня» — то, что рисует полотно года (раскладка C Blocks).
 *
 * Правила (решения владельца 2026-09-29, STATUS «Решения владельца по Year»):
 * - форма: решено — полный квадрат; начато и брошено — нижняя половина; пропуск — контур;
 *   будущее и время до начала пользования — пусто (`void`);
 * - цвет — по факту «были исправления / не были» (`hadCorrections`), не по числу; «решено с помощью»
 *   (`assisted`) — более светлый тон постоянно;
 * - пропущенный день можно доиграть (архив), но в Year он остаётся пропуском: решённый день с
 *   `late = true` рисуется как `missed`;
 * - до начала пользования ни один прошедший день не помечен пропуском; при нулевых записях пропусков нет вообще;
 *   «сегодня» без прогресса — пусто + кольцо.
 */
import { summary } from "@pundoku/engine";
import type { DayProgress } from "../today/repository";

export type MarkKind = "solved" | "unfinished" | "missed" | "void";

/** Итог дня из записи прогресса: то, что нужно полотну (без heat/moveLog). */
export interface YearEntry {
  readonly status: "solved" | "unfinished";
  /** Были ли исправления или ошибки (`!summary.clean`) — тот же признак, что `DayRecord.hadCorrections` снапшота. */
  readonly hadCorrections: boolean;
  readonly assisted: boolean;
  /** Решён после своей даты (архив). У `unfinished` всегда `false` (запись дня не хранит «начато поздно»). */
  readonly late: boolean;
}

export interface DayMark {
  /** `YYYY-MM-DD` */
  readonly date: string;
  /** Число месяца, 1..31. */
  readonly day: number;
  readonly kind: MarkKind;
  /** Были исправления (сургуч + срез угла). Только у `solved`/`unfinished`. */
  readonly corrections: boolean;
  /** Решено с помощью (светлый тон 62 %). Только у `solved`. */
  readonly assisted: boolean;
  /** Решён после своей даты: kind = `missed`, но карточка дня покажет результат. */
  readonly late: boolean;
  readonly today: boolean;
  /** Есть запись прогресса (карточка покажет результат, а не «не играно»). */
  readonly hasRecord: boolean;
}

export interface MonthSummary {
  readonly solved: number;
  readonly corrections: number;
  readonly unfinished: number;
}

export interface YearMonth {
  /** 0..11 */
  readonly index: number;
  readonly days: readonly DayMark[];
  readonly summary: MonthSummary;
}

export interface YearTotals {
  /** Решённых дней (не late). */
  readonly played: number;
  readonly clean: number;
  readonly withCorrections: number;
}

export interface YearView {
  readonly year: number;
  readonly months: readonly YearMonth[];
  readonly totals: YearTotals;
}

export interface YearContext {
  /** Локальная сегодняшняя дата `YYYY-MM-DD`. */
  readonly today: string;
  /** Начало пользования (первый день): раньше него пропусков нет. */
  readonly start: string;
  /**
   * Есть ли хоть одна запись прогресса. Без записей пропуски не рисуются вовсе: пока игрок ничего не сыграл,
   * ни один прошедший день не помечен пропуском (даже если `firstUseDate` в прошлом).
   */
  readonly hasRecords: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");
export const ymd = (year: number, month0: number, day: number): string => `${year}-${pad(month0 + 1)}-${pad(day)}`;
export const daysInMonth = (year: number, month0: number): number => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
export const yearOfDate = (date: string): number => Number(date.slice(0, 4));

/** Итог дня из локального прогресса. `null` — день без ходов (в Year не попадает, как и в снапшот). */
export function entryFromProgress(p: DayProgress): YearEntry | null {
  if (!p.solved && p.play.log.length === 0) return null;
  const hadCorrections = !summary(p.play.log).clean;
  if (p.solved) return { status: "solved", hadCorrections, assisted: p.assisted, late: p.late };
  return { status: "unfinished", hadCorrections, assisted: false, late: false };
}

/** Метка одного дня по его записи (или её отсутствию). */
export function markOf(date: string, entry: YearEntry | undefined, ctx: YearContext): DayMark {
  const base = { date, day: Number(date.slice(8, 10)), today: date === ctx.today };
  if (entry) {
    if (entry.status === "solved" && entry.late) {
      return { ...base, kind: "missed", corrections: false, assisted: false, late: true, hasRecord: true };
    }
    if (entry.status === "solved") {
      return { ...base, kind: "solved", corrections: entry.hadCorrections, assisted: entry.assisted, late: false, hasRecord: true };
    }
    return { ...base, kind: "unfinished", corrections: entry.hadCorrections, assisted: false, late: false, hasRecord: true };
  }
  // Без записи: пропуск — только прошедший день, только начиная с первого дня пользования и только если
  // у игрока уже есть хоть одна запись (пустое состояние: пропусков нет вообще, кольцо сегодняшнего дня остаётся).
  const missed = ctx.hasRecords && date < ctx.today && date >= ctx.start;
  return { ...base, kind: missed ? "missed" : "void", corrections: false, assisted: false, late: false, hasRecord: false };
}

export function buildYear(year: number, entries: ReadonlyMap<string, YearEntry>, ctx: YearContext): YearView {
  let played = 0;
  let withCorrections = 0;
  const months: YearMonth[] = [];
  for (let m = 0; m < 12; m++) {
    const days: DayMark[] = [];
    let solved = 0;
    let corrections = 0;
    let unfinished = 0;
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = ymd(year, m, d);
      const mark = markOf(date, entries.get(date), ctx);
      days.push(mark);
      if (mark.kind === "solved") {
        solved++;
        if (mark.corrections) corrections++;
      } else if (mark.kind === "unfinished") unfinished++;
    }
    played += solved;
    withCorrections += corrections;
    months.push({ index: m, days, summary: { solved, corrections, unfinished } });
  }
  return { year, months, totals: { played, clean: played - withCorrections, withCorrections } };
}

/** Годы, между которыми можно листать: от начала пользования/первой записи до текущего (и позже, если записи есть). */
export function availableYears(entries: ReadonlyMap<string, YearEntry>, ctx: YearContext): number[] {
  let lo = yearOfDate(ctx.start);
  let hi = yearOfDate(ctx.today);
  for (const date of entries.keys()) {
    lo = Math.min(lo, yearOfDate(date));
    hi = Math.max(hi, yearOfDate(date));
  }
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** Начало пользования: меньшее из сохранённой даты первого запуска и самой ранней записи; нет ничего — сегодня. */
export function startDate(firstUse: string | null, entries: ReadonlyMap<string, YearEntry>, today: string): string {
  let start = firstUse ?? today;
  for (const date of entries.keys()) if (date < start) start = date;
  return start;
}

/** Контекст полотна: сегодня, начало пользования и признак «записи есть» — единое правило для полотна и шита. */
export function yearContext(firstUse: string | null, entries: ReadonlyMap<string, YearEntry>, today: string): YearContext {
  return { today, start: startDate(firstUse, entries, today), hasRecords: entries.size > 0 };
}
