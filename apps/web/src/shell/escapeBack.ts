/**
 * PD-232: общие правила глобальной клавиатуры (document) — когда клавиша не наша.
 * - `EDITABLE`: поле ввода — его клавиши текст, а не ход/навигация;
 * - `OVERLAY`: шит/диалог/меню (порталом в body) — пока любой открыт, клавиши его (Esc его закрывает сам).
 */
import { useEffect, useRef } from "react";

export const EDITABLE = 'select, input, textarea, [contenteditable]:not([contenteditable="false"])';
export const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]';

/** Открыт ли сейчас шит/диалог/меню где-нибудь в документе. */
export const overlayOpen = (): boolean => document.querySelector(OVERLAY) !== null;

/**
 * PD-232 (г), аудит PD-228 п. 13: Esc = «назад» на экране поверх вкладки (Settings, справка, архив вне партии) — то же, что
 * «‹». Esc шитов и меню остаётся их (они закрываются своими обработчиками; пока слой открыт, «назад» молчит), в поле ввода и
 * с модификаторами — не наш. `onBack` берётся свежим на каждое нажатие.
 */
export function useEscapeBack(enabled: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(EDITABLE)) return;
      if (overlayOpen()) return;
      e.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
