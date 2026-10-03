import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { hintStepCopy } from "./hintCopy";
import type { HintLadder, HintLadderState } from "./hintStore";
import { HINT_STEPS } from "./hintModel";

export const HINT_DOCK_ID = "hint-dock";

interface HintDockProps {
  ladder: Pick<HintLadder, "next" | "close">;
  state: HintLadderState;
  /** Play: подвал «Эта партия отмечена…»; Today/архив: «Этот день отмечен…». */
  play?: boolean;
  /** Док на нескроллящемся экране партии (Play, Today, архив): страницу не двигаем. По умолчанию — как `play`. */
  fit?: boolean;
}

/**
 * Док подсказки (макет PD-133 §4): занимает место панели 1–9, поле не двигается. Четыре ступени одного шага
 * («Ещё шаг» ведёт вниз, на четвёртой — «Понятно»), две ветки без лесенки — «ошибка на доске» и «ничего не нашёл» (только
 * «Закрыть»). Цифра шага не печатается ни на одной ступени — тексты собирает `hintCopy.ts`, которому цифру не передают.
 *
 * a11y: `role="group"`; при каждом новом открытии фокус уходит на скрытый заголовок (`tabIndex=-1`), статичный «Hint»;
 * тело ступени — `role="status"` (`aria-live="polite"`, `aria-atomic`), так что «Ещё шаг» можно нажимать подряд, не теряя
 * фокуса: озвучивается «Шаг 3 из 4. …». Видимый счётчик — `aria-hidden`: его дубль уже в live-регионе. `→` / `Enter` на
 * самом доке — следующая ступень; `Esc` и `H` обрабатывает `handleGameKey` (controls.tsx).
 */
export function HintDock({ ladder, state, play = false, fit = play }: HintDockProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const dock = useRef<HTMLElement>(null);
  const { hint, step, session } = state;

  // Новое открытие дока (в т.ч. пересчёт после хода — это та же сессия, фокус не дёргаем).
  useEffect(() => {
    if (!state.open) return;
    heading.current?.focus({ preventScroll: true });
    // Док выше свободного места (iPhone SE): показать целиком; там, где он помещается, прокрутки нет — поле не двигается.
    // PD-144: экран партии Play НЕ прокручивается никогда (`overflow:hidden` скроллится и скриптом — это и был D2 «док
    // докручивает страницу»): там док сам сжимается и прокручивает текст внутри себя, а страницу не трогаем.
    if (!fit) dock.current?.scrollIntoView?.({ block: "nearest" });
  }, [session, state.open, fit]);

  // Новая ступень: текст начинается сверху (на AX3 док скроллится внутри себя, кнопка внизу — ступень не должна открываться «с середины»).
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measureMore = useCallback(() => {
    const el = scroller.current;
    if (el) setMore(el.scrollHeight - el.clientHeight > 1 && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);
  useEffect(() => {
    if (dock.current) dock.current.scrollTop = 0;
    if (scroller.current) scroller.current.scrollTop = 0;
    measureMore();
  }, [step, hint?.kind, state.open, measureMore]);
  // Док меняет высоту вместе с экраном (поворот, Dynamic Type): пересчитать, есть ли что дочитывать.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measureMore);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureMore, state.open]);

  const copy = useMemo(() => (hint ? hintStepCopy(t, hint, step, play) : null), [t, hint, step, play]);
  if (!state.open || !hint || !copy) return null;

  const branch = hint.kind !== "step";
  const lastStep = !branch && step >= HINT_STEPS;
  const counter = hint.kind === "mistake" ? t("hint.bad.step") : hint.kind === "none" ? t("hint.none.step") : t("hint.step", { n: step });
  const foot = copy.foot ?? (hint.kind === "none" ? null : t(play ? "hint.footPlay" : "hint.foot"));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Только когда фокус на самом доке (заголовок): на кнопках Enter — их собственный click.
    if (e.target !== heading.current || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      if (!branch) ladder.next();
    }
  };

  return (
    <section
      ref={dock}
      id={HINT_DOCK_ID}
      className={`hint-dock${hint.kind === "mistake" ? " bad" : ""}`}
      role="group"
      aria-label={t("hint.button")}
      onKeyDown={onKeyDown}
      data-testid="hint-dock"
      data-kind={hint.kind}
      data-step={step}
    >
      <h2 ref={heading} className="sr-only" tabIndex={-1}>
        {t("hint.button")}
      </h2>
      <div className="hint-top">
        <span className="hint-step" aria-hidden="true" data-testid="hint-step">
          {counter}
        </span>
        <button type="button" className="hint-close" onClick={() => ladder.close()} data-testid="hint-close">
          {t("hint.close")}
        </button>
      </div>
      {/* Текст ступени + ключ значков: на экране партии Play это единственная прокручиваемая часть дока (кнопки вне неё всегда
          видны); `data-more` — под нижней кромкой ещё есть текст (затухание, PD-144 D-1). Тут и на Today вёрстка прежняя. */}
      <div ref={scroller} className="hint-scroll" data-more={more ? "1" : undefined} onScroll={measureMore}>
        <div role="status" aria-live="polite" aria-atomic="true" className="hint-live" data-testid="hint-live">
          <span className="sr-only">{counter}. </span>
          <h3 className="hint-title" data-testid="hint-title">
            {copy.title}
          </h3>
          <p className="hint-body" data-testid="hint-body">
            {copy.body}
          </p>
        </div>
        {copy.key.length > 0 && (
          <p className="hint-key" data-testid="hint-key">
            {copy.key.map((k) => (
              <span key={k.kind} data-kind={k.kind}>
                <i className={`g-${k.kind}`} aria-hidden="true" />
                {k.label}
              </span>
            ))}
          </p>
        )}
      </div>
      {/* Ветки без лесенки (ошибка, «не нашёл») несут только «Закрыть» — второй, крупной кнопкой, как в макете. */}
      <button type="button" className={`hint-more${lastStep ? " quiet" : ""}`} onClick={() => (branch ? ladder.close() : ladder.next())} data-testid="hint-more">
        {branch ? t("hint.close") : lastStep ? t("hint.done") : t("hint.more")}
      </button>
      {foot && (
        <p className="hint-foot" data-testid="hint-foot">
          {hint.kind !== "none" && <i className="hint-mark" aria-hidden="true" />}
          {foot}
        </p>
      )}
    </section>
  );
}
