/**
 * Меню «⋯» в шапке партии Play (PD-144, вариант C, B-вход Fill). Кнопка с `aria-haspopup="menu"`, всплывающее меню — портал
 * в `<body>` (затемнение закрывает весь экран, включая таб-бар). Два пункта в фиксированном порядке:
 * «Новая сетка» (на хаб, без подтверждения) и «Заполнить кандидатами» (без подтверждения). PD-171: в партии Лжеца до поимки —
 * третий, «Обвинить подсказку…» (открывает то же меню-подтверждение, что долгое нажатие; путь для VoiceOver и клавиатуры).
 *
 * PD-203: в партии Мелодии — пункт «Звук» с галочкой (`menuitemcheckbox`) под разделителем (макет PD-202, вариант C).
 *
 * Недоступный пункт НЕ исчезает: он остаётся на месте с `aria-disabled="true"`, приглушён и объяснён строкой-причиной
 * («Недоступно в чернилах» / «Нечего заполнять»). Тап и Enter по нему ничего не делают; в круге фокуса он остаётся.
 */
import type { RefObject } from "react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModal } from "../shell/useModal";
import { CheckIcon, SpeakerIcon } from "../melody/icons";
import { SealGlyph } from "./AccuseMenu";
import { GridGlyph, MoreIcon, NewGridGlyph } from "./hubIcons";

/** Что с пунктом «Заполнить кандидатами»: можно / недоступно в Ink / заполнять нечего. */
export type FillState = "ready" | "ink" | "empty";

/** PD-171: пункт «Обвинить подсказку…» — можно (выбрана необвинённая подсказка) / выберите подсказку / эта уже обвинена. */
export type AccuseState = "ready" | "pick" | "accused";

export interface MoreMenuProps {
  readonly fill: FillState;
  readonly onNew: () => void;
  readonly onFill: () => void;
  /** PD-171: партия Лжеца до поимки — пункт «Обвинить подсказку…»; нет — пункта нет. */
  readonly accuse?: { readonly state: AccuseState; readonly onAccuse: () => void } | null;
  /** PD-203: партия Мелодии — пункт «Звук» (вкл/выкл, настройка устройства); нет — пункта нет. */
  readonly sound?: { readonly on: boolean; readonly onToggle: () => void } | null;
}

interface Anchor {
  readonly top: number;
}

export function MoreMenu({ fill, onNew, onFill, accuse = null, sound = null }: MoreMenuProps) {
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
      {anchor && createPortal(<Popup id={menuId} top={anchor.top} fill={fill} accuse={accuse} sound={sound} returnFocus={btn} onClose={close} onNew={onNew} onFill={onFill} />, document.body)}
    </>
  );
}

function Popup({
  id,
  top,
  fill,
  accuse,
  sound,
  returnFocus,
  onClose,
  onNew,
  onFill,
}: MoreMenuProps & { id: string; top: number; returnFocus: RefObject<HTMLElement | null>; onClose: () => void }) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useModal(scrim, root, { kind: "menu", onClose, returnFocus, initialFocus: '[role="menuitem"], [role="menuitemcheckbox"]' });
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
        {accuse && (
          <button
            type="button"
            role="menuitem"
            aria-disabled={accuse.state !== "ready"}
            onClick={() => {
              if (accuse.state !== "ready") return;
              onClose();
              accuse.onAccuse();
            }}
            data-testid="menu-accuse"
          >
            <SealGlyph />
            <span className="mi">
              <span>{t("liar.menuItem")}</span>
              {accuse.state !== "ready" && (
                <span className="why" data-testid="menu-accuse-why">
                  {t(accuse.state === "pick" ? "liar.whyPick" : "liar.whyAccused")}
                </span>
              )}
            </span>
          </button>
        )}
        {sound && (
          <>
            <div className="menu-sep" role="separator" />
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={sound.on}
              aria-label={t("melody.sound")}
              onClick={() => {
                onClose();
                sound.onToggle();
              }}
              data-testid="menu-sound"
            >
              <SpeakerIcon />
              <span className="mi">
                <span>{t("melody.sound")}</span>
              </span>
              <CheckIcon className={`ck${sound.on ? "" : " off"}`} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
