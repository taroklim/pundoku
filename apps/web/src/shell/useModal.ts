/**
 * Поведение модального слоя для новых оверлеев Play (PD-144: меню «⋯», шит «Режим»): фон `inert`, начальный фокус, ловушка
 * Tab, Esc, возврат фокуса на явный элемент. Те же правила, что у `ActionSheet`/`InkRuleSheet` (их не трогаем), но:
 * - возврат фокуса идёт на ЯВНЫЙ `returnFocus`, а не на `document.activeElement` (Safari не фокусирует кнопку по тапу);
 * - есть режим меню: ↑/↓ по кругу, Home/End между `[role="menuitem"]`;
 * - `suspended()` временно отдаёт клавиатуру вложенному слою (шит «Режим» → шит правила): слой НЕ перемонтируется,
 *   иначе он снял бы `inert` и вернул фокус посреди дочернего шита.
 */
import type { RefObject } from "react";
import { useEffect, useRef } from "react";

const FOCUSABLE = "button:not([disabled])";

export interface ModalOptions {
  readonly onClose: () => void;
  /** Куда вернуть фокус при закрытии; нет элемента или он ушёл из DOM — фокус остаётся как есть. */
  readonly returnFocus?: RefObject<HTMLElement | null>;
  /** `menu` — стрелки по пунктам меню; `dialog` — только Tab/Esc. */
  readonly kind: "menu" | "dialog";
  /** Селектор начального фокуса внутри слоя; не найден — сам слой (`tabIndex=-1`). */
  readonly initialFocus?: string;
  /** Вложенный слой открыт: Esc/Tab не обрабатываем. */
  readonly suspended?: () => boolean;
  /**
   * Слой видим и готов принять фокус (PD-182). Контекстные меню (`ModeMenu`/`AccuseMenu`) первый проход рендерят с
   * `visibility:hidden`, пока `useLayoutEffect` не измерит и не поставит позицию; фокус на скрытый элемент браузер
   * молча игнорирует (уходит на <body>). Начальный фокус ставится, когда `ready` впервые стал true. По умолчанию true.
   */
  readonly ready?: boolean;
}

export function useModal(scrim: RefObject<HTMLElement | null>, root: RefObject<HTMLElement | null>, options: ModalOptions): void {
  const opts = useRef(options);
  opts.current = options;
  const ready = options.ready ?? true;
  const focused = useRef(false);

  useEffect(() => {
    const opener = opts.current.returnFocus?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // Фон недоступен (Tab/VoiceOver), пока слой открыт: `inert` на «соседях» цепочки предков до <body>.
    const inerted: Element[] = [];
    for (let node: HTMLElement | null = scrim.current; node && node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (opts.current.suspended?.()) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        opts.current.onClose();
        return;
      }
      const el = root.current;
      if (!el) return;
      const active = document.activeElement;
      if (opts.current.kind === "menu" && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End")) {
        const items = [...el.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')];
        if (items.length === 0) return;
        event.preventDefault();
        const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
        const next =
          event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1;
        items[next]!.focus();
        return;
      }
      if (event.key !== "Tab") return;
      // Tab ведём сами по кругу (Safari не считает кнопки табстопами). `aria-disabled`-пункт остаётся в круге.
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      event.preventDefault();
      const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
      items[next]!.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // PD-185: слой закрыт (или StrictMode симулирует unmount → remount) — при следующем открытии фокус ставится заново,
      // иначе после remount флаг «уже сфокусировано» остаётся, а фокус ниже уже ушёл на opener.
      focused.current = false;
      for (const el of inerted) el.removeAttribute("inert"); // до возврата фокуса: inert-элемент не принимает фокус
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [scrim, root]);

  // Начальный фокус — отдельно и после основного эффекта (opener уже запомнен): один раз, когда слой стал видимым.
  useEffect(() => {
    if (!ready || focused.current) return;
    focused.current = true;
    const first = opts.current.initialFocus ? root.current?.querySelector<HTMLElement>(opts.current.initialFocus) : null;
    (first ?? root.current)?.focus({ preventScroll: true });
  }, [ready, root]);
}
