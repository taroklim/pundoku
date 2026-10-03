import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { HelpBlockId } from "../help/blocks";
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
import { HintButton } from "./HintButton";
import { HintDock, HINT_DOCK_ID } from "./HintDock";
import { HintRuleSheet, boldParts } from "./HintRuleSheet";
import { useHintLadder } from "./hintStore";
import { canFill, cellsLeft, isGridFull } from "./logic";
import { MoreMenu } from "./MoreMenu";
import { PlaySetup } from "./PlaySetup";
import { ResultCard } from "./ResultCard";
import { playStore } from "./store";
import { Subline } from "./Subline";

/**
 * Экран Play (PD-11). PD-144 (вариант C): вкладка открывается ХАБОМ (`PlaySetup`: «Продолжить» / сложность / «Режим» /
 * «Начать»), партию запускает игрок. Партия — нескроллящийся экран (`.play-fit`): подпись → поле B Boxes → строка статуса
 * «N cells left» → панель 1–9 → Notes / Undo / Erase; обвязка `flex:none`, уступает только поле. Шапка партии:
 * лампочка · шестерёнка · «⋯» (меню «Новая сетка» / «Заполнить кандидатами»). Решённая партия — карточка результата
 * с одной кнопкой «Новая сетка». PD-116: партия переживает перезагрузку (`store.ts`); после неё всегда хаб, а идущая
 * своя сетка — слот «Продолжить». Возврат на хаб подтверждения не требует: партия не выбрасывается, а встаёт на паузу.
 */
export function PlayScreen({ onOpenSettings, onOpenHelp, onOpenToday }: { onOpenSettings?: () => void; onOpenHelp?: (block: HelpBlockId) => void; onOpenToday?: () => void } = {}) {
  const { t } = useTranslation();
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

  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  // PD-117a: заполнена, но не решена — честная фраза вместо «0 cells left» и без счёта неверных клеток.
  const full = interactive && play !== null && isGridFull(play);
  const cellsAnnouncement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime(), full);
  const blotAnnouncement = useBlotAnnouncement(snap);
  const hintAnnouncement = useHintAnnouncement(snap.hint);
  // Клякса и отклик на отказ (PD-117b) вытесняют «N cells left» на время озвучивания (один live-регион — фразы не перебивают друг друга).
  const announcement = blotAnnouncement || hintAnnouncement || cellsAnnouncement;

  // Фокус при смене хаб ↔ партия: кнопка, на которой он стоял («Новая сетка» в меню, строка «Продолжить»), исчезла вместе со
  // старым экраном — фокус на заголовок вкладки, а не на <body> (VoiceOver/клавиатура не теряют место). Если фокус уже
  // на живом элементе (повторный тап по вкладке), не трогаем.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wasHub = useRef(snap.hub);
  useEffect(() => {
    if (wasHub.current !== snap.hub && (!document.activeElement || document.activeElement === document.body)) titleRef.current?.focus({ preventScroll: true });
    wasHub.current = snap.hub;
  }, [snap.hub]);

  // Подпись партии — «Сложность · время» БЕЗ даты (макет PD-144): у своей сетки нет «дня», а дата удлиняла строку так, что
  // на 320 pt при AX3 она переносилась и съедала резерв `--chrome` (он рассчитан на одну строку).
  const diffLabel = t(`difficulty.${difficulty}`);
  const showClock = phase === "playing" || phase === "solved";
  const ink = play?.ink === true;

  const hub = snap.hub;
  const restoring = snap.restoring === true;
  const cardView = !hub && phase === "solved" && cardShown;
  const fillState = ink ? "ink" : play && canFill(play) ? "ready" : "empty";
  const own = playStore.hasSlot() && play ? { difficulty, left: cellsLeft(play), elapsedMs: playStore.getElapsedMs(), ink } : null;
  const showLamp = !hub && !restoring && playStore.hintAllowed();
  const showMore = !hub && !restoring && phase !== "solved";

  // PD-144 (D-1): место под док подсказки отложено постоянно, пока подсказки возможны (партия не в Ink): поле не зависит от дока.
  // До загрузки партии `play` нет — режим берётся из выбора на хабе, чтобы поле не прыгало при появлении партии.
  const hintable = !hub && !(play ? ink : snap.inkNext);
  const fitClass = hub ? " play-hub" : cardView ? "" : ` play-fit${hintable ? " play-hintable" : ""}${hint.open ? " play-docked" : ""}`;

  return (
    <div className={`play${fitClass}`} onKeyDown={hub ? undefined : (e) => handleGameKey(e, playStore, ladder)}>
      {/* Live-регион для скринридера: «N cells left» только на порогах (см. хук выше). */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <TabHeader
        title={
          <h1 ref={titleRef} className="title" tabIndex={-1}>
            {t("tabs.play")}
          </h1>
        }
        onOpenSettings={onOpenSettings}
        actions={showLamp && <HintButton open={hint.open} used={snap.hints ?? 0} play onPress={() => ladder.toggle()} controls={HINT_DOCK_ID} />}
        trailing={showMore && <MoreMenu fill={fillState} onNew={() => playStore.toHub()} onFill={() => playStore.fillCandidates()} />}
      />
      {restoring ? null : hub ? (
        <PlaySetup
          pick={snap.pick}
          ink={snap.inkNext}
          own={own}
          reselect={snap.reselect}
          onPick={(d) => playStore.setDifficulty(d)}
          onInk={(on) => playStore.setInkNext(on)}
          onStart={() => playStore.start()}
          onResume={() => playStore.resume()}
          onOpenToday={() => onOpenToday?.()}
        />
      ) : (
        <>
          <Subline day="" difficulty={diffLabel} inkChip={ink} help={snap.assisted === true} clock={showClock ? clock : null} />
          {cardView ? (
            play && (
              <ResultCard play={play} cardRef={cardRef} title={t("solved.title")} timelapse={{ date: localDate(snap.startedOn), difficulty }} hints={snap.hints} onOpenHelp={onOpenHelp}>
                {/* PD-144: единственная кнопка нового пазла на экране (шапка на решённой партии действий не несёт). */}
                <button type="button" className="btn-plain newgrid" onClick={() => playStore.toHub()} data-testid="new-puzzle">
                  {t("play.newPuzzle")}
                </button>
              </ResultCard>
            )
          ) : (
            <>
              <Board snap={snap} store={playStore} dim={phase === "solved"} hintMarks={hint.marks} />

              {/* Свободное место — МЕЖДУ полем и панелью (макет, находка 1); в зазоре — статус. Гибкий — только он (и поле). */}
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
        </>
      )}
      {hint.rule && <HintRuleSheet play onGo={() => ladder.confirmRule()} onCancel={() => ladder.dismissRule()} />}
    </div>
  );
}
