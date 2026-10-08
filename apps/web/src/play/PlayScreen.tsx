import type { Difficulty } from "@pundoku/engine";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { HelpBlockId } from "../help/blocks";
import { useMelodyGame } from "../melody/game";
import { setMelodySound, useMelodySound } from "../settings/prefs";
import { useDeferredFocus } from "../shell/afterPaint";
import { swallowGhostClick } from "../shell/ghostClick";
import { useTabActive } from "../shell/tabSlide";
import { TabHeader } from "../shell/TabHeader";
import { localDate } from "../today/dayResolver";
import { AccuseMenu } from "./AccuseMenu";
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
import { fitClassName } from "./fitModel";
import { HintButton } from "./HintButton";
import { HintDock, HINT_DOCK_ID } from "./HintDock";
import { HintRuleSheet, boldParts } from "./HintRuleSheet";
import { useHintLadder } from "./hintStore";
import { accusedCells, liarHidden, liarSummaryOf } from "./liar";
import { canFill, cellsLeft, isGiven, isGridFull } from "./logic";
import { ModeSheet } from "./ModeSheet";
import type { ModeId } from "./modes";
import { availableModes, modeDef } from "./modes";
import { LanternStatus } from "./LanternStatus";
import type { LanternStatusKind } from "./LanternStatus";
import { MelodyModeIcon } from "./modeIcons";
import { MoreMenu } from "./MoreMenu";
import { PlaySetup } from "./PlaySetup";
import { ResultCard } from "./ResultCard";
import { playStore } from "./store";
import { Subline } from "./Subline";
import { WaitPanel } from "./WaitPanel";
import { useWaitView } from "./waitView";

/**
 * Экран Play (PD-11). PD-144 → PD-167 (раскладка C): вкладка открывается ХАБОМ (`PlaySetup`: «Продолжить» — день, список
 * «Режимы»), партию запускает игрок из шита режима (`ModeSheet`: описание + сложность + «Начать»). Шит открывается тапом по
 * режиму без незавершённой игры, «Новой сеткой…» контекстного меню строки, «⋯ → Новая сетка» в партии и «Новой сеткой» на
 * карточке результата — всегда для режима, к которому относится действие; при незавершённой игре режима — с предупреждением.
 * Правило необратимого режима (`ModeDef.Rule`, Ink — PD-74) показывается ПОСЛЕ шита, не поверх. Партия — нескроллящийся экран (`.play-fit`): подпись → поле B Boxes → строка статуса
 * «N cells left» → панель 1–9 → Notes / Undo / Erase; обвязка `flex:none`, уступает только поле. Шапка партии:
 * лампочка · шестерёнка · «⋯» (меню «Новая сетка» / «Заполнить кандидатами»). Решённая партия — карточка результата
 * с одной кнопкой «Новая сетка». PD-116: партия переживает перезагрузку (`store.ts`); после неё всегда хаб, а идущая
 * своя сетка — слот «Продолжить». Возврат на хаб подтверждения не требует: партия не выбрасывается, а встаёт на паузу.
 */
