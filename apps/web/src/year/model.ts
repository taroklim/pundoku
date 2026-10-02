/**
 * Модель экрана Year (PD-25): чистые функции без DOM/React. Из прогресса дней (`DayProgress` из
 * `ProgressRepository`) получается «метка дня» — то, что рисует полотно года (раскладка C Blocks).
 *
 * Правила (решения владельца 2026-09-29, STATUS «Решения владельца по Year»):
 * - форма: решено — полный квадрат; начато и брошено — нижняя половина; пропуск — контур;
 *   будущее и время до старта года (самый ранний решённый день) — пусто (`void`);
 * - цвет — по факту «были исправления / не были» (`hadCorrections`), не по числу; «решено с помощью»
 *   (`assisted`) — более светлый тон постоянно;
 * - пропущенный день можно доиграть (архив). PD-125 (решение владельца 6.6, 2026-10-02): такой день — НЕ пропуск, а своё
 *   состояние `late` («решено позже»): отдельный знак (рамка с ядром), в итоги «days/clean/corrections» не входит
 *   (отдельный счётчик), а усилие не стирается — признаки исправлений и помощи у него сохраняются (те же срез угла и тон);
 * - PD-51 (решение владельца 2026-09-30): началом года считается САМАЯ РАННЯЯ ЗАПИСЬ дня, а не `firstUseDate`.
 *   PD-54 (решение PM по полномочию владельца): «записью», которая стартует год, считается только РЕШЁННЫЙ день
 *   (solved, включая доигранный `late`, в том числе архивный). Начатый и брошенный день (`unfinished`) рисуется как
 *   есть, но год не стартует: иначе один ход на «пустом» дне давал ~30 пропусков разом. До старта дни `void`;
 *   пропуски (`missed`) — только от него до вчера. Пока решённых дней нет, пропусков нет вообще; «сегодня» без
 *   прогресса — пусто + кольцо;
 * - граница архива (`archiveStart`: меньшее из `firstUseDate` и самой ранней записи) от этого НЕ меняется — играть
 *   можно с первого дня пользования; она влияет только на кнопку «сыграть» и на список годов, не на раскраску.
 */
import { summary } from "@pundoku/engine";
import type { DayProgress } from "../today/repository";

export type MarkKind = "solved" | "unfinished" | "late" | "missed" | "void";

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
  /** Были исправления (сургуч + срез угла). У `solved`/`late`/`unfinished`. */
  readonly corrections: boolean;
  /** Решено с помощью (светлый тон 62 %). У `solved`/`late`. */
  readonly assisted: boolean;
  /** Решён после своей даты (PD-125): `kind === "late"` — не пропуск; карточка дня покажет результат. */
  readonly late: boolean;
  readonly today: boolean;
  /** Есть запись прогресса (карточка покажет результат, а не «не играно»). */
  readonly hasRecord: boolean;
}

export interface MonthSummary {
  readonly solved: number;
  readonly corrections: number;
  readonly unfinished: number;
  /** Решённых позже своей даты (PD-125): в `solved` не входят. */
  readonly late: number;
}

export interface YearMonth {
  /** 0..11 */
  readonly index: number;
  readonly days: readonly DayMark[];
  readonly summary: MonthSummary;
}

export interface YearTotals {
  /** Решённых дней вовремя (не late). */
  readonly played: number;
  readonly clean: number;
  readonly withCorrections: number;
  /** Решённых позже своей даты (PD-125): отдельный счёт, в `played`/`clean` не входят. */
  readonly late: number;
}

export interface YearView {
  readonly year: number;
  readonly months: readonly YearMonth[];
  readonly totals: YearTotals;
}

