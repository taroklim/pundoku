/**
 * PD-189: представление ожидания генерации партии (макет design/pd188-loading.md §3, вариант B). Стор не меняется — пороги и
 * минимум показа живут только здесь: фаза `loading`/`error` стора → что видно на месте поля.
 *
 *   pre   — первые `WAIT_SHOW_AFTER_MS`: на месте поля и панели цифр пусто (быстрая генерация не мигает индикатором);
 *   wait  — панель «Готовим головоломку…»;
 *   long  — с `WAIT_LONG_AFTER_MS` от старта: второй текст + «Отмена»;
 *   error — «Не удалось…» + «Повторить» / «Отмена» (сразу, без порога);
 *   out   — партия готова, панель гаснет (`WAIT_FADE_OUT_MS`); до этого держится не меньше `WAIT_MIN_SHOWN_MS`;
 *   ready — поле. `entered` — поле только что сменило загрузку (экран проигрывает появление поля и панели цифр).
 *
 * «Повторить» (`armImmediate` перед `retry()`) показывает панель сразу: человек сам нажал и ждёт.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./gameStore";

export const WAIT_SHOW_AFTER_MS = 600;
export const WAIT_MIN_SHOWN_MS = 700;
export const WAIT_LONG_AFTER_MS = 4000;
export const WAIT_FADE_OUT_MS = 160;

export type WaitView = "pre" | "wait" | "long" | "error" | "out" | "ready";

export interface WaitState {
  view: WaitView;
  /** Поле появилось после загрузки (а не открыто уже идущей партией). */
  entered: boolean;
  /** Вызвать прямо перед `retry()`: следующая загрузка показывает панель без порога 600 мс. */
  armImmediate: () => void;
}

const initialView = (phase: Phase, on: boolean): WaitView => (!on ? "ready" : phase === "loading" ? "pre" : phase === "error" ? "error" : "ready");

/** `on` — на экране доска партии (не хаб и не чтение слотов); иначе ожидания нет и цикл сбрасывается. */
export function useWaitView(phase: Phase, on: boolean): WaitState {
  const [view, setView] = useState<WaitView>(() => initialView(phase, on));
  const [entered, setEntered] = useState(false);
  const timers = useRef<number[]>([]);
  /** Идёт цикл загрузки (старт зафиксирован, таймеры порогов поставлены). */
  const loading = useRef(false);
  /** Момент показа панели (`Date.now()`); `null` — панель в этом цикле не показывалась. */
  const shownAt = useRef<number | null>(null);
  const immediate = useRef(false);

  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };
  const at = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => {
    if (!on) {
      clear();
      loading.current = false;
      shownAt.current = null;
      setView("ready");
      setEntered(false);
      return;
    }
    if (phase === "loading") {
      if (loading.current) return; // та же загрузка (перерисовка), пороги уже стоят
      clear();
      loading.current = true;
      shownAt.current = null;
      setEntered(false);
      const show = () => {
        shownAt.current = Date.now();
        setView("wait");
      };
      if (immediate.current) show();
      else {
        setView("pre");
        at(WAIT_SHOW_AFTER_MS, show);
      }
      immediate.current = false;
      at(WAIT_LONG_AFTER_MS, () => setView((v) => (v === "wait" ? "long" : v)));
      return;
    }
    if (phase === "error") {
      clear();
      loading.current = false;
      shownAt.current = Date.now();
      setView("error");
      return;
    }
    // Партия на доске (playing/solved).
    if (!loading.current) {
      // Открыта уже готовая партия (слот, Лжец дня из записи) или ошибка сменилась партией без загрузки — ожидания не было.
      clear();
      setView("ready");
      return;
    }
    clear();
    loading.current = false;
    const reveal = () => {
      setView("ready");
      setEntered(true);
    };
    if (shownAt.current === null) {
      reveal();
      return;
    }
    const fade = () => {
      setView("out");
      at(WAIT_FADE_OUT_MS, reveal);
    };
    const left = shownAt.current + WAIT_MIN_SHOWN_MS - Date.now();
    if (left > 0) at(left, fade);
    else fade();
    // Таймеры живут в ref: цикл управляется только фазой и `on`.
  }, [phase, on]);

  useEffect(() => () => clear(), []);

  const armImmediate = useCallback(() => {
    immediate.current = true;
  }, []);

  return { view, entered, armImmediate };
}
