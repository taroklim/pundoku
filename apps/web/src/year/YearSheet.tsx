import { heatmap, summary } from "@pundoku/engine";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { formatClock } from "../play/format";
import { heatLegend, heatOpacities } from "../play/heat";
import { cellsLeft } from "../play/logic";
import type { DayProgress } from "../today/repository";
import { dayLong, leadingBlanks, monthName, monthTitle, weekdayInitials } from "./format";
import { dayStateKey, markClass, monthSummaryText } from "./labels";
import type { DayMark, YearContext, YearMonth } from "./model";

/** Длительность выезда/скрытия шита, мс (CSS: 280; при reduced motion — 160, таймер берёт максимум). */
export const SHEET_MS = 300;

export interface SheetState {
  readonly month: number;
  /** `YYYY-MM-DD` открытого дня (вторая страница шита); `null` — страница месяца. */
  readonly date: string | null;
  readonly closing: boolean;
}

interface YearSheetProps {
  year: number;
  month: YearMonth;
  date: string | null;
  closing: boolean;
  ctx: YearContext;
  progress: ReadonlyMap<string, DayProgress>;
  onOpenDay: (date: string) => void;
  onBack: () => void;
  onClose: () => void;
  onOpenToday: () => void;
  /** Что закрыть для ассистивных технологий, пока шит открыт (по умолчанию `#root`). */
  inertTarget?: () => HTMLElement | null;
}

/**
 * Шит месяца (макет `pd24-year-variants.html`, §5): страница месяца с клетками дней ≥ 44 pt →
 * тап по дню → карточка дня — ВТОРАЯ СТРАНИЦА того же шита с шевроном «‹ Месяц», а не второй шит
 * поверх первого (modality.md). Модальный: фон `inert`, фокус в шите, Esc и «Done» закрывают.
 * Рисуется порталом в `body` (вне `.scroll`), поэтому таб-бар и прокрутка полотна не мешают.
 */