export interface YearContext {
  /** Локальная сегодняшняя дата `YYYY-MM-DD`. */
  readonly today: string;
  /** Начало года на полотне: дата самого раннего РЕШЁННОГО дня (нет решённых — сегодня). Раньше неё пропусков нет. */
  readonly start: string;
  /** Граница архива: с какого дня можно играть прошлые дни (`archiveStart`); не влияет на раскраску. */
  readonly archiveStart: string;
  /**
   * Есть ли у года старт, т.е. хоть один решённый день (PD-54; имя историческое — до PD-54 было «любая запись»).
   * Без него пропуски не рисуются вовсе: пока игрок ничего не решил, ни один прошедший день не помечен пропуском
   * (даже если `firstUseDate` в прошлом или есть начатые и брошенные дни).
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
      // PD-125: не пропуск; усилие не стирается — исправления и помощь видны так же, как у решённого вовремя.
      return { ...base, kind: "late", corrections: entry.hadCorrections, assisted: entry.assisted, late: true, hasRecord: true };
    }
    if (entry.status === "solved") {
      return { ...base, kind: "solved", corrections: entry.hadCorrections, assisted: entry.assisted, late: false, hasRecord: true };
    }
    return { ...base, kind: "unfinished", corrections: entry.hadCorrections, assisted: false, late: false, hasRecord: true };
  }
  // Без записи: пропуск — только прошедший день, только начиная с самого раннего решённого дня (`ctx.start`; PD-51/54) и
  // только если такой день есть (пустое состояние: пропусков нет вообще, кольцо сегодняшнего дня остаётся).
  const missed = ctx.hasRecords && date < ctx.today && date >= ctx.start;
  return { ...base, kind: missed ? "missed" : "void", corrections: false, assisted: false, late: false, hasRecord: false };
}

export function buildYear(year: number, entries: ReadonlyMap<string, YearEntry>, ctx: YearContext): YearView {
  let played = 0;
  let withCorrections = 0;
  let lateTotal = 0;
  const months: YearMonth[] = [];
  for (let m = 0; m < 12; m++) {
    const days: DayMark[] = [];
    let solved = 0;
    let corrections = 0;
    let unfinished = 0;
    let late = 0;
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = ymd(year, m, d);
      const mark = markOf(date, entries.get(date), ctx);
      days.push(mark);
      if (mark.kind === "solved") {
        solved++;
        if (mark.corrections) corrections++;
      } else if (mark.kind === "unfinished") unfinished++;
      else if (mark.kind === "late") late++;
    }
    played += solved;
    withCorrections += corrections;
    lateTotal += late;
    months.push({ index: m, days, summary: { solved, corrections, unfinished, late } });
  }
  return { year, months, totals: { played, clean: played - withCorrections, withCorrections, late: lateTotal } };
}

/**
 * Годы, между которыми можно листать (PD-52): от самого раннего года, где что-то есть, до текущего (и позже, если
 * записи есть). «Есть» = запись дня либо играбельный день — от границы архива до сегодня. Поэтому год `archiveStart`
 * (первого запуска/первой записи) входит: дни между ним и первой записью играбельны и должны быть достижимы из Year.
 * Граница из будущего (сдвиг часов назад) год не добавляет сама собой: берётся МИНИМУМ с годом сегодняшнего дня, а год
 * будущей границы не меньше текущего — нижняя граница списка остаётся текущим годом, и `hi < lo` невозможно (иначе
 * список пустел бы, а текущий год выпадал из выбора). Года внутри диапазона не пропускаются (список без дыр).
 */
export function availableYears(entries: ReadonlyMap<string, YearEntry>, ctx: YearContext): number[] {
  let lo = yearOfDate(ctx.today);
  let hi = lo;
  lo = Math.min(lo, yearOfDate(ctx.archiveStart));
  for (const date of entries.keys()) {
    lo = Math.min(lo, yearOfDate(date));
    hi = Math.max(hi, yearOfDate(date));
  }
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/**
 * Граница архива (`ArchiveScreen`/`dayStore`, `firstUse.ts › readUseStart`): меньшее из сохранённой даты первого запуска
 * и самой ранней записи; нет ничего — сегодня. Играть можно с этого дня; на раскраску Year не влияет (см. `yearStart`).
 */
export function archiveStart(firstUse: string | null, entries: ReadonlyMap<string, YearEntry>, today: string): string {
  let start = firstUse ?? today;
  for (const date of entries.keys()) if (date < start) start = date;
  return start;
}

/**
 * Старт года на полотне (PD-51/PD-54): дата самого раннего РЕШЁННОГО дня, включая архивный и доигранный `late`;
 * решённых нет — сегодня. `unfinished` год не стартует: случайный ход на пустом дне не должен разом превращать
 * дни между ним и сегодняшним в пропуски. Граница архива (`archiveStart`) от этого не зависит.
 */
export function yearStart(entries: ReadonlyMap<string, YearEntry>, today: string): string {
  let start: string | null = null;
  for (const [date, e] of entries) if (e.status === "solved" && (start === null || date < start)) start = date;
  return start ?? today;
}

/** Контекст полотна: сегодня, старт года, граница архива и признак «год стартовал» — единое правило для полотна и шита. */
export function yearContext(firstUse: string | null, entries: ReadonlyMap<string, YearEntry>, today: string): YearContext {
  return { today, start: yearStart(entries, today), archiveStart: archiveStart(firstUse, entries, today), hasRecords: [...entries.values()].some((e) => e.status === "solved") };
}
