/**
 * Подписи экрана Year для VoiceOver и текста (PD-25): месяц и итоги словами, состояние дня.
 * Клетки полотна `aria-hidden`; доступная единица — месяц целиком («August, 21 of 31 days solved, 4 with
 * corrections»). Контур пропуска (1.71:1) — не единственный носитель смысла: пропуск назван словами
 * в подписи кнопки дня (шит) и в карточке дня. «Решено позже» (PD-125) — рамка с ядром, тоже названа словами.
 */
import type { TFunction } from "i18next";
import { monthName } from "./format";
import type { DayMark, YearMonth } from "./model";

/** Строка `markClass`: CSS-классы метки дня (формы и тона задают только они — см. `styles/year.css`). */
export function markClass(mark: Pick<DayMark, "kind" | "corrections" | "assisted" | "today">, withToday = true): string {
  const c = ["ymark", `is-${mark.kind}`];
  if (mark.corrections) c.push("has-corr");
  if (mark.assisted) c.push("has-help");
  if (withToday && mark.today) c.push("is-today");
  return c.join(" ");
}

/** «21 of 31 days solved, 4 with corrections[, 2 unfinished]» — без названия месяца (подпись в шите и часть подписи месяца). */
export function monthSummaryText(t: TFunction, month: YearMonth): string {
  const { solved, corrections, helped, unfinished, late } = month.summary;
  if (solved === 0 && unfinished === 0 && late === 0) return t("year.monthNothing");
  const parts = [t("year.monthSummary", { solved, count: month.days.length, corrections })];
  if (helped > 0) parts.push(t("year.monthHelp", { n: helped }));
  if (late > 0) parts.push(t("year.monthLate", { n: late }));
  if (unfinished > 0) parts.push(t("year.monthUnfinished", { n: unfinished }));
  return parts.join(", ");
}

/** Подпись кнопки-месяца: «August, 21 of 31 days solved, 4 with corrections». */
export function monthAriaLabel(t: TFunction, month: YearMonth, locale: string): string {
  return `${monthName(month.index, locale, "long")}, ${monthSummaryText(t, month)}`;
}

/** Ключ состояния дня для подписи кнопки дня в шите (полные слова, не цвет и не форма). */
export function dayStateKey(mark: DayMark, ctx: { today: string; archiveStart: string; hasRecords: boolean }): string {
  switch (mark.kind) {
    case "solved":
      return mark.assisted
        ? mark.corrections
          ? "solvedHelpCorrections"
          : "solvedHelp"
        : mark.corrections
          ? "solvedCorrections"
          : "solved";
    case "unfinished":
      return mark.corrections ? "unfinishedCorrections" : "unfinished";
    case "late":
      // PD-125: «решено позже» — не пропуск; исправления/помощь названы словами, как у решённого вовремя.
      return mark.assisted ? (mark.corrections ? "lateHelpCorrections" : "lateHelp") : mark.corrections ? "lateCorrections" : "late";
    case "missed":
      return "missed";
    case "void":
      if (mark.date === ctx.today) return "today";
      if (mark.date > ctx.today) return "future";
      // Прошедший день без метки (PD-51). С решённым днём пропуск начинается с самого раннего из них (PD-54), так что безымянными
      // остаются только дни ДО него: «before your first entry». Без решённых дней пропусков нет вообще: дни с границы архива —
      // нейтральное «нет записи» (не «не играно»: это слово пропуска), раньше неё — тоже «before».
      return !ctx.hasRecords && mark.date >= ctx.archiveStart ? "noRecord" : "before";
  }
}
