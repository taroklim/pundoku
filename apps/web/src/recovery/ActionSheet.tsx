import type { ReactNode } from "react";
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
  /**
   * Шит открыт жестом, который ещё не закончился (долгий тап/правая кнопка: палец или кнопка мыши могут быть отпущены уже над
   * кнопками шита). Пока внутри шита не началось НОВОЕ нажатие (pointerdown), указательные click'и — «хвост» открывшего жеста —
   * не доходят ни до кнопок, ни до затемнения. Клавиатурные клики (`detail === 0`) и Esc не задерживаются.
   */
  guardTail?: boolean;
  children?: ReactNode;
}

const FOCUSABLE = "button:not([disabled])";

/**
 * Action sheet (макет PD-48 §5): подтверждение внизу экрана, действие сверху, «Отмена» отдельной группой. Модальный
 * диалог: фон `inert`, фокус внутри (Tab по кругу), Esc (на document) и тап по фону — отмена, фокус возвращается на кнопку, открывшую шит.
 * Шит над шитом не бывает — поэтому Settings сделан push-экраном.
 */
export function ActionSheet({ title, message, actionLabel, destructive = false, cancelLabel, onAction, onCancel, guardTail = false }: ActionSheetProps) {
  const tail = useRef(guardTail);
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const destructiveRef = useRef(destructive);
  const titleId = useId();
  const msgId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Фон недоступен (Tab/VoiceOver), пока шит открыт: `inert` на всех «соседях» цепочки предков шита до <body>.
    const inerted: Element[] = [];
    for (let node: HTMLElement | null = scrim.current; node && node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
    }
    // PD-121 (F9): в разрушающем шите начальный фокус — на безопасной «Отмене»: Enter/пробел сразу после открытия не сотрёт ключ.
    // Tab от неё НЕ защищает: «Отмена» — последний табстоп, и следующий Tab по кругу ведёт на разрушающее действие (а Shift+Tab —
    // на него же, ведь их всего два); защита — только в том, что действие требует осознанного Enter/пробела на нём. В обычном
    // шите начальный фокус — на самом шите (первый Tab → действие, как раньше).
    (destructiveRef.current ? cancelBtn.current : root.current)?.focus({ preventScroll: true });

    // Клавиатура — на document, а не на шите: если фокус всё же оказался вне его (тап по фону, `body`), Esc и Tab работают.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      // Tab ведём сами по кругу, а не полагаемся на нативный: Safari по умолчанию не считает кнопки табстопами, и Tab
      // уводил фокус из страницы (после чего Esc до шита не доходил).
      event.preventDefault();
      const active = document.activeElement;
      const at = active instanceof HTMLElement ? items.indexOf(active) : -1; // -1: фокус на самом шите или вне его
      const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
      items[next]!.focus();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of inerted) el.removeAttribute("inert"); // до возврата фокуса: inert-элемент не принимает фокус
      // Кнопка-открыватель могла исчезнуть (действие сменило экран) — тогда фокус остаётся на теле, это нормально.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={scrim}
      className="st-scrim"
      onClick={onCancel}
      // Capture: гасим хвост жеста раньше, чем он дойдёт до onClick кнопок/затемнения; новое нажатие снимает защиту.
      onPointerDownCapture={() => {
        tail.current = false;
      }}
      onClickCapture={(e) => {
        if (!tail.current || e.detail === 0) return;
        e.stopPropagation();
        e.preventDefault();
      }}
      data-testid="action-sheet-scrim"
    >
      <div
        ref={root}
        className="st-asheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={msgId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
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
          <button ref={cancelBtn} type="button" className="cancel" onClick={onCancel} data-testid="action-sheet-cancel">
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
