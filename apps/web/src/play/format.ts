/** Форматирование подписи дня и тихого таймера (PD-11). */
import { dateOf } from "../year/format";

/** «Wed 29 Sep» — день недели, число, месяц (порядок как в макете, для en/uk/ru). */
export function formatDay(date: Date, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [pick("weekday"), pick("day"), pick("month")].filter(Boolean).join(" ");
}

/**
 * PD-262: «7 Oct» / «7 жовт.» / «7 окт.» — дата игры дня в строке «Продолжить» хаба, когда она не сегодняшняя. Тот же порядок
 * «число месяц» и те же короткие месяцы Intl, что в подписи дня Today (`formatDay`), только без дня недели. День другого года —
 * с годом, как дата в настройках: «31 Dec 2025» / «31 дек. 2025» (без «г.»/«р.»), чтобы прошлогодний день не читался как этот.
 */
export function formatShortDay(ymd: string, locale: string, today: string): string {
  const withYear = ymd.slice(0, 4) !== today.slice(0, 4);
  const options: Intl.DateTimeFormatOptions = withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" };
  const parts = new Intl.DateTimeFormat(locale, options).formatToParts(dateOf(ymd));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [pick("day"), pick("month"), withYear ? pick("year") : ""].filter(Boolean).join(" ");
}

/** «4:12»; от часа — «1:04:12». */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
