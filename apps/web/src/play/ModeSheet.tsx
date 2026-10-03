/**
 * Шит «Режим» хаба Play (PD-144): два варианта с описаниями — Классика и Чернила. Выбор действует сразу, «Готово»
 * закрывает. Выбор Чернил при выключенных — шит правила PD-74 «Ink doesn’t lift» ПОВЕРХ этого шита (необратимость режима
 * объясняется до выбора). Скроллится только список вариантов (`.sheet-scroll`), ручка, заголовок и «Готово» — `flex:none`;
 * последний элемент прокрутки — липкая растушёвка `.scroll-fade`.
 */
import type { KeyboardEvent, RefObject } from "react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModal } from "../shell/useModal";
import { useSheetSwipe } from "../shell/useSheetSwipe";
import { CheckGlyph } from "./hubIcons";
import { InkRuleSheet } from "./InkEntry";

export interface ModeSheetProps {
  readonly ink: boolean;
  readonly onPick: (ink: boolean) => void;
  readonly onClose: () => void;
  /** Строка «Режим» в хабе: туда возвращается фокус. */
  readonly returnFocus: RefObject<HTMLElement | null>;
}

export function ModeSheet({ ink, onPick, onClose, returnFocus }: ModeSheetProps) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const [rule, setRule] = useState(false);
  const ruleOpen = useRef(false);
  ruleOpen.current = rule;
  const titleId = useId();
  const swipe = useSheetSwipe(root, onClose);
  useModal(scrim, root, { kind: "dialog", onClose, returnFocus, initialFocus: '[role="radio"][aria-checked="true"]', suspended: () => ruleOpen.current });

  const options = [
    { ink: false, name: t("play.hub.modeClassic"), desc: t("play.hub.modeClassicSub"), testid: "mode-classic" },
    { ink: true, name: t("play.hub.modeInk"), desc: t("play.hub.modeInkSub"), testid: "mode-ink" },
  ] as const;

  const choose = (wantInk: boolean) => {
    if (wantInk === ink) return;
    if (wantInk) setRule(true);
    else onPick(false);
  };
  // Радиогруппа: стрелки только переносят фокус (выбор — тапом/Enter/пробелом: Чернила спрашивают подтверждение правилом).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(e.key)) return;
    const items = [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    items[(at + step + items.length) % items.length]!.focus();
  };

  return (
    <>
      {createPortal(
        <div ref={scrim} className="sheet-scrim" onClick={onClose} data-testid="mode-sheet-scrim">
          <section ref={root} className="mode-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid="mode-sheet">
            <div className="grabber sheet-handle" aria-hidden="true" {...swipe} />
            <h2 id={titleId} className="sheet-handle" {...swipe}>
              {t("ink.rowMode")}
            </h2>
            <div ref={group} className="sheet-scroll" role="radiogroup" aria-labelledby={titleId} onKeyDown={onKeyDown}>
              {options.map((o) => (
                <button
                  key={o.testid}
                  type="button"
                  className="mode-opt"
                  role="radio"
                  aria-checked={o.ink === ink}
                  tabIndex={o.ink === ink ? 0 : -1}
                  onClick={() => choose(o.ink)}
                  data-testid={o.testid}
                >
                  <span className="mt">{o.name}</span>
                  <span className="ck">
                    <CheckGlyph />
                  </span>
                  <span className="md">{o.desc}</span>
                </button>
              ))}
              <div className="scroll-fade" aria-hidden="true" />
            </div>
            <button type="button" className="hub-primary" onClick={onClose} data-testid="mode-done">
              {t("play.hub.done")}
            </button>
          </section>
        </div>,
        document.body,
      )}
      {rule && (
        <InkRuleSheet
          onStart={() => {
            setRule(false);
            onPick(true);
          }}
          onCancel={() => setRule(false)}
        />
      )}
    </>
  );
}
