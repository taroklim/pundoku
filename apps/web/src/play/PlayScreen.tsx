import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { HelpBlockId } from "../help/blocks";
import { ActionSheet } from "../recovery/ActionSheet";
import { useDeferredFocus } from "../shell/afterPaint";
import { swallowGhostClick } from "../shell/ghostClick";
import { TabHeader } from "../shell/TabHeader";
import { localDate } from "../today/dayResolver";
import { Board } from "./Board";
import {
  GamePad,
  StatusLine,
  handleGameKey,
  prefersReducedMotion,
  useBlotAnnouncement,
  useCellsLeftAnnouncement,
  useClearEffectsOnUnmount,
  useClock,
  useHintAnnouncement,
} from "./controls";
import { formatDay } from "./format";
import { HintButton } from "./HintButton";
import { HintDock, HINT_DOCK_ID } from "./HintDock";
import { HintRuleSheet, boldParts } from "./HintRuleSheet";
import { useHintLadder } from "./hintStore";
import { cellsLeft, isGridFull } from "./logic";
import { PlaySetup } from "./PlaySetup";
import { ResultCard } from "./ResultCard";
import { playStore } from "./store";
import { Subline } from "./Subline";

/**
 * Экран Play (PD-11): подпись дня с тихим таймером → поле B Boxes → строка статуса «N cells left»
 * → панель 1–9 в один ряд с остатками → Notes / Undo / Erase. Партия локальная, на движке.
 * PD-74: партия начинается шагом «New puzzle» (сложность / Ink mode / Start); в чернилах панель без Undo.
 * PD-116: партия переживает перезагрузку (`store.ts`); сложность меняется только явной кнопкой «New puzzle» в
 * тулбаре — при наличии ходов за шитом подтверждения «Discard current puzzle?», затем шаг выбора.
 */
