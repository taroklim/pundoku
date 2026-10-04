/**
 * Контекстное меню строки режима (PD-167, решение 7 макета PD-163, кадры wk-C-ctx-*): долгое нажатие / правая кнопка /
 * клавиша контекстного меню на строке хаба. Заголовок меню — описание режима (слот заголовка системного контекстного меню),
 * пункты: «Продолжить» (если есть незавершённая игра) и «Новая сетка…» (шит режима; при незавершённой — с предупреждением).
 * Нажатая строка «поднимается» над размытием (копия без действий, как превью iOS). Ускоритель, а не единственный путь:
 * новую сетку при незавершённой можно начать и из партии («⋯ → Новая сетка»).
 *
 * Хвост открывшего жеста: палец, отпущенный уже над пунктом меню, не нажимает его — пока внутри меню не началось НОВОЕ
 * нажатие, указательные click'и игнорируются (клавиатурные, `detail === 0`, проходят) — как `guardTail` у ActionSheet.
 */
import type { ReactNode, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModal } from "../shell/useModal";
import { NewGridGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import type { ModeDef } from "./modes";

export interface ModeMenuProps {
  readonly mode: ModeDef;
  /** Где на экране строка (getBoundingClientRect в момент открытия). */
  readonly anchor: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number; readonly height: number };
  /** Копия строки над затемнением. */
  readonly preview: ReactNode;
  readonly canContinue: boolean;
  readonly onContinue: () => void;
  readonly onNew: () => void;
  readonly onClose: () => void;
  readonly returnFocus: RefObject<HTMLElement | null>;
}

const GAP = 8;

export function ModeMenu({ mode, anchor, preview, canContinue, onContinue, onNew, onClose, returnFocus }: ModeMenuProps) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const [pos, setPos] = useState<{ top: number } | null>(null);
  useModal(scrim, root, { kind: "menu", onClose, returnFocus, initialFocus: '[role="menuitem"]' });

  // Под строкой, если помещается; иначе над ней; в крайнем случае — прижато к верху (меню само прокручивается).
  useLayoutEffect(() => {
    const h = root.current?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    const below = anchor.bottom + GAP;
    const top = below + h <= vh - GAP ? below : Math.max(GAP, anchor.top - h - GAP);
    setPos({ top });
  }, [anchor]);

  const guard = (fn: () => void) => (e: React.MouseEvent) => {
    if (e.detail !== 0 && !armed.current) return; // хвост долгого нажатия
    fn();
  };

  return createPortal(
    <div
      ref={scrim}
      className="menu-scrim ctx-scrim"
      onPointerDown={() => {
        armed.current = true;
      }}
      onClick={(e) => {
        if (e.detail !== 0 && !armed.current) return;
        onClose();
      }}
      data-testid="ctx-scrim"
    >
      <div className="ctx-lift" style={{ top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height }} aria-hidden="true">
        {preview}
      </div>
      <div
        ref={root}
        className="menu ctx-menu"
        role="menu"
        aria-label={t(`modes.${mode.textKey}.name`)}
        tabIndex={-1}
        style={{ top: pos?.top ?? anchor.bottom + GAP, visibility: pos ? "visible" : "hidden", maxHeight: `calc(100dvh - ${GAP * 2}px)` }}
        onClick={(e) => e.stopPropagation()}
        data-testid="ctx-menu"
      >
        <p className="mt" data-testid="ctx-desc">
          {t(`modes.${mode.textKey}.desc`)}
        </p>
        {canContinue && (
          <button
            type="button"
            role="menuitem"
            onClick={guard(() => {
              onClose();
              onContinue();
            })}
            data-testid="ctx-continue"
          >
            <ChevronIcon />
            <span className="mi">{t("modes.continue")}</span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={guard(() => {
            onClose();
            onNew();
          })}
          data-testid="ctx-new"
        >
          <NewGridGlyph />
          <span className="mi">{t("modes.newPuzzle")}</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
