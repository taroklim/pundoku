/**
 * Одноразовый шит правила подсказки (PD-139, решение владельца: предупреждение ДО). Показывается один раз за всё время —
 * перед первым открытием лесенки; повторять не нужно, постоянная строка живёт в подвале дока. Каркас и классы — те же,
 * что у шита правила чернил (`InkRuleSheet`, ink.css): модальный, фон `inert`, Tab по кругу, Esc и тап по фону закрывают,
 * фокус возвращается на лампочку.
 */
import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useSheetSwipe } from "../shell/useSheetSwipe";
import { MarkIcon, NoneIcon, RepeatIcon } from "./hintIcons";
import { NibIcon } from "./inkIcons";

const FOCUSABLE = "button:not([disabled])";

/** «**жирное**» в строке перевода → `<strong>` (парные звёздочки; без HTML в строках перевода). */
export function boldParts(text: string): ReactNode[] {
  return text.split("**").map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export function HintRuleSheet({ onGo, onCancel }: { onGo: () => void; onCancel: () => void }) {
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
    root.current?.focus({ preventScroll: true });
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
    <div ref={scrim} className="ink-scrim" onClick={onCancel} data-testid="hint-rule-scrim">
      <section
        ref={root}
        className="ink-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={leadId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid="hint-rule-sheet"
      >
        <div className="grabber sheet-handle" aria-hidden="true" {...swipe} />
        <h2 id={titleId} className="ink-sheet-title sheet-handle" {...swipe}>
          {t("hint.rule.title")}
        </h2>
        <p id={leadId} className="ink-sheet-lead">
          {t("hint.rule.lead")}
        </p>
        <ul className="ink-rules">
          <li>
            <MarkIcon />
            <span>{boldParts(t("hint.rule.r1"))}</span>
          </li>
          <li>
            <RepeatIcon />
            <span>{t("hint.rule.r2")}</span>
          </li>
          <li>
            <NoneIcon />
            <span>{t("hint.rule.r3")}</span>
          </li>
          <li>
            <NibIcon />
            <span>{t("hint.rule.r4")}</span>
          </li>
        </ul>
        <div className="ink-sheet-foot">
          <button type="button" className="ink-primary" onClick={onGo} data-testid="hint-rule-go">
            {t("hint.rule.go")}
          </button>
          <button type="button" className="ink-quiet" onClick={onCancel} data-testid="hint-rule-cancel">
            {t("hint.rule.not")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
