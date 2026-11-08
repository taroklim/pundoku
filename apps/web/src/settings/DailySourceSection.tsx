/**
 * PD-305: раздел Settings «Сетка дня» — источник сетки Today: Sudoku.com (по умолчанию, как было) или наш «Эксперт без X-Wing»
 * (`dailyPuzzle(date, 'expert')` на устройстве). Радиогруппа — как «Язык» (roving tabindex, стрелки выбирают).
 *
 * Начатый или решённый сегодня день источник не меняет (правило `DayStore`); если выбранный источник расходится с сеткой,
 * которая сегодня уже идёт, под группой — строка «действует со следующего дня». Не начатый день переключается сразу.
 */
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DayStatus } from "../today/dayStore";
import type { DailySource } from "./prefs";
import { setDailySource, useDailySource } from "./prefs";

const SOURCES: readonly DailySource[] = ["sudoku.com", "pundoku"];
const LABEL: Record<DailySource, string> = { "sudoku.com": "settings.daily.sudoku", pundoku: "settings.daily.own" };

/** Подпись «со следующего дня»: день начат, а выбран не тот источник, которым он играется. */
export function appliesTomorrow(status: DayStatus | null, source: DailySource): boolean {
  return status !== null && status.started && status.own !== (source === "pundoku");
}

/** `check` — галочка выбранной строки (та же, что у «Языка» в Settings). */
export function DailySourceSection({ dayStatus, check }: { dayStatus?: () => Promise<DayStatus | null>; check: ReactNode }) {
  const { t } = useTranslation();
  const source = useDailySource();
  const [status, setStatus] = useState<DayStatus | null>(null);
  const refs = useRef<Partial<Record<DailySource, HTMLButtonElement | null>>>({});

  // Перечитываем на открытии и после каждой смены: не начатый день стор уже переключил, начатый — остался прежним.
  useEffect(() => {
    if (!dayStatus) return;
    let live = true;
    void dayStatus().then((st) => {
      if (live) setStatus(st);
    });
    return () => {
      live = false;
    };
  }, [dayStatus, source]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SOURCES.indexOf(source);
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % SOURCES.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + SOURCES.length) % SOURCES.length;
    else return;
    e.preventDefault();
    const id = SOURCES[next] as DailySource;
    setDailySource(id);
    refs.current[id]?.focus();
  };
  const later = appliesTomorrow(status, source);

  return (
    <section className="settings-sec" aria-labelledby="settings-h-daily">
      <h2 className="settings-head" id="settings-h-daily">
        {t("settings.daily.head")}
      </h2>
      <div className="settings-card" role="radiogroup" aria-labelledby="settings-h-daily" aria-describedby="settings-daily-foot" onKeyDown={onKey}>
        {SOURCES.map((id) => (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="radio"
            aria-checked={id === source}
            tabIndex={id === source ? 0 : -1}
            className="settings-row settings-radio"
            onClick={() => setDailySource(id)}
            data-testid={`daily-source-${id}`}
          >
            <span className="lab">{t(LABEL[id])}</span>
            <span className="ck" aria-hidden="true">
              {check}
            </span>
          </button>
        ))}
      </div>
      <p className="settings-foot" id="settings-daily-foot">
        {later && (
          <span className="settings-later" data-testid="daily-source-later">
            {t("settings.daily.later")}{" "}
          </span>
        )}
        {t("settings.daily.foot")}
      </p>
    </section>
  );
}
