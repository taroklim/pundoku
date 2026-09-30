import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface ShellProps {
  title: string;
  sub?: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}

/**
 * Шит Таймлапса/экспорта (макет PD-69 §9): один за раз, понятный выход («Done»), модальный. Рисуется порталом в
 * `body` — поверх шита Year, если открыт из него. Пока открыт: остальное содержимое `body` — `inert` (снимается при
 * закрытии; то, что уже было `inert`, не трогаем), Escape закрывает ТОЛЬКО этот шит (перехват на `window` в фазе
 * захвата, до слушателя Year), фокус уходит на заголовок и возвращается на то, что открыло шит.
 */
export function TimelapseSheetShell({ title, sub, onClose, testId, children }: ShellProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const muted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === rootRef.current || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      muted.push(el);
    }
    headRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      for (const el of muted) el.removeAttribute("inert");
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="tl-root" ref={rootRef} data-testid={testId}>
      <div className="tl-scrim" onClick={() => closeRef.current()} aria-hidden="true" />
      <section className="tl-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="tl-grabber" aria-hidden="true" />
        <header className="tl-head">
          <h2 id={titleId} ref={headRef} tabIndex={-1}>
            {title}
          </h2>
          <button type="button" className="tl-done" onClick={() => closeRef.current()}>
            {t("timelapse.done")}
          </button>
        </header>
        {sub && <p className="tl-sub">{sub}</p>}
        <div className="tl-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
