/**
 * Общие элементы игрового экрана — Play (PD-11) и Today (PD-12): тихий таймер, объявление
 * «N cells left», панель 1–9 с остатками + Notes/Undo/Erase, клавиатурный ввод, сброс анимаций.
 * Экраны отличаются шапкой и тем, откуда берётся сетка; всё остальное — одно и то же.
 */
import type { CSSProperties, KeyboardEvent } from "react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheet } from "../recovery/ActionSheet";
import { formatClock } from "./format";
import type { GameStore, PlaySnapshot } from "./gameStore";
import { EraseIcon, NotesIcon, UndoIcon } from "./icons";
import { remaining } from "./logic";
import { MOTION_FLAGS, MOTION_MS } from "./motion";

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Строка статуса (M9): «N cells left» — по ПОСТАВЛЕННЫМ цифрам (PD-118). При смене текста перекатывается (translateY
 * 6 px + opacity, 220 мс). Узел пересоздаётся по `key`, чтобы CSS-анимация запустилась заново; первый показ и возврат
 * на вкладку не анимируются (анимирует только смена в этой же жизни компонента). Отключается флагом
 * `MOTION_FLAGS.statusRoll` (motion.ts): тогда класс `roll` не ставится вовсе — текст меняется молча. Под reduced motion
 * анимации нет (единый reduced-блок). Озвучка не затронута: это не live-регион.
 *
 * Два состояния вместо счёта: `full` — сетка заполнена, но не решена (PD-117a): честная фраза без числа неверных клеток
 * (счёт «N cells left = 0» на непустой ошибке врал бы); `hint` — отклик на отказ (PD-117b), на `HINT_MS` вместо счёта.
 * `memo`: перерисовка по тику таймера не должна снимать класс посреди анимации.
 */
export const StatusLine = memo(function StatusLine({ left, full = false, hint = null }: { left: number; full?: boolean; hint?: PlaySnapshot["hint"] }) {
  const { t } = useTranslation();
  const state = hint ? `h${hint.id}` : full ? "full" : String(left);
  const prev = useRef(state);
  const rolled = MOTION_FLAGS.statusRoll && prev.current !== state;
  useEffect(() => {
    prev.current = state;
  }, [state]);
  const text = hint ? t(`play.hint.${hint.kind}`, { count: hint.count }) : full ? t("play.gridFull") : t("play.cellsLeft", { count: left });
  return (
    <p key={MOTION_FLAGS.statusRoll ? state : "static"} className={rolled ? "status roll" : "status"} data-testid="status-line">
      {text}
    </p>
  );
});