export function PlayScreen({ onOpenSettings, onOpenHelp }: { onOpenSettings?: () => void; onOpenHelp?: (block: HelpBlockId) => void } = {}) {
  const { t, i18n } = useTranslation();
  const snap = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
  const clock = useClock(playStore);
  const { phase, play, difficulty } = snap;
  // PD-139: лесенка подсказок. В Ink и до старта партии её нет (`hintAllowed`); ушли с вкладки — подсветки снимаются.
  const { ladder, state: hint } = useHintLadder(playStore);

  useEffect(() => {
    playStore.ensureStarted();
    playStore.setTabActive(true);
    return () => playStore.setTabActive(false);
  }, []);

  // QA PD-23, Low 1: возврат на вкладку не должен заново проигрывать стухшие M1/M3.
  useClearEffectsOnUnmount(playStore);

  // «Решено»: сначала данные гаснут до 60 % (240 мс), затем карточка (финал V2, PD-89); тап прерывает паузу.
  const [cardShown, setCardShown] = useState(false);
  useEffect(() => {
    if (phase !== "solved") {
      setCardShown(false);
      return;
    }
    // Карточка уже показана (по таймеру или тапом) — дальше обычные тапы, без перехвата хвоста (PD-94).
    let shown = false;
    const show = () => {
      shown = true;
      setCardShown(true);
    };
    // Тап-прерывание: хвост этого касания (click над новой карточкой) гасим — иначе тап в позиции «New game» запускал её.
    const onTap = (e: Event) => {
      if (shown) return;
      show();
      swallowGhostClick(e);
    };
    const id = window.setTimeout(show, prefersReducedMotion() ? 140 : 240);
    document.addEventListener("pointerdown", onTap, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onTap, true);
    };
  }, [phase]);

  // Фокус на карточку (a11y) — после кадра, а не в задаче монтажа: focus() сразу после записи форсирует style+layout (PD-95).
  const cardRef = useRef<HTMLElement>(null);
  useDeferredFocus(cardRef, cardShown);

  const locale = i18n.resolvedLanguage ?? "en";
  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  // PD-117a: заполнена, но не решена — честная фраза вместо «0 cells left» и без счёта неверных клеток.
  const full = interactive && play !== null && isGridFull(play);
  const cellsAnnouncement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime(), full);
  const blotAnnouncement = useBlotAnnouncement(snap);
  const hintAnnouncement = useHintAnnouncement(snap.hint);
  // Клякса и отклик на отказ (PD-117b) вытесняют «N cells left» на время озвучивания (один live-регион — фразы не перебивают друг друга).
  const announcement = blotAnnouncement || hintAnnouncement || cellsAnnouncement;

  // «New puzzle» (PD-116): с ходами — сначала подтверждение (шит), без ходов и после решения — сразу к выбору.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (phase !== "playing") setConfirming(false);
  }, [phase]);
  // PD-139: подсказка — тоже «потраченное»: партия с взятой подсказкой не сбрасывается молча.
  const hasMoves = phase === "playing" && play !== null && (play.log.length > 0 || (snap.hints ?? 0) > 0);
  const onNewPuzzle = () => {
    if (hasMoves) setConfirming(true);
    else playStore.toSetup();
  };

  // Подпись дня не пересчитывается на каждый тик часов/кадр финала: Intl.DateTimeFormat на каждый рендер дорог при CPU 4x (PD-95).
  const startedMs = snap.startedOn.getTime();
  const dayLabel = useMemo(() => formatDay(new Date(startedMs), locale), [startedMs, locale]);
  const diffLabel = t(`difficulty.${difficulty}`);
  const showClock = phase === "playing" || phase === "solved";
  const ink = play?.ink === true;

  return (
    <div className="play" onKeyDown={(e) => handleGameKey(e, playStore, ladder)}>
      {/* Live-регион для скринридера: «N cells left» только на порогах (см. хук выше). */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <TabHeader
        title={<h1 className="title">{t("tabs.play")}</h1>}
        onOpenSettings={onOpenSettings}
        actions={
          !snap.setup &&
          !snap.restoring && (
            <>
              <button type="button" className="newpuzzle-btn" onClick={onNewPuzzle} data-testid="new-puzzle">
                {t("play.newPuzzle")}
              </button>
              {playStore.hintAllowed() && <HintButton open={hint.open} used={snap.hints ?? 0} play onPress={() => ladder.toggle()} controls={HINT_DOCK_ID} />}
            </>
          )
        }
      />
      {snap.setup ? (
        snap.restoring ? null : <p className="subline">{t("ink.playSub")}</p>
      ) : (
        <Subline day={dayLabel} difficulty={diffLabel} ink={ink} clock={showClock ? clock : null} />
      )}

      {snap.setup && snap.restoring ? null : snap.setup ? (
        <PlaySetup
          difficulty={difficulty}
          ink={snap.inkNext}
          onDifficulty={(d) => playStore.setDifficulty(d)}
          onInk={(on) => playStore.setInkNext(on)}
          onStart={() => playStore.start()}
        />
      ) : phase === "solved" && cardShown ? (
        play && (
          <ResultCard
            play={play}
            cardRef={cardRef}
            title={t("solved.title")}
            timelapse={{ date: localDate(snap.startedOn), difficulty }}
            onOpenHelp={onOpenHelp}
          >
            {/* ПРОВИЗОРНО (PD-11): «New game» — минимум, чтобы из «решено» можно было выйти; в макете нет. */}
            <button type="button" className="newgame" onClick={() => playStore.toSetup()}>
              {t("solved.newGame")}
            </button>
          </ResultCard>
        )
      ) : (
        <>
          <Board snap={snap} store={playStore} dim={phase === "solved"} hintMarks={hint.marks} />

          {/* Свободное место — МЕЖДУ полем и панелью (макет, находка 1); в зазоре — статус. */}
          <div className="gap">
            {phase === "loading" && (
              <p className="status" role="status">
                {t("play.preparing")}
              </p>
            )}
            {phase === "error" && (
              <p className="status" role="alert">
                {t("play.failed")}{" "}
                <button type="button" className="link" onClick={() => playStore.newGame()}>
                  {t("play.retry")}
                </button>
              </p>
            )}
            {/* Пока док открыт, строка «N cells left» скрыта: сообщение на экране одно (макет PD-133 §4). */}
            {(phase === "playing" || phase === "solved") && !hint.open && (hint.nudge ? (
              <p className="status nudge" data-testid="hint-nudge">
                {boldParts(t("hint.nudge"))}
              </p>
            ) : (
              <StatusLine left={left} full={full} hint={snap.hint} />
            ))}
          </div>

          {hint.open ? <HintDock ladder={ladder} state={hint} play /> : <GamePad snap={snap} store={playStore} />}
        </>
      )}
      {hint.rule && <HintRuleSheet onGo={() => ladder.confirmRule()} onCancel={() => ladder.dismissRule()} />}
      {confirming && (
        <ActionSheet
          title={t("play.discardTitle")}
          message={t("play.discardMessage")}
          actionLabel={t("play.discard")}
          destructive
          cancelLabel={t("play.keepPlaying")}
          onAction={() => {
            setConfirming(false);
            playStore.toSetup();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
