/**
 * Вход в Чернильный режим (PD-74, макет PD-69 §«entry / rule sheet»): строка «Ink mode» (Today — в зазоре между полем
 * и панелью, Play — в списке «New puzzle») и шит правил «Ink doesn’t lift», который показывается ДО необратимого
 * выбора. Режим выбирают до первого хода: после него строка исчезает (не приглушается).
 */
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useSheetSwipe } from "../shell/useSheetSwipe";
import { NotesIcon, UndoIcon } from "./icons";
import { ChevronIcon, LockIcon, NibIcon, WarnIcon } from "./inkIcons";

/** Строка-кнопка «Ink mode · Off/On ›». Значение — словом (не только цветом). */
export function InkModeRow({ on, onPress }: { on: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="ink-row" onClick={onPress} aria-haspopup={on ? undefined : "dialog"} data-testid="ink-row">
      <NibIcon className="nib" />
      <span className="row-t">{t("ink.row")}</span>
      <span className={`row-v${on ? " on" : ""}`} data-testid="ink-row-value">
        {on ? t("ink.on") : t("ink.off")}
      </span>
      <ChevronIcon className="chev" />
    </button>
  );
}

/**
 * Состояние «строка режима + шит правил»: нажатие при выключенном режиме открывает шит, «Play in ink» включает,
 * нажатие при включённом — выключает (до первого хода это не необратимо).
 */
export function useInkChoice(on: boolean, setOn: (on: boolean) => void): { press: () => void; sheet: ReactNode } {
  const [open, setOpen] = useState(false);
  const press = () => (on ? setOn(false) : setOpen(true));
  const sheet = open ? (
    <InkRuleSheet
      onStart={() => {
        setOpen(false);
        setOn(true);
      }}
      onCancel={() => setOpen(false)}
    />
  ) : null;
  return { press, sheet };
}

/** Today: строка режима и подпись под ней (в `.gap`). */
export function InkEntry({ on, setOn }: { on: boolean; setOn: (on: boolean) => void }) {
  const { t } = useTranslation();
  const { press, sheet } = useInkChoice(on, setOn);
  return (
    <div className="ink-entry" data-testid="ink-entry">
      <div className="ink-list">
        <InkModeRow on={on} onPress={press} />
      </div>
      <p className="ink-foot">{t("ink.foot")}</p>
      {sheet}
    </div>
  );
}

const FOCUSABLE = "button:not([disabled])";

/**
 * Шит правил: четыре строки с иконками того же набора (Undo, предупреждение, карандаш, замок), основное действие
 * «Play in ink», вторичное «Not now», тап по фону = закрыть. Модальный: фон `inert`, Tab по кругу, Esc закрывает,
 * фокус возвращается на открывшую строку.
 */
export function InkRuleSheet({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const swipe = useSheetSwipe(root, onCancel);
  const titleId = useId();
  const leadId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted: Element[] = [];
    for (let node: HTMLElement | null = scrim.current; node && node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
    }
    // PD-232 (в): начальный фокус — «Играть чернилами» (Enter): до первого хода режим снимается обратно, ничего не теряется.
    (root.current?.querySelector<HTMLElement>('[data-testid="ink-rule-start"]') ?? root.current)?.focus({ preventScroll: true });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      event.preventDefault();
      const active = document.activeElement;
      const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
      items[next]!.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of inerted) el.removeAttribute("inert");
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div ref={scrim} className="ink-scrim" onClick={onCancel} data-testid="ink-sheet-scrim">
      <section
        ref={root}
        className="ink-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={leadId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid="ink-sheet"
      >
        <div className="grabber sheet-handle" aria-hidden="true" {...swipe} />
        <h2 id={titleId} className="ink-sheet-title sheet-handle" {...swipe}>
          {t("ink.rule.title")}
        </h2>
        <p id={leadId} className="ink-sheet-lead">
          {t("ink.rule.lead")}
        </p>
        <ul className="ink-rules">
          <li>
            <UndoIcon />
            <span>{t("ink.rule.r1")}</span>
          </li>
          <li className="wax">
            <WarnIcon />
            <span>{t("ink.rule.r2")}</span>
          </li>
          <li>
            <NotesIcon />
            <span>{t("ink.rule.r3")}</span>
          </li>
          <li>
            <LockIcon />
            <span>{t("ink.rule.r4")}</span>
          </li>
        </ul>
        <div className="ink-sheet-foot">
          <button type="button" className="ink-primary" onClick={onStart} data-testid="ink-rule-start">
            {t("ink.rule.start")}
          </button>
          <button type="button" className="ink-quiet" onClick={onCancel} data-testid="ink-rule-cancel">
            {t("ink.rule.cancel")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
