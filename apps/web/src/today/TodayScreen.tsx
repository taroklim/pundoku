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
import { dayStore } from "./dayStore";
import { MiniBoard } from "./MiniBoard";
import { hiddenSolution } from "./permanent";
import { useSolveSequence } from "./useSolveSequence";

/** `YYYY-MM-DD` → локальная полночь этой даты (без сдвига часовых поясов). */
function dateOf(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/**
 * Экран Today (PD-12): подпись дня «Wed 29 Sep · Medium · 4:12» → поле B → статус и источник →
 * панель 1–9. После решения — карточка дня («Your path»: heatmap, время, техника, win rate) и
 * Grid ∞ с посадкой последней клетки дня (M5). Источник сетки — `DayStore`: API либо фолбэк.
 */
export function TodayScreen() {
  const { t, i18n } = useTranslation();
  const snap = useSyncExternalStore(dayStore.subscribe, dayStore.getSnapshot);
  const clock = useClock(dayStore);
  const root = useRef<HTMLDivElement>(null);
  const { phase, play, difficulty } = snap;

  useEffect(() => {
    dayStore.ensureStarted();
    dayStore.setTabActive(true);
    return () => dayStore.setTabActive(false);
  }, []);
  // QA PD-23, Low 1: возврат на вкладку не проигрывает стухшие M1/M3.
  useClearEffectsOnUnmount(dayStore);

  const { cardShown, flown } = useSolveSequence(phase, dayStore, root);

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (cardShown && phase === "solved") cardRef.current?.focus({ preventScroll: true });
  }, [cardShown, phase]);

  const locale = i18n.resolvedLanguage ?? "en";
  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  const announcement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime());

  const dayLabel = formatDay(dateOf(snap.date), locale);
  const showClock = phase === "playing" || (phase === "solved" && !cardShown);
  const diffLabel = snap.difficultyKnown && phase !== "loading" ? t(`difficulty.${difficulty}`) : null;

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
    <div ref={root} className="play today" onKeyDown={(e) => handleGameKey(e, dayStore)}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <header className="toolbar">
        <h1 className="title">{t("tabs.today")}</h1>
      </header>
      {/* TODO(PD-12 → дизайн): шестерёнка настроек из макета — экрана настроек нет, значок не рисуем. */}
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
            <ResultCard play={play} cardRef={cardRef} title={t("today.cardTitle")} winRate={winRate}>
              {sourceLabel && <p className="source">{sourceLabel}</p>}
            </ResultCard>
          )}
          {gridView && (
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
          <Board snap={snap} store={dayStore} dim={phase === "solved"} />

          {/* Свободное место — МЕЖДУ полем и панелью (макет, находка 1); в зазоре — статус. */}
          <div className="gap">
            {phase === "loading" && (
              <p className="status" role="status">
                {t("today.loading")}
              </p>
            )}
            {phase === "error" && (
              <p className="status" role="alert">
                {t("today.failed")}{" "}
                <button type="button" className="link" onClick={() => void dayStore.load()}>
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

          <GamePad snap={snap} store={dayStore} />
        </>
      )}
    </div>
  );
}
