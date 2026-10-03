/**
 * Меню «⋯» в шапке партии Play (PD-144, вариант C, B-вход Fill). Кнопка с `aria-haspopup="menu"`, всплывающее меню — портал
 * в `<body>` (затемнение закрывает весь экран, включая таб-бар). Ровно два пункта в фиксированном порядке:
 * «Новая сетка» (на хаб, без подтверждения) и «Заполнить кандидатами» (без подтверждения).
 *
 * Недоступный пункт НЕ исчезает: он остаётся на месте с `aria-disabled="true"`, приглушён и объяснён строкой-причиной
 * («Недоступно в чернилах» / «Нечего заполнять»). Тап и Enter по нему ничего не делают; в круге фокуса он остаётся.
 */
import type { RefObject } from "react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModal } from "../shell/useModal";
import { GridGlyph, MoreIcon, NewGridGlyph } from "./hubIcons";

/** Что с пунктом «Заполнить кандидатами»: можно / недоступно в Ink / заполнять нечего. */
export type FillState = "ready" | "ink" | "empty";

export interface MoreMenuProps {
  readonly fill: FillState;
  readonly onNew: () => void;
  readonly onFill: () => void;
}

interface Anchor {
  readonly top: number;
}

export function MoreMenu({ fill, onNew, onFill }: MoreMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const open = anchor !== null;
  const close = () => setAnchor(null);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`more-btn${open ? " on" : ""}`}
        aria-label={t("play.hub.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          setAnchor({ top: Math.round((r?.bottom ?? 54) + 4) });
        }}
        data-testid="more-button"
      >
        <MoreIcon />
      </button>
      {anchor && createPortal(<Popup id={menuId} top={anchor.top} fill={fill} returnFocus={btn} onClose={close} onNew={onNew} onFill={onFill} />, document.body)}
    </>
  );
}

function Popup({
  id,
  top,
  fill,
  returnFocus,
  onClose,
  onNew,
  onFill,
}: MoreMenuProps & { id: string; top: number; returnFocus: RefObject<HTMLElement | null>; onClose: () => void }) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useModal(scrim, root, { kind: "menu", onClose, returnFocus, initialFocus: '[role="menuitem"]' });
  const blocked = fill !== "ready";
  const why = fill === "ink" ? t("play.hub.fillInkOff") : fill === "empty" ? t("play.hint.fillNone") : null;
  return (
    <div ref={scrim} className="menu-scrim" onClick={onClose} data-testid="more-scrim">
      <div
        ref={root}
        id={id}
        className="menu"
        role="menu"
        aria-label={t("play.hub.more")}
        tabIndex={-1}
        style={{ top, maxHeight: `calc(100dvh - ${top}px - 8px)` }}
        onClick={(e) => e.stopPropagation()}
        data-testid="more-menu"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onNew();
          }}
          data-testid="menu-new"
        >
          <NewGridGlyph />
          <span>{t("play.newPuzzle")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          aria-disabled={blocked}
          onClick={() => {
            if (blocked) return; // недоступный пункт: тап и Enter ничего не делают, меню остаётся
            onClose();
            onFill();
          }}
          data-testid="menu-fill"
        >
          <GridGlyph />
          <span className="mi">
            <span>{t("play.fillAction")}</span>
            {why && (
              <span className="why" data-testid="menu-fill-why">
                {why}
              </span>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
