/** Форматирование подписи дня и тихого таймера (PD-11). */

/** «Wed 29 Sep» — день недели, число, месяц (порядок как в макете, для en/uk/ru). */
export function formatDay(date: Date, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [pick("weekday"), pick("day"), pick("month")].filter(Boolean).join(" ");
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
