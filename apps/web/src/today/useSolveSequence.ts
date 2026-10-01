import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "../play/controls";
import type { DayStore } from "./dayStore";
import { lastMoveCell } from "./dayStore";

/**
 * Финал решённой сетки (PD-89, вариант V2 «Ритм», `design/pd81-motion-variants.md` §3): всего ≈600 мс.
 * Данные гаснут 240 мс → карточка → через 60 мс цифра летит 300 мс в Grid ∞. Заменяет прежний M5 (1050 мс не берём).
 */
export const FINALE_DIM_MS = 240;
export const FINALE_DIM_REDUCED_MS = 140;
export const FINALE_FLIGHT_DELAY_MS = 60;
export const FINALE_FLIGHT_MS = 300;
export const FINALE_EASING = "cubic-bezier(.3,0,.2,1)";

export interface SolveSequence {
  /** Карточка дня (и Grid ∞) уже показаны. */
  cardShown: boolean;
  /** Приземление в этой сессии дошло до конца — кольцо клетки даёт «толчок» (иначе просто сплошное). */
  flown: boolean;
}

/**
 * Финал «улёт» последней клетки (PD-12, тайминги V2 — PD-89): данные гаснут → карточка дня → цифра
 * клетки дня летит с поля в целевую клетку Grid ∞ → приземление. Полное время ≈600 мс (240 + 60 + 300);
 * ЛЮБОЕ касание прерывает в любой точке и сразу показывает конечное состояние. Reduced motion — без
 * полёта: данные гаснут 140 мс, карточка, целевая клетка подсвечивается кольцом (`ringIn`).
 *
 * `root` — контейнер экрана (поле и Grid ∞ ищутся внутри него). Экран, смонтированный уже на
 * решённом дне (возврат на вкладку/перезапуск), показывает всё сразу без анимации.
 */
export function useSolveSequence(
  phase: string,
  store: Pick<DayStore, "getSnapshot" | "acknowledgeLanding">,
  root: RefObject<HTMLElement | null>,
): SolveSequence {
  const [cardShown, setCardShown] = useState(() => phase === "solved");
  const [flown, setFlown] = useState(false);
  const prevPhase = useRef(phase);

  useEffect(() => {
    const from = prevPhase.current;
    prevPhase.current = phase;
    if (phase !== "solved") {
      setCardShown(false);
      setFlown(false);
      return;
    }
    if (cardShown) return; // смонтированы на решённом дне
    // Решённый день подгрузился из сохранённого (loading → solved): не «решили сейчас» — без анимации.
    if (from !== "playing") {
      setCardShown(true);
      return;
    }

    const reduce = prefersReducedMotion();
    const snap = store.getSnapshot();
    // Источник полёта — клетка последнего хода; замеряем, пока поле ещё на экране.
    const srcCell = snap.play ? lastMoveCell(snap.play) : null;
    const srcEl = srcCell === null ? null : root.current?.querySelector<HTMLElement>(`.board [data-i="${srcCell}"]`);
    const srcRect = srcEl?.getBoundingClientRect() ?? null;

    let timer = 0;
    let anim: Animation | null = null;
    let flyer: HTMLElement | null = null;
    let finished = false;

    const teardown = () => {
      window.clearTimeout(timer);
      anim?.cancel();
      flyer?.remove();
      anim = null;
      flyer = null;
      document.removeEventListener("pointerdown", onInterrupt, true);
    };
    const finish = (played: boolean) => {
      if (finished) return;
      finished = true;
      teardown();
      flushSync(() => {
        setCardShown(true);
        setFlown(played);
      });
      store.acknowledgeLanding();
    };
    function onInterrupt() {
      finish(false);
    }
    document.addEventListener("pointerdown", onInterrupt, true);

    const launch = () => {
      const landing = store.getSnapshot().landing;
      const dstEl = root.current?.querySelector<HTMLElement>('[data-testid="grid-inf-target"]');
      if (!landing || !dstEl) return finish(false);
      if (reduce) return finish(true);
      // Доводим место посадки до экрана ДО замера; сам скролл мгновенный.
      dstEl.scrollIntoView({ block: "center", behavior: "auto" });
      const dst = dstEl.getBoundingClientRect();
      if (!srcRect || !dst.width) return finish(true);
      flyer = document.createElement("span");
      flyer.className = "flyer";
      flyer.textContent = String(landing.digit);
      flyer.style.width = `${srcRect.width}px`;
      flyer.style.height = `${srcRect.height}px`;
      flyer.style.fontSize = `${Math.round(srcRect.width * 0.56)}px`;
      document.body.appendChild(flyer);
      // Центр цифры → центр целевой клетки; на подъёме (offset .55) дуга: 52 % по x, 30 % по y.
      const dx = dst.left + dst.width / 2 - (srcRect.left + srcRect.width / 2);
      const dy = dst.top + dst.height / 2 - (srcRect.top + srcRect.height / 2);
      const sc = Math.min(1, Math.max(0.12, dst.width / srcRect.width));
      const at = (x: number, y: number, k: number) => `translate(${srcRect.left + x}px, ${srcRect.top + y}px) scale(${k})`;
      try {
        anim = flyer.animate(
          [
            { transform: at(0, 0, 1), opacity: 1, offset: 0 },
            { transform: at(dx * 0.52, dy * 0.3, 1 + (sc - 1) * 0.35), opacity: 1, offset: 0.55 },
            { transform: at(dx, dy, sc), opacity: 0.9, offset: 1 },
          ],
          { duration: FINALE_FLIGHT_MS, easing: FINALE_EASING, fill: "forwards" },
        );
      } catch {
        return finish(true);
      }
      anim.onfinish = () => finish(true);
    };

    timer = window.setTimeout(
      () => {
        flushSync(() => setCardShown(true));
        if (reduce) return launch();
        // Короткая пауза между карточкой и вылетом цифры (ритм V2).
        timer = window.setTimeout(launch, FINALE_FLIGHT_DELAY_MS);
      },
      reduce ? FINALE_DIM_REDUCED_MS : FINALE_DIM_MS,
    );

    return () => {
      // Ушли с экрана/партию сменили посреди последовательности: без полёта, состояние — конечное.
      teardown();
      if (!finished) store.acknowledgeLanding();
    };
    // cardShown намеренно не в зависимостях: последовательность стартует один раз на переходе в solved.
  }, [phase, store, root]);

  return { cardShown, flown };
}
