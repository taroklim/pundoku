import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "../play/controls";
import type { DayStore } from "./dayStore";
import { lastMoveCell } from "./dayStore";

/** Длительности M5 (`design/pd7-board-critique.md`, таблица M5): всего ≤ 600 мс. */
export const M5_DIM_MS = 200;
export const M5_DIM_REDUCED_MS = 140;
export const M5_FLIGHT_MS = 340;
export const M5_EASING = "cubic-bezier(.34,.9,.2,1)";

export interface SolveSequence {
  /** Карточка дня (и Grid ∞) уже показаны. */
  cardShown: boolean;
  /** Приземление в этой сессии дошло до конца — кольцо клетки даёт «толчок» (иначе просто сплошное). */
  flown: boolean;
}

/**
 * M5 «улёт» последней клетки (PD-12): данные гаснут → карточка дня → цифра клетки дня летит с поля
 * в целевую клетку Grid ∞ → приземление. Полное время ≤ 600 мс (200 + 340); ЛЮБОЕ касание
 * прерывает и сразу показывает конечное состояние. Reduced motion — без полёта: данные гаснут
 * 140 мс, карточка и кроссфейд, целевая клетка подсвечивается кольцом (`ringIn`).
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

    timer = window.setTimeout(
      () => {
        flushSync(() => setCardShown(true));
        const landing = store.getSnapshot().landing;
        const dstEl = root.current?.querySelector<HTMLElement>('[data-testid="grid-inf-target"]');
        if (!landing || !dstEl) return finish(false);
        if (reduce) return finish(true);
        // Доводим место посадки до экрана ДО замера; сам скролл мгновенный.
        dstEl.scrollIntoView({ block: "center", behavior: "auto" });
        const dst = dstEl.getBoundingClientRect();
        if (!srcRect) return finish(true);
        flyer = document.createElement("span");
        flyer.className = "flyer";
        flyer.textContent = String(landing.digit);
        flyer.style.width = `${srcRect.width}px`;
        flyer.style.height = `${srcRect.height}px`;
        flyer.style.fontSize = `${Math.round(srcRect.width * 0.56)}px`;
        document.body.appendChild(flyer);
        anim = flyer.animate(
          [
            { transform: `translate(${srcRect.left}px, ${srcRect.top}px) scale(1)`, opacity: 1 },
            { transform: `translate(${dst.left}px, ${dst.top}px) scale(.94)`, opacity: 1 },
          ],
          { duration: M5_FLIGHT_MS, easing: M5_EASING, fill: "forwards" },
        );
        anim.onfinish = () => finish(true);
      },
      reduce ? M5_DIM_REDUCED_MS : M5_DIM_MS,
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
