/**
 * Общие элементы игрового экрана — Play (PD-11) и Today (PD-12): тихий таймер, объявление
 * «N cells left», панель 1–9 с остатками + Notes/Undo/Erase, клавиатурный ввод, сброс анимаций.
 * Экраны отличаются шапкой и тем, откуда берётся сетка; всё остальное — одно и то же.
 */
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClock } from "./format";
import type { GameStore, PlaySnapshot } from "./gameStore";
import { EraseIcon, NotesIcon, UndoIcon } from "./icons";
import { remaining } from "./logic";

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
 * (кратно 10 и последние 5), с debounce 600 мс и без повтора уже озвученного значения.
 * Возвращает текст для live-региона. Когда партия перестаёт играться (решена/загрузка) —
 * текст очищается: иначе после решения в регионе остаётся «1 cell left» (QA PD-23, Low 2).
 */
export function useCellsLeftAnnouncement(left: number, active: boolean, startedAt: number): string {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const last = useRef<number | null>(null);
  useEffect(() => {
    // Новая партия — сбрасываем, чтобы пороги озвучивались заново.
    last.current = null;
    setText("");
  }, [startedAt]);
  useEffect(() => {
    if (!active) {
      setText("");
      return;
    }
    if (!isMilestone(left) || last.current === left) return;
    const id = window.setTimeout(() => {
      last.current = left;
      setText(t("play.cellsLeft", { count: left }));
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [left, active, t]);
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
  store: Pick<GameStore, "undo" | "erase" | "input" | "toggleNotesMode">,
): void {
  const target = e.target as HTMLElement;
  if (target.closest("select, input, textarea")) return;
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
  }
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
              <span className="kr" aria-hidden="true">
                {rem ? n : ""}
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
          onClick={() => store.toggleNotesMode()}
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
    </div>
  );
}