/** Тихий таймер: перечитывает часы хранилища; ставится на паузу самим хранилищем. */
export function useClock(store: Pick<GameStore, "getElapsedMs">): string {
  const [text, setText] = useState(() => formatClock(store.getElapsedMs()));
  useEffect(() => {
    const tick = () => setText(formatClock(store.getElapsedMs()));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [store]);
  return text;
}

/** Ключевые пороги остатка для озвучки: каждые 10 клеток и последние пять. */
const isMilestone = (left: number): boolean => left > 0 && (left % 10 === 0 || left <= 5);

/** Порог debounce объявления (QA PD-23: оставить 600 мс). */
export const ANNOUNCE_DEBOUNCE_MS = 600;

/**
 * Объявление «N cells left» для скринридера — не на каждую цифру: только на порогах
 * (кратно 10 и последние 5 — по поставленным цифрам, PD-118), с debounce 600 мс и без повтора уже озвученного значения.
 * Заполненная, но не решённая сетка (`full`, PD-117a) озвучивается один раз: «Grid full — something doesn’t match».
 * Возвращает текст для live-региона. Когда партия перестаёт играться (решена/загрузка) —
 * текст очищается: иначе после решения в регионе остаётся «1 cell left» (QA PD-23, Low 2).
 */
export function useCellsLeftAnnouncement(left: number, active: boolean, startedAt: number, full = false): string {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const last = useRef<number | null>(null);
  const saidFull = useRef(false);
  useEffect(() => {
    // Новая партия — сбрасываем, чтобы пороги озвучивались заново.
    last.current = null;
    saidFull.current = false;
    setText("");
  }, [startedAt]);
  useEffect(() => {
    if (!active) {
      setText("");
      return;
    }
    if (full) {
      if (saidFull.current) return;
      const id = window.setTimeout(() => {
        saidFull.current = true;
        last.current = null; // после исправления пороги остатка озвучиваются заново
        setText(t("play.gridFull"));
      }, ANNOUNCE_DEBOUNCE_MS);
      return () => window.clearTimeout(id);
    }
    saidFull.current = false; // сетка снова не полна — при следующем заполнении скажем снова
    if (!isMilestone(left) || last.current === left) return;
    const id = window.setTimeout(() => {
      last.current = left;
      setText(t("play.cellsLeft", { count: left }));
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [left, active, full, t]);
  return text;
}

/**
 * Озвучка отклика на отказ (PD-117b): тот же `role="status"`, что «N cells left»; текст держится `HINT_MS`.
 * Регион сначала очищается, чтобы два подряд одинаковых отклика озвучились оба.
 */
export function useHintAnnouncement(hint: PlaySnapshot["hint"]): string {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const id = hint?.id ?? 0;
  const kind = hint?.kind;
  const count = hint?.count;
  useEffect(() => {
    setText("");
    if (id === 0 || !kind) return;
    const say = window.setTimeout(() => setText(t(`play.hint.${kind}`, { count })), 50);
    return () => window.clearTimeout(say);
  }, [id, kind, count, t]);
  return text;
}

/** Через сколько после кляксы озвучивается «Wrong digit…» (после самого момента M7) и сколько текст живёт в регионе. */
export const BLOT_SAY_DELAY_MS = 200;
const BLOT_SAY_HOLD_MS = 5000;

/**
 * Объявление кляксы (PD-74, M7): «Wrong digit. The cell is sealed with a blot. 5» — текстом, чтобы момент не нёс
 * только цвет и движение. Живёт в том же `role="status"`, что «N cells left»; пока звучит, вытесняет его.
 * Регион сначала очищается: два подряд одинаковых текста иначе не озвучились бы второй раз.
 */
export function useBlotAnnouncement(snap: Pick<PlaySnapshot, "blot" | "play">): string {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const blot = snap.blot ?? null;
  const id = blot?.id ?? 0;
  const cell = blot?.cell ?? -1;
  const right = snap.play && cell >= 0 ? (snap.play.values[cell] ?? 0) : 0;
  useEffect(() => {
    setText("");
    if (id === 0) return;
    const say = window.setTimeout(() => setText(`${t("ink.blotSay")} ${right}`), BLOT_SAY_DELAY_MS);
    const clear = window.setTimeout(() => setText(""), BLOT_SAY_DELAY_MS + BLOT_SAY_HOLD_MS);
    return () => {
      window.clearTimeout(say);
      window.clearTimeout(clear);
    };
  }, [id, right, t]);
  return text;
}

/**
 * Сбросить `pop`/`wave` хранилища при размонтировании экрана (QA PD-23, Low 1): снапшот живёт
 * выше экрана, и без сброса возврат на вкладку заново проигрывает M1/M3.
 */
export function useClearEffectsOnUnmount(store: Pick<GameStore, "clearEffects">): void {
  useEffect(() => () => store.clearEffects(), [store]);
}

/** Клавиатурный ввод игрового экрана (цифры, Backspace, Ctrl+Z, N). */
export function handleGameKey(
  e: KeyboardEvent<HTMLElement>,
  store: Pick<GameStore, "undo" | "erase" | "input" | "toggleNotesMode" | "fillCandidates">,
): void {
  const target = e.target as HTMLElement;
  // Шит поверх экрана (PD-116: «Discard current puzzle?») — его клавиши не ввод в клетку.
  if (target.closest('select, input, textarea, [role="dialog"]')) return;
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
    e.preventDefault();
    store.undo();
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  // По e.code, а не e.key: Shift+1 даёт «!», Alt+1 на Mac — спецсимвол.
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (m) {
    e.preventDefault();
    // Shift/Alt — временно противоположный режим (цифра ↔ заметка), пока клавиша зажата.
    store.input(Number(m[1]), e.shiftKey || e.altKey);
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    store.erase();
  } else if (e.code === "KeyN" && !e.altKey && !e.shiftKey) {
    store.toggleNotesMode();
  } else if (e.code === "KeyF" && !e.altKey && !e.shiftKey) {
    // PD-119: «Fill candidates» — отдельное действие (как долгий тап по Notes), без подтверждения: откатывается одним Undo.
    store.fillCandidates();
  }
}

/** Долгое нажатие на Notes (PD-119): порог — как у системных контекстных меню iOS. */
export const LONG_PRESS_MS = 500;

/** Событие M8 живёт, пока уезжает счётчик клавиши (пауза до ответа + 220 мс); потом клавиша показывает «·». */
function useEchoKey(echo: PlaySnapshot["echo"]): NonNullable<PlaySnapshot["echo"]> | null {
  const [done, setDone] = useState(0);
  const id = echo?.id ?? 0;
  useEffect(() => {
    if (id === 0) return;
    const timer = window.setTimeout(() => setDone(id), MOTION_MS.keyOut);
    return () => window.clearTimeout(timer);
  }, [id]);
  return echo && echo.id !== done ? echo : null;
}

/**
 * Панель 1–9 в один ряд с остатками + Notes / Undo / Erase (утверждённый макет, вариант «1 row + left»).
 * Чернильный режим (PD-74): Undo исчезает целиком (не приглушён), ластик цифр заменён на «Erase notes» — ряд из двух
 * кнопок по 50 %, высота та же 46 pt.
 */
export function GamePad({ snap, store }: { snap: PlaySnapshot; store: GameStore }) {
  const { t } = useTranslation();
  const { play, phase } = snap;
  const interactive = phase === "playing" && play !== null;
  const ink = play?.ink === true;
  const rem = play ? remaining(play) : null;
  const canUndo = interactive && (play?.undoStack.length ?? 0) > 0;
  // M8: пока идёт ответ закрытой цифры, её счётчик ещё показывает последний остаток и уезжает вверх (220 мс), затем «·».
  const echo = useEchoKey(snap.echo ?? null);
  // PD-119: «Fill candidates» — долгий тап по Notes (или правая кнопка/контекстное меню) открывает шит с этим действием.
  // Четвёртой кнопки в ряду нет (320 pt не вмещает её при цели ≥44), а «⋯» в шапке не нашлось места; шит — подтверждение
  // намерения: случайный долгий тап ничего не заполняет. В чернилах недоступно: подсказок в ink нет.
  const [filling, setFilling] = useState(false);
  const fillable = interactive && !ink;
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const stopPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  useEffect(() => () => stopPress(), []);
  const closeFill = () => {
    press.current = null; // «fired» не должен проглотить следующий тап/Enter по Notes
    setFilling(false);
  };
  useEffect(() => {
    if (!fillable) setFilling(false); // ink/конец партии закрыли действие из-под открытого шита
  }, [fillable]);
  return (
    <div className="pad-wrap">
      <div className="pad" role="group" aria-label={t("pad.label")}>
        {DIGITS.map((d) => {
          const n = rem ? Math.max(0, rem[d] as number) : 9;
          return (
            <button
              key={d}
              type="button"
              className={`key${rem && n === 0 ? " done" : ""}`}
              aria-label={t("pad.key", { digit: d, n })}
              disabled={!interactive}
              onClick={() => store.input(d)}
            >
              <span className="kd" aria-hidden="true">
                {d}
              </span>
              <span
                className={echo && echo.digit === d ? "kr out" : "kr"}
                style={echo && echo.digit === d ? ({ "--ed": echo.delay } as CSSProperties) : undefined}
                aria-hidden="true"
              >
                {rem ? (echo && echo.digit === d ? 1 : n === 0 ? "·" : n) : ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className={`actions${ink ? " ink" : ""}`}>
        <button
          type="button"
          className="act"
          aria-pressed={snap.notesMode}
          disabled={!interactive}
          onPointerDown={() => {
            stopPress();
            press.current = null;
            if (!fillable) return;
            const state = { timer: 0, fired: false };
            state.timer = window.setTimeout(() => {
              state.fired = true;
              setFilling(true);
            }, LONG_PRESS_MS);
            press.current = state;
          }}
          onPointerUp={stopPress}
          onPointerLeave={stopPress}
          onPointerCancel={stopPress}
          onContextMenu={(e) => {
            // iOS/Android отдают долгий тап как contextmenu (на кнопках не всегда) — и мышь по правой кнопке.
            if (!fillable) return;
            e.preventDefault();
            stopPress();
            if (press.current) press.current.fired = true;
            setFilling(true);
          }}
          onClick={() => {
            // Тап, закончивший долгое нажатие, не переключает режим заметок (шит уже открыт).
            if (press.current?.fired) {
              press.current = null;
              return;
            }
            store.toggleNotesMode();
          }}
        >
          <NotesIcon />
          <span>{t("actions.notes")}</span>
        </button>
        {!ink && (
          <button type="button" className="act" aria-disabled={!canUndo} onClick={() => store.undo()}>
            <UndoIcon />
            <span>{t("actions.undo")}</span>
          </button>
        )}
        <button type="button" className="act" disabled={!interactive} onClick={() => store.erase()}>
          <EraseIcon />
          <span>{ink ? t("ink.eraseNotes") : t("actions.erase")}</span>
        </button>
      </div>
      {filling && (
        <ActionSheet
          title={t("play.fillTitle")}
          message={t("play.fillMessage")}
          actionLabel={t("play.fillAction")}
          cancelLabel={t("play.fillCancel")}
          onAction={() => {
            closeFill();
            store.fillCandidates();
          }}
          onCancel={closeFill}
          guardTail
        />
      )}
    </div>
  );
}
