import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

interface ActionSheetProps {
  title: string;
  message: string;
  /** Главное действие (вверху, HIG action-sheets.md). */
  actionLabel: string;
  /** Сургучный цвет — только там, где действие необратимо (перевыпуск, удаление, уход без ключа). */
  destructive?: boolean;
  cancelLabel: string;
  onAction: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

const FOCUSABLE = "button:not([disabled])";

/**
 * Action sheet (макет PD-48 §5): подтверждение внизу экрана, действие сверху, «Отмена» отдельной группой. Модальный
 * диалог: фокус внутри (Tab по кругу), Esc и тап по фону — отмена, фокус возвращается на кнопку, открывшую шит.
 * Шит над шитом не бывает — поэтому Settings сделан push-экраном.
 */
export function ActionSheet({ title, message, actionLabel, destructive = false, cancelLabel, onAction, onCancel }: ActionSheetProps) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const msgId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus({ preventScroll: true });
    return () => {
      // Кнопка-открыватель могла исчезнуть (действие сменило экран) — тогда фокус остаётся на теле, это нормально.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="st-scrim" onClick={onCancel} data-testid="action-sheet-scrim">
      <div
        ref={root}
        className="st-asheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={msgId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        data-testid="action-sheet"
      >
        <div className="st-agrp">
          <div className="st-ahead">
            <h3 id={titleId}>{title}</h3>
            <p id={msgId}>{message}</p>
          </div>
          <button type="button" className={destructive ? "destructive" : undefined} onClick={onAction} data-testid="action-sheet-go">
            {actionLabel}
          </button>
        </div>
        <div className="st-agrp">
          <button type="button" className="cancel" onClick={onCancel} data-testid="action-sheet-cancel">
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
