/**
 * Контекстное меню строки режима (PD-167, решение 7 макета PD-163, кадры wk-C-ctx-*): долгое нажатие / правая кнопка /
 * клавиша контекстного меню на строке хаба. Заголовок меню — описание режима (слот заголовка системного контекстного меню),
 * пункты: «Продолжить» (если есть незавершённая игра) и «Новая сетка…» (шит режима; при незавершённой — с предупреждением).
 * PD-225: при незавершённой игре последним пунктом — «Удалить сетку» красным, отделённый толстым разделителем (HIG
 * `context-menus.md`: деструктивное — в конце и красным); это путь удаления без жеста (§A8 design/pd224-swipe-gestures.md).
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
import { NewGridGlyph, TrashGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import type { ModeDef } from "./modes";
import { fixedOrigin, menuLeftInLayer, usePortalHost } from "../shell/portalHost";

export interface ModeMenuProps {
  readonly mode: ModeDef;
  /** Где на экране строка (getBoundingClientRect в момент открытия). */
  readonly anchor: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number; readonly height: number };
  /** Копия строки над затемнением. */
  readonly preview: ReactNode;
  readonly canContinue: boolean;
  readonly onContinue: () => void;
  readonly onNew: () => void;
  /** PD-225: «Удалить сетку» (только при незавершённой игре; `kbd` — выбран с клавиатуры/AT, фокус уйдёт на «Отменить»). */
  readonly onDelete?: (kbd: boolean) => void;
  readonly onClose: () => void;
  readonly returnFocus: RefObject<HTMLElement | null>;
}

const GAP = 8;

export function ModeMenu({ mode, anchor, preview, canContinue, onContinue, onNew, onDelete, onClose, returnFocus }: ModeMenuProps) {
  const portalHost = usePortalHost();
  const inLayer = portalHost !== document.body;
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const lift = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  // Координаты — окна; `ox`/`oy` — начало отсчёта fixed-потомков затемнения (PD-290, `fixedOrigin`), на них сдвигаются копия и меню.
  const [pos, setPos] = useState<{ top: number; left?: number; ox: number; oy: number } | null>(null);
  // Фокус — только когда меню стало видимым (до позиционирования оно visibility:hidden, PD-182).
  useModal(scrim, root, { kind: "menu", onClose, returnFocus, initialFocus: '[role="menuitem"]', ready: pos !== null });

  // Под строкой, если помещается; иначе над ней; в крайнем случае — прижато к верху (меню само прокручивается).
  useLayoutEffect(() => {
    const h = root.current?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    const below = anchor.bottom + GAP;
    const top = below + h <= vh - GAP ? below : Math.max(GAP, anchor.top - h - GAP);
    // PD-290: в слое окна десктопа C меню не шире 320 — по горизонтали у якоря (на телефоне — во всю ширину, как было).
    const area = inLayer ? scrim.current?.getBoundingClientRect().left : undefined;
    const left = area !== undefined && root.current ? menuLeftInLayer(anchor.left, root.current.offsetWidth, area, window.innerWidth) : undefined;
    const { x: ox, y: oy } = fixedOrigin(lift.current);
    setPos(left === undefined ? { top, ox, oy } : { top, left, ox, oy });
  }, [anchor, inLayer]);

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
      <div
        ref={lift}
        className="ctx-lift"
        style={{ top: anchor.top - (pos?.oy ?? 0), left: anchor.left - (pos?.ox ?? 0), width: anchor.width, height: anchor.height }}
        aria-hidden="true"
      >
        {preview}
      </div>
      <div
        ref={root}
        className="menu ctx-menu"
        role="menu"
        aria-label={t(`modes.${mode.textKey}.name`)}
        tabIndex={-1}
        style={{ top: pos ? pos.top - pos.oy : anchor.bottom + GAP, ...(pos?.left === undefined ? null : { left: pos.left - pos.ox }), visibility: pos ? "visible" : "hidden", maxHeight: `calc(100dvh - ${GAP * 2}px)` }}
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
        {canContinue && onDelete && (
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={(e) => {
              if (e.detail !== 0 && !armed.current) return; // хвост долгого нажатия
              onClose();
              onDelete(e.detail === 0);
            }}
            data-testid="ctx-delete"
          >
            <TrashGlyph />
            <span className="mi">{t("modes.deleteItem")}</span>
          </button>
        )}
      </div>
    </div>,
    portalHost,
  );
}
