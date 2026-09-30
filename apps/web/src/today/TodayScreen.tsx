import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Board } from "../play/Board";
import {
  GamePad,
  handleGameKey,
  useCellsLeftAnnouncement,
  useClearEffectsOnUnmount,
  useClock,
} from "../play/controls";
import { formatDay } from "../play/format";
import { cellsLeft } from "../play/logic";
import { ResultCard } from "../play/ResultCard";
import type { DayStore } from "./dayStore";
import { dayStore } from "./dayStore";
import { MiniBoard } from "./MiniBoard";
import { hiddenSolution } from "./permanent";
import { useSolveSequence } from "./useSolveSequence";

/** `YYYY-MM-DD` → локальная полночь этой даты (без сдвига часовых поясов). */
function dateOf(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/** Существующая календарная дата (2026-02-30 «перекатывается» в март — такую подпись не показываем). */
function isRealDate(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = dateOf(ymd);
  return date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d;
}

/**
 * Экран Today (PD-12): подпись дня «Wed 29 Sep · Medium · 4:12» → поле B → статус и источник →
 * панель 1–9. После решения — карточка дня («Your path»: heatmap, время, техника, win rate) и
 * Grid ∞ с посадкой последней клетки дня (M5). Источник сетки — `DayStore`: API либо фолбэк.
 */
export function TodayScreen({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  return <DayView store={dayStore} onOpenSettings={onOpenSettings} />;
}

/** Архив (PD-33): режим экрана для прошлой даты — заголовок «Archive», кнопка «‹ Year», без Grid ∞. */
export interface ArchiveProps {
  /** Играемая прошлая дата `YYYY-MM-DD` (совпадает с `store.openArchive(date)`). */
  readonly date: string;
  readonly onBack: () => void;
}

/**
 * Одно поле и одна карточка результата на два экрана: сегодняшний день (`dayStore`) и архивный (`archiveStore`,
 * `archive` задан). Компонент поля/панели/карточки общие — различаются только шапка, тексты состояний и Grid ∞.
 */
export function DayView({ store, archive, onOpenSettings }: { store: DayStore; archive?: ArchiveProps; onOpenSettings?: () => void }) {
  const { t, i18n } = useTranslation();
  const rawSnap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Архив: стор мог ещё держать другую дату (первый кадр до эффекта) — показываем «загрузку», а не чужую партию.
  const stale = archive !== undefined && rawSnap.date !== archive.date;
  const snap = stale ? { ...rawSnap, phase: "loading" as const, play: null, unavailable: false } : rawSnap;
  const clock = useClock(store);
  const root = useRef<HTMLDivElement>(null);
  const { phase, play, difficulty } = snap;
  const archiveDate = archive?.date;
  // Недоступная дата (архив): ни пустого поля, ни цифровой панели — только сообщение.
  const unavailable = phase === "error" && snap.unavailable;

  useEffect(() => {
    if (archiveDate !== undefined) store.openArchive(archiveDate);
    else store.ensureStarted();
    store.setTabActive(true);
    return () => {
      store.setTabActive(false);
      if (archiveDate !== undefined) store.closeArchive();
    };
  }, [store, archiveDate]);
  // QA PD-23, Low 1: возврат на вкладку не проигрывает стухшие M1/M3.
  useClearEffectsOnUnmount(store);

  const { cardShown, flown } = useSolveSequence(phase, store, root);

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (cardShown && phase === "solved") cardRef.current?.focus({ preventScroll: true });
  }, [cardShown, phase]);

  const locale = i18n.resolvedLanguage ?? "en";
  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  const announcement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime());

  const dayLabel = isRealDate(snap.date) ? formatDay(dateOf(snap.date), locale) : "";
  const showClock = phase === "playing" || (phase === "solved" && !cardShown);
  const diffLabel = snap.difficultyKnown && phase !== "loading" && !snap.unavailable ? t(`difficulty.${difficulty}`) : null;

  // Grid ∞: клетка дня, ещё не севшая на место (идёт M5), рисуется пустой — как до решения.
  const pending = snap.landing !== null;
  const { permanent } = snap;
  const gridView = useMemo(() => {
    if (!permanent) return null;
    const sol = hiddenSolution(permanent);
    const clues = new Map<number, number>();
    for (const { cell } of permanent.cells) if (cell !== snap.landing?.cell) clues.set(cell, sol[cell] as number);
    const todayCell = snap.landing?.cell ?? permanent.cells.find((c) => c.date === snap.date)?.cell ?? null;
    return { clues, todayCell };
  }, [permanent, snap.landing, snap.date]);

  const sourceLabel = snap.source === null ? null : t(`today.source.${snap.source}`);
  const winRate = snap.serverVerified === false ? null : snap.winRate;

  return (
    <div ref={root} className={`play today${archive ? " archive" : ""}`} onKeyDown={(e) => handleGameKey(e, store)} data-testid={archive ? "archive-screen" : undefined} data-date={archive ? archive.date : undefined}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <header className={`toolbar${archive ? " toolbar-archive" : ""}`}>
        {archive && (
          <button type="button" className="archive-back" onClick={archive.onBack} aria-label={t("archive.backLabel")} data-testid="archive-back">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
            <span>{t("tabs.year")}</span>
          </button>
        )}
        <h1 className="title">{archive ? t("archive.title") : t("tabs.today")}</h1>
        {/* Шестерёнка (PD-49): действие тулбара, а не четвёртая вкладка; ведёт на `#/settings`. */}
        {!archive && onOpenSettings && (
          <button type="button" className="gear-btn" onClick={onOpenSettings} aria-label={t("settings.open")} data-testid="open-settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.4" />
              <path d="M12 2.9v2.4M12 18.7v2.4M21.1 12h-2.4M5.3 12H2.9M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3 5.6 5.6" />
            </svg>
          </button>
        )}
      </header>
      <p className="subline">
        {dayLabel}
        {diffLabel && <> · {diffLabel}</>}
        {showClock && (
          <>
            {" · "}
            <span className="clock">{clock}</span>
          </>
        )}
      </p>

      {phase === "solved" && cardShown ? (
        <>
          {play && (
            <ResultCard play={play} cardRef={cardRef} title={t("today.cardTitle")} winRate={winRate} winRateScope={archive ? "day" : "today"}>
              {sourceLabel && <p className="source">{sourceLabel}</p>}
              {archive && snap.late && (
                <p className="source" data-testid="late-note">
                  {t("year.card.lateNote")}
                </p>
              )}
            </ResultCard>
          )}
          {!archive && gridView && (
            <section aria-labelledby="grid-inf-title" data-testid="grid-inf-section">
              <div className="section-head">
                <h2 id="grid-inf-title">{t("today.gridTitle")}</h2>
                <span className="meta">
                  {t("today.gridCells", { count: gridView.clues.size })} ·{" "}
                  {t(snap.permanentSolvable && !pending ? "today.gridSolvable" : "today.gridNotSolvable")}
                </span>
              </div>
              <MiniBoard
                clues={gridView.clues}
                target={gridView.todayCell}
                landed={gridView.todayCell !== null && !pending}
                pulse={flown}
                label={t("today.gridLabel", {
                  count: gridView.clues.size,
                  state: t(snap.permanentSolvable && !pending ? "today.gridSolvable" : "today.gridNotSolvable"),
                })}
              />
              {gridView.todayCell !== null && (
                <p className="hint">
                  <span className="chip" aria-hidden="true" />
                  {t("today.gridHint")}
                </p>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          {!unavailable && <Board snap={snap} store={store} dim={phase === "solved"} />}

          {/* Свободное место — МЕЖДУ полем и панелью (макет, находка 1); в зазоре — статус. */}
          <div className="gap">
            {phase === "loading" && (
              <p className="status" role="status">
                {t(archive ? "archive.loading" : "today.loading")}
              </p>
            )}
            {unavailable && (
              <p className="status" role="alert" data-testid="archive-unavailable">
                {t("archive.unavailable")}
              </p>
            )}
            {phase === "error" && !unavailable && (
              <p className="status" role="alert">
                {t(archive ? "archive.failed" : "today.failed")}{" "}
                <button type="button" className="link" onClick={() => void store.load()}>
                  {t("play.retry")}
                </button>
              </p>
            )}
            {(phase === "playing" || phase === "solved") && (
              <div className="today-status">
                <p className="status">{t("play.cellsLeft", { count: left })}</p>
                {sourceLabel && (
                  <p className="source" data-testid="source">
                    {sourceLabel}
                  </p>
                )}
              </div>
            )}
          </div>

          {!unavailable && <GamePad snap={snap} store={store} />}
        </>
      )}
    </div>
  );
}