export function YearSheet({ year, month, date, closing, ctx, progress, onOpenDay, onBack, onClose, onOpenToday, inertTarget }: YearSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const sheetRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [entered, setEntered] = useState(false);

  // Проявление: сначала кадр в закрытом состоянии, затем класс — иначе transition не сработает.
  useEffect(() => {
    void sheetRef.current?.getBoundingClientRect();
    setEntered(true);
  }, []);

  // Фон недоступен (VoiceOver/Tab), пока шит открыт.
  useEffect(() => {
    const target = (inertTarget ?? (() => document.getElementById("root")))();
    target?.setAttribute("inert", "");
    return () => target?.removeAttribute("inert");
  }, [inertTarget]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Фокус — на заголовок текущей страницы (VoiceOver читает название), при смене страницы — снова.
  useEffect(() => {
    (date ? headRef.current : sheetRef.current)?.focus({ preventScroll: true });
  }, [date]);

  const title = monthTitle(year, month.index, locale);
  const mark = date ? month.days.find((d) => d.date === date) : undefined;
  const label = mark ? dayLong(mark.date, locale) : title;

  return createPortal(
    <div className={`ysheet-root${entered && !closing ? " is-open" : ""}`} data-testid="year-sheet-root">
      <div className="ysheet-scrim" onClick={onClose} aria-hidden="true" />
      <section
        ref={sheetRef}
        className="ysheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-testid="year-sheet"
        data-page={date ? "day" : "month"}
      >
        <div className="grabber" aria-hidden="true" />
        <header className="ysheet-head">
          {date ? (
            <button type="button" className="back" onClick={onBack} aria-label={t("year.sheetBack", { month: monthName(month.index, locale, "long") })}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 6-6 6 6 6" />
              </svg>
              <span>{monthName(month.index, locale, "long")}</span>
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          {date ? (
            <span aria-hidden="true" />
          ) : (
            <h2 className="ysheet-title" ref={headRef} tabIndex={-1}>
              {title}
            </h2>
          )}
          <button type="button" className="done" onClick={onClose}>
            {t("year.sheetDone")}
          </button>
        </header>
        <div className="ysheet-body">
          {mark ? (
            <DayCard mark={mark} ctx={ctx} progress={progress.get(mark.date)} headRef={headRef} onOpenToday={onOpenToday} />
          ) : (
            <MonthPage year={year} month={month} ctx={ctx} onOpenDay={onOpenDay} />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MonthPage({ year, month, ctx, onOpenDay }: { year: number; month: YearMonth; ctx: YearContext; onOpenDay: (date: string) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const initials = useMemo(() => weekdayInitials(locale), [locale]);
  const blanks = leadingBlanks(year, month.index, locale);
  return (
    <>
      <div className="wk" aria-hidden="true">
        {initials.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="mcal" data-testid="month-page">
        {Array.from({ length: blanks }, (_, i) => (
          <div key={`b${i}`} className="ycell blank" aria-hidden="true" />
        ))}
        {month.days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={`ycell${d.today ? " today" : ""}`}
            data-date={d.date}
            aria-label={`${dayLong(d.date, locale)}, ${t(`year.state.${dayStateKey(d, ctx)}`)}`}
            onClick={() => onOpenDay(d.date)}
          >
            <span className="n" aria-hidden="true">
              {d.day}
            </span>
            <i className={markClass(d, false)} aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="sheet-foot">{monthSummaryText(t, month)}</p>
    </>
  );
}

/**
 * Карточка дня: те же компоненты, что у карточки результата Today (тепловая карта по `heatmap(log)`, время,
 * исправления, техника). Данные — из `DayProgress`; для дней, восстановленных с сервера без `moveLog`, лог
 * синтетический (`sync/schema.ts › logFromHeat`), карточка показывает то же.
 */
function DayCard({
  mark,
  ctx,
  progress,
  headRef,
  onOpenToday,
}: {
  mark: DayMark;
  ctx: YearContext;
  progress: DayProgress | undefined;
  headRef: RefObject<HTMLHeadingElement | null>;
  onOpenToday: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const solved = progress?.solved === true;
  const showSub = progress !== undefined;
  // «Сколько поставлено» считается только по клеткам, которые игрок заполняет сам: заданные клетки не в счёт.
  const toFill = progress ? progress.play.mission.filter((g) => g === 0).length : 0;

  const sum = useMemo(() => (progress && solved ? summary(progress.play.log) : null), [progress, solved]);
  const heat = useMemo(
    () =>
      progress && solved
        ? heatOpacities(heatmap(progress.play.log, { mission: progress.play.mission.join(""), solution: progress.play.solution.join("") }))
        : null,
    [progress, solved],
  );
  const legend = useMemo(() => heatLegend(), []);

  const sub = showSub
    ? [progress.difficulty ? t(`difficulty.${progress.difficulty}`) : null, t("year.card.dailyPuzzle")].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="daycard" data-testid="day-card" data-kind={mark.kind} data-late={mark.late ? "true" : "false"}>
      <h3 ref={headRef} tabIndex={-1}>
        {dayLong(mark.date, locale)}
      </h3>
      {sub && <p className="sub">{sub}</p>}

      {progress && solved && sum && heat ? (
        <>
          <div className="heat" role="img" aria-label={t("result.heatLabel")} data-testid="heat">
            {heat.map((o, i) => (o === null ? <i key={i} className="g" /> : <i key={i} style={{ opacity: o }} data-o={o} />))}
          </div>
          <div className="legend">
            <span>{t("result.early")}</span>
            <span className="bar" aria-hidden="true">
              {legend.map((o, i) => (
                <i key={i} style={{ opacity: o }} />
              ))}
            </span>
            <span>{t("result.late")}</span>
          </div>
          <dl className="rows">
            <div className="row">
              <dt>{t("solved.time")}</dt>
              <dd className="mono">{formatClock(sum.durationMs)}</dd>
            </div>
            <div className="row">
              <dt>{t("solved.corrections")}</dt>
              <dd className={sum.clean ? undefined : "err"}>{sum.clean ? t("solved.clean") : sum.corrections}</dd>
            </div>
            <div className="row">
              <dt>{t("solved.technique")}</dt>
              <dd>{sum.maxTechnique ? t(`technique.${sum.maxTechnique}`) : "—"}</dd>
            </div>
            {progress.assisted && (
              <div className="row" data-testid="assisted-row">
                <dt>{t("year.card.assistedRow")}</dt>
                <dd>{t("year.card.assistedValue")}</dd>
              </div>
            )}
          </dl>
          {mark.late && (
            <p className="emptyday" data-testid="late-note">
              {t("year.card.lateNote")}
            </p>
          )}
        </>
      ) : progress ? (
        <>
          <p className="emptyday" data-testid="unfinished-note">{t("year.card.unfinishedNote", { n: toFill - cellsLeft(progress.play), total: toFill })}</p>
          {mark.today && (
            <button type="button" className="ghost" onClick={onOpenToday}>
              {t("year.continueToday")}
            </button>
          )}
        </>
      ) : mark.today ? (
        <>
          <p className="emptyday">{t("year.card.todayWaiting")}</p>
          <button type="button" className="ghost" onClick={onOpenToday}>
            {t("year.openToday")}
          </button>
        </>
      ) : (
        <p className="emptyday">
          {mark.kind === "missed" ? t("year.card.notPlayed") : mark.date > ctx.today ? t("year.card.future") : t("year.card.before")}
        </p>
      )}
    </div>
  );
}