export function PlayScreen({ onOpenSettings, onOpenHelp, onOpenToday }: { onOpenSettings?: () => void; onOpenHelp?: (block: HelpBlockId) => void; onOpenToday?: () => void } = {}) {
  const { t } = useTranslation();
  const snap = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
  // PD-161: панель Play смонтирована постоянно; «вкладка на экране» — сигнал из стопки вкладок (таймер, подсказки, эффекты).
  const active = useTabActive();
  const clock = useClock(playStore, active);
  const { phase, play, difficulty } = snap;
  // PD-139: лесенка подсказок. В Ink и до старта партии её нет (`hintAllowed`); ушли с вкладки — подсветки снимаются.
  const { ladder, state: hint } = useHintLadder(playStore, {}, active);
  const def = modeDef(snap.mode);
  // Шит режима и правило перед стартом. Повторный тап по вкладке закрывает оба (как прочие оверлеи).
  const [sheet, setSheet] = useState<{ mode: ModeId; opener: HTMLElement | null } | null>(null);
  const [rule, setRule] = useState<{ mode: ModeId; difficulty: Difficulty } | null>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  sheetOpener.current = sheet?.opener ?? null;
  // PD-171: меню «Обвинить» у клетки (долгое нажатие, «⋯ → Обвинить подсказку…», клавиша A).
  const [accuseAt, setAccuseAt] = useState<{ cell: number; digit: number; anchor: { top: number; bottom: number; left: number; width: number; height: number }; opener: HTMLElement | null } | null>(null);
  const accuseOpener = useRef<HTMLElement | null>(null);
  accuseOpener.current = accuseAt?.opener ?? null;
  const seenReselect = useRef(snap.reselect);
  useEffect(() => {
    if (seenReselect.current === snap.reselect) return;
    seenReselect.current = snap.reselect;
    setSheet(null);
    setRule(null);
    setAccuseAt(null);
  }, [snap.reselect]);
  const openSheet = (mode: ModeId, opener: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null) => {
    if (modeDef(mode).grid === "liar") {
      // Вход в режим Лжеца: заготовить тяжёлые сетки (§1.5) и перечитать Лжеца дня (мог прийти из синхронизации).
      playStore.warmLiar();
      playStore.refreshDaily();
    }
    setSheet({ mode, opener });
  };
  const startMode = (mode: ModeId, difficulty: Difficulty) => {
    setSheet(null);
    if (modeDef(mode).Rule) setRule({ mode, difficulty });
    else playStore.startNew(mode, difficulty);
  };

  useEffect(() => {
    if (!active) return; // таймер партии стоит, пока Play не на экране
    playStore.ensureStarted();
    playStore.setTabActive(true);
    return () => playStore.setTabActive(false);
  }, [active]);

  // QA PD-23, Low 1: возврат на вкладку не должен заново проигрывать стухшие M1/M3.
  useClearEffectsOnUnmount(playStore, active);

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
  // PD-171: Лжец. Обвинять можно, пока лжец не пойман; открыть меню — по клетке (жест) или по выбранной подсказке («⋯», A).
  const liarOpen = interactive && play !== null && play.liar !== undefined && liarHidden(play);
  const openAccuse = (cell: number, el: HTMLElement | null) => {
    if (!play || !playStore.canAccuse(cell)) return;
    playStore.select(cell);
    const cellEl = el ?? document.querySelector<HTMLElement>(`.board [data-i="${cell}"]`);
    const r = cellEl?.getBoundingClientRect();
    const anchor = r ? { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height } : { top: 80, bottom: 120, left: 20, width: 40, height: 40 };
    setAccuseAt({ cell, digit: play.mission[cell] ?? 0, anchor, opener: cellEl });
  };
  const sel = snap.selected;
  const liarSum = play?.liar && phase === "solved" ? liarSummaryOf(play) : null;
  // Лжец пойман / партия ушла с доски — открытое меню обвинения больше ни к чему.
  useEffect(() => {
    if (!liarOpen || snap.hub) setAccuseAt(null);
  }, [liarOpen, snap.hub]);
  const accuseState = !liarOpen || !play ? null : sel !== null && isGiven(play, sel) ? (accusedCells(play).has(sel) ? "accused" : "ready") : "pick";
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
  // PD-189: ожидание генерации — панель на месте поля (порог 600 мс, минимум 700 мс, «долго» с 4 с). Пока она (или пустота
  // первых 600 мс) на экране, поле и панель цифр скрыты, но место за ними держится; ввод не проходит сквозь.
  const wait = useWaitView(phase, !hub && !restoring);
  const waiting = wait.view !== "ready";
  // Фокус стоял на кнопке панели («Повторить», «Отмена» на долгом ожидании), а кнопка исчезла — на заголовок, не на <body>.
  const waitFocus = useRef(false);
  useEffect(() => {
    if (!waitFocus.current) return;
    const el = document.activeElement;
    if (el && el !== document.body && el.isConnected) return;
    waitFocus.current = false;
    titleRef.current?.focus({ preventScroll: true });
  }, [wait.view]);
  const cardView = !hub && phase === "solved" && cardShown;
  const fillState = ink ? "ink" : play && canFill(play) ? "ready" : "empty";
  // PD-203: Мелодия. Звук — только пока партия Мелодии на экране и идёт (иначе ядра нет вовсе); выключатель — пункт «Звук» в ⋯.
  const melody = !hub && play?.melody === true;
  const soundOn = useMelodySound();
  useMelodyGame(playStore, active && melody && !restoring && phase === "playing", !soundOn);
  const melodyHint = melody && phase === "playing" && play !== null && play.log.length === 0 && !waiting;
  // PD-208: Фонарь. «Осмотреть доску» из ⋯ — на эту партию (ключ — момент открытия партии): новая партия/возврат начинают в темноте.
  const lantern = !hub && play?.lantern === true;
  const gameKey = snap.startedOn.getTime();
  const [inspectKey, setInspectKey] = useState<number | null>(null);
  const inspectOn = lantern && inspectKey === gameKey;
  // PD-210: удержание поля (осмотр, пока палец на стекле) — экран меняет чип «Фонарь» → «Осмотр» и строку статуса.
  const [held, setHeld] = useState(false);
  const inspecting = lantern && phase === "playing" && (inspectOn || held);
  // PD-210 (макет PD-209 §2 п. 5, §5): строка статуса Фонаря — нет выбора / удержание / осмотр из меню с «Готово»; иначе «осталось N».
  const lanternStatus: LanternStatusKind | null =
    lantern && phase === "playing" && !waiting && !snap.hint ? (inspectOn ? "menu" : held ? "hold" : sel === null ? "dark" : null) : null;
  const showLamp = !hub && !restoring && !waiting && playStore.hintAllowed();
  const showMore = !hub && !restoring && phase !== "solved";

  // PD-144 (D-1): место под док подсказки отложено постоянно, пока подсказки возможны (партия не в Ink): поле не зависит от дока.
  // До загрузки партии `play` нет — подсказки берутся из реестра режима, чтобы поле не прыгало при появлении партии.
  const hintable = !hub && (play ? !ink : def.hints);
  const fitClass = hub ? " play-hub" : fitClassName({ fit: !cardView, hintable, docked: hint.open });
  const waitClass = hub || restoring ? "" : waiting ? " play-waiting" : wait.entered ? " play-in" : "";

  return (
    <div
      className={`play${fitClass}${waitClass}`}
      onKeyDown={
        hub || waiting
          ? undefined
          : (e) => {
              // PD-171: A — обвинить выбранную подсказку (то же меню-подтверждение, что долгое нажатие).
              if (liarOpen && e.code === "KeyA" && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest('[role="dialog"], [role="menu"]')) {
                e.preventDefault();
                if (sel !== null) openAccuse(sel, null);
                return;
              }
              handleGameKey(e, playStore, ladder);
            }
      }
    >
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
        trailing={
          showMore && (
            <MoreMenu
              fill={waiting ? "empty" : fillState}
              onNew={() => openSheet(snap.mode)}
              onFill={() => playStore.fillCandidates()}
              accuse={accuseState && !waiting ? { state: accuseState, onAccuse: () => sel !== null && openAccuse(sel, null) } : null}
              sound={melody ? { on: soundOn, onToggle: () => setMelodySound(!soundOn) } : null}
              inspect={lantern && phase === "playing" && !waiting ? { on: inspectOn, onToggle: () => setInspectKey(inspectOn ? null : gameKey) } : null}
            />
          )
        }
      />
      {restoring ? null : hub ? (
        <PlaySetup
          modes={availableModes()}
          slots={playStore.slots()}
          liarDay={playStore.liarDaySlot()}
          onOpenLiarDay={() => playStore.startDaily()}
          reselect={snap.reselect}
          onOpenMode={(mode, row) => {
            if (!playStore.open(mode)) openSheet(mode, row);
          }}
          onNewInMode={(mode, row) => openSheet(mode, row)}
          onOpenToday={() => onOpenToday?.()}
        />
      ) : (
        <>
          <Subline
            day=""
            difficulty={diffLabel}
            chip={play ? (ink ? modeDef("ink") : def) : def}
            muted={melody && !soundOn && phase !== "solved"}
            inspecting={inspecting}
            help={snap.assisted === true}
            clock={showClock ? clock : null}
          />
          {cardView ? (
            play && (
              <ResultCard
                play={play}
                cardRef={cardRef}
                title={play.liar ? t("liar.solvedTitle") : t("solved.title")}
                timelapse={{ date: snap.daily ?? localDate(snap.startedOn), difficulty }}
                hints={snap.hints}
                onOpenHelp={onOpenHelp}
                liar={liarSum ? { info: liarSum, average: playStore.liarAverage() } : null}
              >
                {/* PD-144: единственная кнопка нового пазла на экране (шапка на решённой партии действий не несёт). PD-167: шит режима партии. */}
                <button type="button" className="btn-plain newgrid" onClick={(e) => openSheet(snap.mode, e.currentTarget)} data-testid="new-puzzle">
                  {t("play.newPuzzle")}
                </button>
              </ResultCard>
            )
          ) : (
            <>
              <Board
                snap={snap}
                store={playStore}
                dim={phase === "solved"}
                hintMarks={hint.marks}
                inspect={inspectOn}
                onInspectEnd={() => setInspectKey(null)}
                onHoldChange={setHeld}
                onAccuse={liarOpen ? openAccuse : undefined}
                canAccuse={liarOpen ? (cell) => playStore.canAccuse(cell) : undefined}
                overlay={
                  waiting && (
                    <WaitPanel
                      view={wait.view}
                      onFocusIn={() => (waitFocus.current = true)}
                      onRetry={() => {
                        wait.armImmediate();
                        playStore.retry();
                      }}
                      onCancel={() => playStore.toHub()}
                    />
                  )
                }
              />

              {/* Свободное место — МЕЖДУ полем и панелью (макет, находка 1); в зазоре — статус. Гибкий — только он (и поле). */}
              <div className="gap">
                {/* PD-189: «Готовим…» / «Не удалось» — в панели ожидания на месте поля (`WaitPanel`), не в строке статуса.
                    Пока док открыт, строка «N cells left» скрыта: сообщение на экране одно (макет PD-133 §4). */}
                {(phase === "playing" || phase === "solved") && !hint.open && (hint.nudge ? (
                  <p className="status nudge" data-testid="hint-nudge">
                    {boldParts(t("hint.nudge"))}
                  </p>
                ) : melodyHint && !snap.hint ? (
                  // PD-203: новая партия Мелодии, до первого хода — одна строка о звуке вместо «осталось N» (макет PD-202 §2 п. 2).
                  // PD-206: форма по месту в зазоре (melody.css, melody/hintFit.ts): полная → короткая → «осталось N»; AX3 — «осталось N».
                  <p className="status melody-hint" data-testid="melody-hint">
                    <MelodyModeIcon />
                    <span className="mh-long">{t("melody.hint")}</span>
                    <span className="mh-short" aria-hidden="true">
                      {t("melody.hintShort")}
                    </span>
                    <span className="mh-left" aria-hidden="true">
                      {t("play.cellsLeftShort", { count: left })}
                    </span>
                  </p>
                ) : lanternStatus ? (
                  <LanternStatus kind={lanternStatus} onDone={() => setInspectKey(null)} />
                ) : (
                  <StatusLine left={left} full={full} hint={snap.hint} />
                ))}
              </div>

              {hint.open ? <HintDock ladder={ladder} state={hint} play glyphs={play?.glyphs === true} /> : <GamePad snap={snap} store={playStore} />}
            </>
          )}
        </>
      )}
      {sheet && (
        <ModeSheet
          mode={modeDef(sheet.mode)}
          pick={playStore.pickFor(sheet.mode)}
          discard={playStore.slots()[sheet.mode] ?? null}
          onPick={(d) => playStore.setPick(sheet.mode, d)}
          onStart={() => startMode(sheet.mode, playStore.pickFor(sheet.mode))}
          onClose={() => setSheet(null)}
          returnFocus={sheetOpener}
          daily={
            modeDef(sheet.mode).grid === "liar"
              ? {
                  state: playStore.liarDay(),
                  onOpen: () => {
                    setSheet(null);
                    playStore.startDaily();
                  },
                }
              : null
          }
        />
      )}
      {accuseAt && (
        <AccuseMenu
          cell={accuseAt.cell}
          digit={accuseAt.digit}
          anchor={accuseAt.anchor}
          onAccuse={() => playStore.accuse(accuseAt.cell)}
          onClose={() => setAccuseAt(null)}
          returnFocus={accuseOpener}
        />
      )}
      {rule && <RuleSheet rule={rule} onDone={() => setRule(null)} />}
      {hint.rule && <HintRuleSheet play glyphs={play?.glyphs === true} onGo={() => ladder.confirmRule()} onCancel={() => ladder.dismissRule()} />}
    </div>
  );
}

/** Правило необратимого режима перед стартом (`ModeDef.Rule`): «Играть» начинает партию, отмена — ничего не меняет. */
function RuleSheet({ rule, onDone }: { rule: { mode: ModeId; difficulty: Difficulty }; onDone: () => void }) {
  const Rule = modeDef(rule.mode).Rule;
  if (!Rule) return null;
  return (
    <Rule
      onStart={() => {
        onDone();
        playStore.startNew(rule.mode, rule.difficulty);
      }}
      onCancel={onDone}
    />
  );
}
