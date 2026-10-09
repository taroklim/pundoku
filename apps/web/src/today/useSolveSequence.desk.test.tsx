// @vitest-environment jsdom
/**
 * PD-268: финал на десктопе C — Grid ∞ стоит в инспекторе рядом с полем. Экран сам к Grid ∞ не едет (pd229 §2 «без
 * автопрокрутки после решения»): цель видна в инспекторе — цифра летит к ней (как на телефоне, но без scrollIntoView); цель за
 * краем прокручиваемого инспектора (компакт, крупный текст) — без полёта и без прокрутки, кольцо посадки встаёт на место.
 * Телефон (Grid ∞ вне `.desk-insp`) — прежний scrollIntoView (useSolveSequence.test.tsx).
 */
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlay, enterDigit } from "../play/logic";
import type { PlayState } from "../play/logic";
import { FINALE_DIM_MS, FINALE_FLIGHT_DELAY_MS, useSolveSequence, type SolveSequence } from "./useSolveSequence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION = "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION = "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

function solvedPlay(): PlayState {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  for (let i = 0; i < 81; i++) if (!p.mission[i]) p = enterDigit(p, i, p.solution[i] as number, i + 1);
  return p;
}
const play = solvedPlay();
const store = { getSnapshot: () => ({ play, landing: { cell: 5, digit: 7 } }) as never, acknowledgeLanding: vi.fn() };

let latest: SolveSequence;
function Harness({ phase }: { phase: string }) {
  const root = useRef<HTMLDivElement>(null);
  latest = useSolveSequence(phase, store, root, true);
  return (
    <div ref={root} className="play desk-play">
      <div className="desk-stage">
        <div className="board">
          <i data-i={String(play.log[play.log.length - 1]!.cell)} />
        </div>
      </div>
      <aside className="desk-insp">{latest.gridShown && <i data-testid="grid-inf-target" />}</aside>
    </div>
  );
}

let host: HTMLDivElement;
let reactRoot: Root;
let animate: ReturnType<typeof vi.fn>;
let scrolled: ReturnType<typeof vi.fn>;
/** Где цель в окне (top). Инспектор — 0…800. */
let targetTop = 500;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  animate = vi.fn(() => ({ cancel: vi.fn(), pause: vi.fn(), onfinish: null }));
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled as never;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = (left: number, top: number, w: number, h: number) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON() {} }) as DOMRect;
    if (this.classList.contains("desk-insp")) return r(1000, 0, 280, 800);
    if (this.getAttribute("data-testid") === "grid-inf-target") return r(1100, targetTop, 16, 16);
    return r(300, 200, 60, 60);
  };
  host = document.createElement("div");
  document.body.append(host);
  reactRoot = createRoot(host);
  act(() => reactRoot.render(<Harness phase="playing" />));
});
afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  document.querySelectorAll(".flyer").forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const run = () => {
  act(() => reactRoot.render(<Harness phase="solved" />));
  act(() => void vi.advanceTimersByTime(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS + 64));
};

describe("PD-268: финал в инспекторе десктопа C", () => {
  it("цель видна в инспекторе — цифра летит из поля в Grid ∞, экран не прокручивается", () => {
    targetTop = 500;
    run();
    expect(latest.cardShown).toBe(true);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".flyer")!.textContent).toBe("7");
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("цель за краем прокручиваемого инспектора — без полёта и без прокрутки к Grid ∞; посадка засчитана", () => {
    targetTop = 900;
    run();
    expect(latest.cardShown).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(scrolled).not.toHaveBeenCalled();
    expect(latest.finaleDone).toBe(true);
    expect(latest.flown).toBe(true);
    expect(store.acknowledgeLanding).toHaveBeenCalled();
  });
});
