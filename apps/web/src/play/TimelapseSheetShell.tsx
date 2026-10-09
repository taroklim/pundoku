import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useSheetSwipe } from "../shell/useSheetSwipe";
import { inertOutside, usePortalHost } from "../shell/portalHost";

interface ShellProps {
  title: string;
  sub?: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
  /** PD-203: действие в шапке между заголовком и «Готово» (кнопка звука в партиях Мелодии). */
  headExtra?: ReactNode;
}

/**
 * Шит Таймлапса/экспорта (макет PD-69 §9): один за раз, понятный выход (одна кнопка «Done» — «Cancel», дублирующей её,
 * нет, PD-121/E2; закрытие жестом вниз по grabber/заголовку — `useSheetSwipe`), модальный. Рисуется порталом в
 * `body` — поверх шита Year, если открыт из него. Пока открыт: остальное содержимое `body` — `inert` (снимается при
 * закрытии; то, что уже было `inert`, не трогаем), Escape закрывает ТОЛЬКО этот шит (перехват на `window` в фазе
 * захвата, до слушателя Year), фокус уходит на заголовок и возвращается на то, что открыло шит.
 */
export function TimelapseSheetShell({ title, sub, onClose, testId, children, headExtra = null }: ShellProps) {
  const portalHost = usePortalHost();
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const swipe = useSheetSwipe(sheetRef, () => closeRef.current());

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // PD-267: соседи по всей цепочке предков (в `<body>` — те же дети body; в слое окна десктопа C — ещё сайдбар и стопка).
    const unmute = inertOutside(rootRef.current);
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
      unmute();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="tl-root" ref={rootRef} data-testid={testId}>
      <div className="tl-scrim" onClick={() => closeRef.current()} aria-hidden="true" />
      <section ref={sheetRef} className="tl-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="tl-grabber sheet-handle" aria-hidden="true" {...swipe} />
        <header className="tl-head sheet-handle" {...swipe}>
          <h2 id={titleId} ref={headRef} tabIndex={-1}>
            {title}
          </h2>
          {headExtra}
          <button type="button" className="tl-done" onClick={() => closeRef.current()}>
            {t("timelapse.done")}
          </button>
        </header>
        {sub && <p className="tl-sub">{sub}</p>}
        <div className="tl-body">{children}</div>
      </section>
    </div>,
    portalHost,
  );
}
