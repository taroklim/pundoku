import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Board } from "../play/Board";
import {
  GamePad,
  StatusLine,
  handleGameKey,
  useBlotAnnouncement,
  useCellsLeftAnnouncement,
  useClearEffectsOnUnmount,
  useClock,
  useHintAnnouncement,
} from "../play/controls";
import { formatDay } from "../play/format";
import { HintButton } from "../play/HintButton";
import { HintDock, HINT_DOCK_ID } from "../play/HintDock";
import { HintRuleSheet, boldParts } from "../play/HintRuleSheet";
import { useHintLadder } from "../play/hintStore";
import { InkEntry } from "../play/InkEntry";
import type { HelpBlockId } from "../help/blocks";
import { cellsLeft, isGridFull } from "../play/logic";
import { ResultCard } from "../play/ResultCard";
import { Subline } from "../play/Subline";
import { useDeferredFocus } from "../shell/afterPaint";
import { TabHeader } from "../shell/TabHeader";
import type { DayStore } from "./dayStore";
import { dayStore } from "./dayStore";
import { MiniBoard } from "./MiniBoard";
import { hiddenSolution } from "./permanent";
import { useSolveSequence } from "./useSolveSequence";
import { LateSign } from "../year/LateSign";

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
export function TodayScreen({ onOpenSettings, onOpenHelp }: { onOpenSettings?: () => void; onOpenHelp?: (block: HelpBlockId) => void } = {}) {
  return <DayView store={dayStore} onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />;
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
export function DayView({ store, archive, onOpenSettings, onOpenHelp }: { store: DayStore; archive?: ArchiveProps; onOpenSettings?: () => void; onOpenHelp?: (block: HelpBlockId) => void }) {
  const { t, i18n } = useTranslation();
  const rawSnap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Архив: стор мог ещё держать другую дату (первый кадр до эффекта) — показываем «загрузку», а не чужую партию.
  const stale = archive !== undefined && rawSnap.date !== archive.date;
  const snap = stale ? { ...rawSnap, phase: "loading" as const, play: null, unavailable: false } : rawSnap;
  const clock = useClock(store);
  // PD-139: лесенка подсказок — Today и архив (late разрешён); в Ink и на Grid ∞ её нет. Шит правила не нужен, если на устройстве уже были дни «с помощью».
  const { ladder, state: hint } = useHintLadder(store, { assistedBefore: () => store.anyAssisted() });
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

  const { cardShown, gridShown, finaleDone, flown } = useSolveSequence(phase, store, root);

  // Фокус на карточку (a11y) — после конца финала и после кадра, не посреди анимации и не в задаче монтажа (PD-95).
  const cardRef = useRef<HTMLElement>(null);
  useDeferredFocus(cardRef, cardShown && finaleDone && phase === "solved");

  const locale = i18n.resolvedLanguage ?? "en";
  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  // PD-117a: сетка заполнена, но не решена — вместо «0 cells left» честная фраза без числа неверных клеток.
  const full = interactive && play !== null && isGridFull(play);
  const cellsAnnouncement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime(), full);
  const blotAnnouncement = useBlotAnnouncement(snap);
  const hintAnnouncement = useHintAnnouncement(snap.hint);
  // Клякса (PD-74) и отклик на отказ (PD-117b) вытесняют «N cells left» на время озвучивания — один live-регион.
  const announcement = blotAnnouncement || hintAnnouncement || cellsAnnouncement;
  // Чернильный режим (PD-74): строка входа в зазоре — только до первого хода и не в архиве (там ink запрещён).
  // Пока показан отклик на отказ (PD-117b), на его 2,6 с вместо строки входа стоит строка статуса.
  const inkEntry = interactive && store.inkChoosable() && !snap.hint && !hint.open && !hint.nudge;
  const hintButton = store.hintAllowed() ? <HintButton open={hint.open} used={snap.hints ?? 0} onPress={() => ladder.toggle()} controls={HINT_DOCK_ID} /> : null;

  // Не на каждый тик часов/кадр финала: Intl.DateTimeFormat на каждый рендер дорог при CPU 4x (PD-95).
  const dayLabel = useMemo(() => (isRealDate(snap.date) ? formatDay(dateOf(snap.date), locale) : ""), [snap.date, locale]);
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

  // PD-117b: тап по Grid ∞ (он не играбельный) — тихая строка-пояснение вместо молчания, на 4 с.
  const [gridTapped, setGridTapped] = useState(false);
  useEffect(() => {
    if (!gridTapped) return;
    const id = window.setTimeout(() => setGridTapped(false), 4000);
    return () => window.clearTimeout(id);
  }, [gridTapped]);

  const sourceLabel = snap.source === null ? null : t(`today.source.${snap.source}`);
  const winRate = snap.serverVerified === false ? null : snap.winRate;

  return (
    <div ref={root} className={`play today${archive ? " archive" : ""}`} onKeyDown={(e) => handleGameKey(e, store, ladder)} data-testid={archive ? "archive-screen" : undefined} data-date={archive ? archive.date : undefined}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {archive ? (
        <header className="toolbar toolbar-archive">
          <button type="button" className="archive-back" onClick={archive.onBack} aria-label={t("archive.backLabel")} data-testid="archive-back">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
            <span>{t("tabs.year")}</span>
          </button>
          <h1 className="title">{t("archive.title")}</h1>
          {hintButton}
        </header>
      ) : (
        // Шестерёнка (PD-49/PD-123): действие шапки вкладки, а не четвёртая вкладка; ведёт на `#/settings`.
        <TabHeader title={<h1 className="title">{t("tabs.today")}</h1>} actions={hintButton} onOpenSettings={onOpenSettings} />
      )}
      <Subline day={dayLabel} difficulty={diffLabel} ink={play?.ink === true} clock={showClock ? clock : null} />

      {phase === "solved" && cardShown ? (
        <>
          {play && (
            <ResultCard play={play} cardRef={cardRef} title={t("today.cardTitle")} winRate={winRate} winRateScope={archive || snap.late ? "day" : "today"} timelapse={isRealDate(snap.date) ? { date: snap.date, difficulty: snap.difficultyKnown ? difficulty : null } : undefined} onOpenHelp={onOpenHelp}>
              {sourceLabel && <p className="source">{sourceLabel}</p>}
              {snap.late && (
                <p className="source late-line" data-testid="late-note">
                  <LateSign />
                  {t("year.card.lateNote")}
                </p>
              )}
            </ResultCard>
          )}
          {!archive && gridShown && gridView && (
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
                onTap={() => setGridTapped(true)}
                label={t("today.gridLabel", {
                  count: gridView.clues.size,
                  state: t(snap.permanentSolvable && !pending ? "today.gridSolvable" : "today.gridNotSolvable"),
                })}
              />
              {gridView.todayCell !== null && (
                <p className="hint" role="status" data-testid="grid-hint">
                  <span className="chip" aria-hidden="true" />
                  {t(gridTapped ? "today.gridTap" : "today.gridHint")}
                </p>
              )}
              {/* PD-120: что такое эта сетка и почему «needs more clues» — без языка решателя; подробнее — в справке. */}
              <p className="hint grid-explain" data-testid="grid-explain">
                {t("today.gridExplain")}
                {onOpenHelp && (
                  <button type="button" className="help-link" onClick={() => onOpenHelp("grid")} aria-label={`${t("help.whatsThis")} ${t("today.gridTitle")}`} data-testid="grid-help">
                    {t("help.whatsThis")}
                  </button>
                )}
              </p>
            </section>
          )}
        </>
      ) : (
        <>
          {!unavailable && <Board snap={snap} store={store} dim={phase === "solved"} hintMarks={hint.marks} />}

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
            {inkEntry && <InkEntry on={play?.ink === true} setOn={(on) => store.setInk(on)} />}
            {!inkEntry && !hint.open && (phase === "playing" || phase === "solved") && (
              <div className="today-status">
                {hint.nudge ? (
                  <p className="status nudge" data-testid="hint-nudge">
                    {boldParts(t("hint.nudge"))}
                  </p>
                ) : (
                  <StatusLine left={left} full={full} hint={snap.hint} />
                )}
                {sourceLabel && (
                  <p className="source" data-testid="source">
                    {sourceLabel}
                  </p>
                )}
              </div>
            )}
          </div>

          {!unavailable && (hint.open ? <HintDock ladder={ladder} state={hint} /> : <GamePad snap={snap} store={store} />)}
        </>
      )}
      {hint.rule && <HintRuleSheet onGo={() => ladder.confirmRule()} onCancel={() => ladder.dismissRule()} />}
    </div>
  );
}
