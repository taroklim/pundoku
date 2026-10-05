/**
 * Обвинение Лжеца (PD-171, визуал v2 п. 6): долгое нажатие на подсказку открывает контекстное меню с ОДНИМ пунктом «Обвинить» —
 * не мгновенное действие (долгое нажатие на iOS = контекстное меню; путь назад — тап мимо/Esc). Печать «сургуч» — после пункта.
 *
 * Визуальный язык — контекстное меню строки режима (PD-167, `ModeMenu`): размытый фон, нажатая клетка «поднята» над ним
 * копией без действий, меню под ней (или над, если не помещается). Заголовок меню — что именно обвиняем и что будет, если
 * подсказка честная (без штрафа). Хвост открывшего жеста не нажимает пункт (как `ModeMenu`).
 *
 * Тот же компонент открывают «⋯ → Обвинить подсказку» и клавиша A (выбранная подсказка): путь для VoiceOver/клавиатуры.
 */
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModal } from "../shell/useModal";

export interface AccuseMenuProps {
  /** Клетка-подсказка: номер и показанная цифра (то, что игрок и так видит на поле). */
  readonly cell: number;
  readonly digit: number;
  /** Где клетка на экране (getBoundingClientRect в момент открытия). */
  readonly anchor: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number; readonly height: number };
  readonly onAccuse: () => void;
  readonly onClose: () => void;
  readonly returnFocus: RefObject<HTMLElement | null>;
}

const GAP = 8;

export function AccuseMenu({ cell, digit, anchor, onAccuse, onClose, returnFocus }: AccuseMenuProps) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const [pos, setPos] = useState<{ top: number } | null>(null);
  // Фокус — только когда меню стало видимым (до позиционирования оно visibility:hidden, PD-182).
  useModal(scrim, root, { kind: "menu", onClose, returnFocus, initialFocus: '[role="menuitem"]', ready: pos !== null });
  const where = { row: Math.floor(cell / 9) + 1, col: (cell % 9) + 1 };

  useLayoutEffect(() => {
    const h = root.current?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    const below = anchor.bottom + GAP;
    const top = below + h <= vh - GAP ? below : Math.max(GAP, anchor.top - h - GAP);
    setPos({ top });
  }, [anchor]);

  return createPortal(
    <div
      ref={scrim}
      className="menu-scrim ctx-scrim"
      onPointerDown={() => {
        armed.current = true;
      }}
      onClick={(e) => {
        if (e.detail !== 0 && !armed.current) return; // хвост долгого нажатия
        onClose();
      }}
      data-testid="accuse-scrim"
    >
      <div className="ctx-lift liar-lift" style={{ top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height }} aria-hidden="true">
        <span className="d given">{digit}</span>
      </div>
      <div
        ref={root}
        className="menu ctx-menu"
        role="menu"
        aria-label={t("liar.menuLabel", { digit, ...where })}
        tabIndex={-1}
        style={{ top: pos?.top ?? anchor.bottom + GAP, visibility: pos ? "visible" : "hidden", maxHeight: `calc(100dvh - ${GAP * 2}px)` }}
        onClick={(e) => e.stopPropagation()}
        data-testid="accuse-menu"
      >
        <p className="mt" data-testid="accuse-desc">
          {t("liar.menuDesc", { digit, ...where })}
        </p>
        <button
          type="button"
          role="menuitem"
          className="accuse-item"
          onClick={(e) => {
            if (e.detail !== 0 && !armed.current) return; // палец, отпущенный над пунктом, — хвост открывшего жеста
            onClose();
            onAccuse();
          }}
          data-testid="accuse-confirm"
        >
          <SealGlyph />
          <span className="mi">{t("liar.accuse")}</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Печать: круг с точкой (контур 1.7, как значки меню). */
export function SealGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}
