/**
 * Тост отмены (PD-225, design/pd224-swipe-gestures.md §A7.1) — первый тост приложения: «Сетка „Лжец“ удалена · Отменить» над
 * таб-баром. Удаление уже записано; «Отменить» возвращает. HIG `alerts.md`: для частого отменяемого действия — не алерт.
 *
 * - Окно — `UNDO_TOAST_MS` (6 с); пауза, пока палец на тосте или фокус внутри.
 * - Путь клавиатуры/VoiceOver (`toast.focus`): фокус сразу на «Отменить», по таймеру тост не гаснет, пока фокус в нём; ушёл
 *   фокус — 6 с заново (WCAG 2.2.1).
 * - Текст тоста и объявления (`announce`: «Сетка восстановлена») — в живом регионе `polite`, который смонтирован всегда:
 *   регион, появившийся вместе с текстом, VoiceOver может не прочитать.
 * - Новый тост (другой `id`) заменяет прежний, таймер заново. `toast = null` — уход прозрачностью (160 мс × `--mk`), потом из DOM.
 * - Портал в `<body>`: панель вкладки во время перехода получает transform, а `position: fixed` внутри неё поехал бы с ней.
 *   Слой — выше хаба и таб-бара, ниже меню/шитов (их открытие закрывает тост — решает экран).
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterPaint } from "./afterPaint";

export const UNDO_TOAST_MS = 6000;
/** Отпущенный палец оставляет не меньше стольких мс — тост не гаснет прямо из-под руки. */
const MIN_AFTER_HOLD_MS = 1500;
const LEAVE_MS = 160;
const LEAVE_REDUCED_MS = 115;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface UndoToastProps {
  /** Тост на экране; `id` — его личность (новый `id` — новый тост). `focus` — путь клавиатуры/AT: фокус на «Отменить». */
  readonly toast: { readonly id: number; readonly text: string; readonly focus: boolean } | null;
  /** Объявление для скринридера без тоста (после «Отменить»). Новый `id` — прочитать снова. */
  readonly announce?: { readonly id: number; readonly text: string } | null;
  readonly actionLabel: ReactNode;
  /** «Отменить». `hadFocus` — фокус был внутри тоста (экран вернёт его на строку). */
  readonly onAction: (hadFocus: boolean) => void;
  /** Окно истекло — удаление окончательно, тост пора убрать. */
  readonly onExpire: () => void;
}

export function UndoToast({ toast, announce = null, actionLabel, onAction, onExpire }: UndoToastProps) {
  const box = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const [shown, setShown] = useState(toast);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [said, setSaid] = useState("");

  const timer = useRef(0);
  const remaining = useRef(UNDO_TOAST_MS);
  const startedAt = useRef(0);
  const held = useRef(false);
  const focusInside = useRef(false);

  const pause = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (startedAt.current) remaining.current = Math.max(MIN_AFTER_HOLD_MS, remaining.current - (Date.now() - startedAt.current));
    startedAt.current = 0;
  };
  const run = () => {
    if (held.current || focusInside.current) return;
    window.clearTimeout(timer.current);
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      startedAt.current = 0;
      expire.current();
    }, remaining.current);
  };

  // Новый тост: показать, отсчёт заново (или фокус на «Отменить»). Тост убрали — уход прозрачностью.
  const id = toast?.id ?? null;
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    startedAt.current = 0;
    if (!toast) {
      if (!shownRef.current) return; // тоста и не было
      const t = window.setTimeout(
        () => setShown(null),
        reducedMotion() ? LEAVE_REDUCED_MS : LEAVE_MS,
      );
      return () => window.clearTimeout(t);
    }
    setShown(toast);
    remaining.current = UNDO_TOAST_MS;
    held.current = false;
    focusInside.current = false;
    run();
    const cancelFocus = toast.focus ? afterPaint(() => action.current?.focus({ preventScroll: true })) : undefined;
    return () => {
      cancelFocus?.();
      window.clearTimeout(timer.current);
      timer.current = 0;
    };
    // Зависимости намеренно узкие: тост определяется `id`; объект пересоздаётся на каждом рендере экрана
  }, [id]);

  // Живой регион: очистить и через миг записать — одинаковый текст подряд тоже прочитается.
  const sayText = toast?.text ?? null;
  const sayAnnounce = announce ? `${announce.id}\u0000${announce.text}` : null;
  useEffect(() => {
    const text = toast ? toast.text : announce?.text;
    if (!text) return;
    setSaid("");
    const t = window.setTimeout(() => setSaid(text), 60);
    return () => window.clearTimeout(t);
    // Зависимости намеренно узкие: читать по смене тоста/объявления, не по каждому рендеру
  }, [id, sayText, sayAnnounce]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Пришедший тост рисуется в ТОМ ЖЕ коммите, что и проп (не через `shown` из эффекта): иначе фокус «после кадра» мог
  // прийти раньше перерисовки и не найти кнопку (WebKit под нагрузкой — фокус терялся на <body>). `shown` держит только
  // уходящий тост на время прозрачности.
  const view = toast ?? shown;
  const out = !toast;
  const kbd = view?.focus === true;
  return createPortal(
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="undo-toast-live">
        {said}
      </p>
      {view && (
        <div
          key={view.id}
          ref={box}
          className={out ? "undo-toast out" : "undo-toast"}
          aria-hidden={out || undefined}
          inert={out || undefined}
          onPointerDown={() => {
            held.current = true;
            pause();
          }}
          onPointerUp={() => {
            held.current = false;
            run();
          }}
          onPointerCancel={() => {
            held.current = false;
            run();
          }}
          onFocus={() => {
            focusInside.current = true;
            pause();
          }}
          onBlur={(e) => {
            if (e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget)) return;
            focusInside.current = false;
            if (kbd) remaining.current = UNDO_TOAST_MS;
            run();
          }}
          data-testid="undo-toast"
        >
          <span className="tt">{view.text}</span>
          <button
            ref={action}
            type="button"
            className="tu"
            onClick={() => {
              const hadFocus = box.current?.contains(document.activeElement) === true;
              window.clearTimeout(timer.current);
              timer.current = 0;
              onAction(hadFocus);
            }}
            data-testid="undo-toast-action"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
