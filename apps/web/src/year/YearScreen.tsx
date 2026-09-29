import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DayProgress } from "../today/repository";
import { monthName } from "./format";
import { markClass, monthAriaLabel } from "./labels";
import type { YearEntry } from "./model";
import { availableYears, buildYear, entryFromProgress, startDate, yearOfDate } from "./model";
import type { SheetState } from "./YearSheet";
import { SHEET_MS, YearSheet } from "./YearSheet";

export interface YearScreenProps {
  /** Прогресс всех дней из `ProgressRepository`; `null` — ещё загружается. */
  days: readonly DayProgress[] | null;
  /** Дата первого запуска (`year/firstUse.ts`); `null` — неизвестна. */
  firstUse: string | null;
  /** Локальная сегодняшняя дата `YYYY-MM-DD`. */
  today: string;
  /** «Open today's puzzle» / «Continue» — переключить вкладку на Today. */
  onOpenToday: () => void;
}

const MONTH_SLOTS = 35; // 7 × 5: дни месяца идут подряд, без привязки к дням недели (ритма недели в продукте нет)

/**
 * Экран Year (PD-25) — раскладка C Blocks: 12 карточек-месяцев 3×4, месяц — цель тапа (день в полотне НЕ кнопка);
 * тап по месяцу → шит месяца с клетками ~46 pt → тап по дню → карточка дня (вторая страница шита).
 * Формы и цвет меток — `year/model.ts` и `styles/year.css`. Никаких серий и процентов: только нейтральные итоги.
 */
export function YearScreen({ days, firstUse, today, onOpenToday }: YearScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const root = useRef<HTMLDivElement>(null);

  const { entries, progress } = useMemo(() => {
    const entries = new Map<string, YearEntry>();
    const progress = new Map<string, DayProgress>();
    for (const p of days ?? []) {
      const e = entryFromProgress(p);
      if (!e) continue;
      entries.set(p.date, e);
      progress.set(p.date, p);
    }
    return { entries, progress };
  }, [days]);

  const ctx = useMemo(() => ({ today, start: startDate(firstUse, entries, today) }), [today, firstUse, entries]);
  const years = useMemo(() => availableYears(entries, ctx), [entries, ctx]);
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked !== null && years.includes(picked) ? picked : yearOfDate(today);
  const view = useMemo(() => buildYear(year, entries, ctx), [year, entries, ctx]);
  const empty = days !== null && entries.size === 0;

  // ---- шит месяца / дня ----
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const trigger = useRef<string | null>(null);
  const openMonth = (m: number) => {
    trigger.current = String(m);
    setSheet({ month: m, date: null, closing: false });
  };
  const closeSheet = useCallback(() => setSheet((s) => (s && !s.closing ? { ...s, closing: true } : s)), []);
  const closing = sheet?.closing === true;
  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(() => {
      setSheet(null);
      // Фокус возвращается на месяц, из которого открыли шит.
      root.current?.querySelector<HTMLElement>(`[data-month="${trigger.current}"]`)?.focus({ preventScroll: true });
    }, SHEET_MS);
    return () => window.clearTimeout(id);
  }, [closing]);
  // Смена года при открытом шите невозможна (фон inert), но данные могли обновиться — шит на месяц не переоткрываем.

  const title = (
    <>
      <span className="sr-only">{t("tabs.year")} </span>
      {year}
    </>
  );

  return (
    <div className="year" ref={root} data-testid="year-screen" data-empty={empty ? "true" : "false"}>
      <header className="toolbar">
        {years.length > 1 ? (
          <YearPicker year={year} years={years} onPick={setPicked} />
        ) : (
          <h1 className="title" data-testid="year-title">
            {title}
          </h1>
        )}
      </header>
      <p className="subline year-totals" aria-hidden={empty ? "true" : undefined} data-testid="year-totals">
        {[
          t("year.totalsDays", { count: view.totals.played }),
          t("year.totalsClean", { n: view.totals.clean }),
          view.totals.withCorrections > 0 ? t("year.totalsCorrections", { n: view.totals.withCorrections }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div className="year-months" role="group" aria-label={t("year.canvasLabel", { year })} data-testid="year-canvas">
        {view.months.map((m) => (
          <button
            key={m.index}
            type="button"
            className="year-month"
            data-month={m.index}
            aria-label={monthAriaLabel(t, m, locale)}
            onClick={() => openMonth(m.index)}
          >
            <span className="mlab" aria-hidden="true">
              {monthName(m.index, locale, "short")}
            </span>
            <span className="mgrid" aria-hidden="true">
              {m.days.map((d) => (
                <i key={d.date} className={markClass(d)} data-date={d.date} />
              ))}
              {Array.from({ length: MONTH_SLOTS - m.days.length }, (_, i) => (
                <i key={`p${i}`} className="ymark is-void" />
              ))}
            </span>
          </button>
        ))}
      </div>

      {empty ? (
        <div className="year-empty" data-testid="year-empty">
          <p>{t("year.emptyLine")}</p>
          <button type="button" className="cta" onClick={onOpenToday}>
            {t("year.openToday")}
          </button>
        </div>
      ) : (
        <ul className="year-legend" aria-label={t("year.legendLabel")}>
          <li>
            <i className="ymark is-solved" aria-hidden="true" />
            {t("year.legend.solved")}
          </li>
          <li>
            <i className="ymark is-solved has-help" aria-hidden="true" />
            {t("year.legend.help")}
          </li>
          <li>
            <i className="ymark is-solved has-corr" aria-hidden="true" />
            {t("year.legend.corrections")}
          </li>
          <li>
            <i className="ymark is-unfinished" aria-hidden="true" />
            {t("year.legend.unfinished")}
          </li>
          <li>
            <i className="ymark is-missed" aria-hidden="true" />
            {t("year.legend.missed")}
          </li>
        </ul>
      )}

      {sheet && (
        <YearSheet
          year={year}
          month={view.months[sheet.month]!}
          date={sheet.date}
          closing={sheet.closing}
          ctx={ctx}
          progress={progress}
          onOpenDay={(date) => setSheet((s) => (s ? { ...s, date } : s))}
          onBack={() => setSheet((s) => (s ? { ...s, date: null } : s))}
          onClose={closeSheet}
          onOpenToday={() => {
            setSheet(null);
            onOpenToday();
          }}
        />
      )}
    </div>
  );
}

/** Год в заголовке с шевроном — pull-down в тулбаре (не вкладка: вкладки навигируют, а не действуют). Только если лет больше одного. */
function YearPicker({ year, years, onPick }: { year: number; years: number[]; onPick: (y: number) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="year-picker" ref={wrap} onKeyDown={onKeyDown}>
      <h1 className="title-h">
        <button
          ref={button}
          type="button"
          className="titlebtn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("year.chooseYear", { year })}
          onClick={() => setOpen((o) => !o)}
          data-testid="year-title"
        >
          <span className="title">{year}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h1>
      {open && (
        <div className="year-menu" role="menu" aria-label={t("year.yearMenu")}>
          {[...years].reverse().map((y) => (
            <button
              key={y}
              type="button"
              role="menuitemradio"
              aria-checked={y === year}
              tabIndex={y === year ? 0 : -1}
              onClick={() => {
                onPick(y);
                close();
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
