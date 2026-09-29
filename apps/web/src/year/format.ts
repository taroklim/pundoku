/** Форматирование дат для экрана Year (PD-25): всё через Intl по локали интерфейса, без ручных таблиц названий. */

const capitalize = (s: string): string => (s === "" ? s : s.charAt(0).toLocaleUpperCase() + s.slice(1));

/** Отдельное название месяца (именительный падеж), заглавная: «Aug», «Серп.», «Август». */
export function monthName(month0: number, locale: string, width: "short" | "long"): string {
  const parts = new Intl.DateTimeFormat(locale, { month: width }).formatToParts(new Date(2021, month0, 1));
  return capitalize(parts.find((p) => p.type === "month")?.value ?? "");
}

/** «August 2026» — заголовок шита месяца. */
export function monthTitle(year: number, month0: number, locale: string): string {
  return `${monthName(month0, locale, "long")} ${year}`;
}

/** `YYYY-MM-DD` → локальная полночь (без сдвига часовых поясов). */
export function dateOf(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/** «Wed 12 August» — день недели, число, месяц (порядок как в подписи дня Today; месяц — в форме «с числом»). */
export function dayLong(ymd: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long" }).formatToParts(dateOf(ymd));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [pick("weekday"), pick("day"), pick("month")].filter(Boolean).join(" ");
}

/** С какого дня начинается неделя в шите месяца: 0 = воскресенье (en, как в макете), 1 = понедельник (uk, ru). */
export function weekStart(locale: string): 0 | 1 {
  return locale.toLowerCase().startsWith("en") ? 0 : 1;
}

/** Однобуквенные подписи дней недели в порядке отображения (для колонок шита; `aria-hidden`). */
export function weekdayInitials(locale: string): string[] {
  const first = weekStart(locale);
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  // 2021-08-01 — воскресенье.
  return Array.from({ length: 7 }, (_, i) => capitalize(fmt.format(new Date(2021, 7, 1 + ((first + i) % 7)))));
}

/** Сколько пустых клеток перед 1-м числом месяца в календарной сетке шита. */
export function leadingBlanks(year: number, month0: number, locale: string): number {
  const dow = new Date(year, month0, 1).getDay(); // 0 = воскресенье
  return (dow - weekStart(locale) + 7) % 7;
}
