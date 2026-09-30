import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES } from "@pundoku/engine";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Board } from "./Board";
import {
  GamePad,
  handleGameKey,
  prefersReducedMotion,
  useBlotAnnouncement,
  useCellsLeftAnnouncement,
  useClearEffectsOnUnmount,
  useClock,
} from "./controls";
import { formatDay } from "./format";
import { cellsLeft } from "./logic";
import { PlaySetup } from "./PlaySetup";
import { ResultCard } from "./ResultCard";
import { playStore } from "./store";
import { Subline } from "./Subline";

/**
 * Экран Play (PD-11): подпись дня с тихим таймером → поле B Boxes → строка статуса «N cells left»
 * → панель 1–9 в один ряд с остатками → Notes / Undo / Erase. Партия локальная, на движке.
 * PD-74: партия начинается шагом «New puzzle» (сложность / Ink mode / Start); в чернилах панель без Undo.
 */
export function PlayScreen() {
  const { t, i18n } = useTranslation();
  const snap = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
  const clock = useClock(playStore);
  const { phase, play, difficulty } = snap;

  useEffect(() => {
    playStore.ensureStarted();
    playStore.setTabActive(true);
    return () => playStore.setTabActive(false);
  }, []);

  // QA PD-23, Low 1: возврат на вкладку не должен заново проигрывать стухшие M1/M3.
  useClearEffectsOnUnmount(playStore);

  // «Решено»: сначала данные гаснут до 60 % (240 мс), затем карточка (см. макет, M5-прелюдия).
  const [cardShown, setCardShown] = useState(false);
  useEffect(() => {
    if (phase !== "solved") {
      setCardShown(false);
      return;
    }
    const id = window.setTimeout(() => setCardShown(true), prefersReducedMotion() ? 140 : 240);
    return () => window.clearTimeout(id);
  }, [phase]);

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (cardShown) cardRef.current?.focus({ preventScroll: true });
  }, [cardShown]);

  const locale = i18n.resolvedLanguage ?? "en";
  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  const cellsAnnouncement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime());
  const blotAnnouncement = useBlotAnnouncement(snap);
  // Клякса вытесняет «N cells left» на время озвучивания (один live-регион — фразы не перебивают друг друга).
  const announcement = blotAnnouncement || cellsAnnouncement;

  // Посреди партии смена сложности начинает новую — через шаг «New puzzle»: режим каждый раз выбирают заново.
  const onDifficulty = (e: ChangeEvent<HTMLSelectElement>) => {
    playStore.toSetup(e.target.value as Difficulty);
  };

  const dayLabel = formatDay(snap.startedOn, locale);
  const diffLabel = t(`difficulty.${difficulty}`);
  const showClock = phase === "playing" || phase === "solved";
  const ink = play?.ink === true;

  return (
    <div className="play" onKeyDown={(e) => handleGameKey(e, playStore)}>
      {/* Live-регион для скринридера: «N cells left» только на порогах (см. хук выше). */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <header className="toolbar">
        <h1 className="title">{t("tabs.play")}</h1>
        {/* ПРОВИЗОРНО (PD-11): выбор сложности — минимальный нативный контрол, которого нет в
            утверждённом макете; владелец его не утверждал. Смена сложности начинает новую партию. */}
        {!snap.setup && (
          <select
            className="difficulty"
            aria-label={t("play.difficulty")}
            value={difficulty}
            onChange={onDifficulty}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t(`difficulty.${d}`)}
              </option>
            ))}
          </select>
        )}
      </header>
      {snap.setup ? (
        <p className="subline">{t("ink.playSub")}</p>
      ) : (
        <Subline day={dayLabel} difficulty={diffLabel} ink={ink} clock={showClock ? clock : null} />
      )}

      {snap.setup ? (
        <PlaySetup
          difficulty={difficulty}
          ink={snap.inkNext}
          onDifficulty={(d) => playStore.setDifficulty(d)}
          onInk={(on) => playStore.setInkNext(on)}
          onStart={() => playStore.start()}
        />
      ) : phase === "solved" && cardShown ? (
        play && (
          <ResultCard play={play} cardRef={cardRef} title={t("solved.title")}>
            {/* ПРОВИЗОРНО (PD-11): «New game» — минимум, чтобы из «решено» можно было выйти; в макете нет. */}
            <button type="button" className="newgame" onClick={() => playStore.toSetup()}>
              {t("solved.newGame")}
            </button>
          </ResultCard>
        )
      ) : (
        <>
          <Board snap={snap} store={playStore} dim={phase === "solved"} />

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
            {(phase === "playing" || phase === "solved") && (
              <p className="status">{t("play.cellsLeft", { count: left })}</p>
            )}
          </div>

          <GamePad snap={snap} store={playStore} />
        </>
      )}
    </div>
  );
}
