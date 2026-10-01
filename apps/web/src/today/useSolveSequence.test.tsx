// @vitest-environment jsdom
// Финал V2 (PD-89): dim 240 -> карточка -> пауза 60 -> полёт 300 мс (итого ~600); тап прерывает; reduced — без полёта.
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlay, enterDigit } from "../play/logic";
import type { PlayState } from "../play/logic";
import {
  FINALE_DIM_MS,
  FINALE_DIM_REDUCED_MS,
  FINALE_FLIGHT_DELAY_MS,
  FINALE_FLIGHT_MS,
  useSolveSequence,
  type SolveSequence,
} from "./useSolveSequence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

function lastMovePlay(): PlayState {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  for (let i = 0; i < 81; i++) if (!p.mission[i]) p = enterDigit(p, i, p.solution[i] as number, i + 1);
  return p;
}

const play = lastMovePlay();
const acknowledgeLanding = vi.fn();
const store = {
  getSnapshot: () => ({ play, landing: { cell: 5, digit: 7 } }) as never,
  acknowledgeLanding,
};

let latest: SolveSequence;
function Harness({ phase }: { phase: string }) {
  const root = useRef<HTMLDivElement>(null);
  latest = useSolveSequence(phase, store, root);
  return (
    <div ref={root}>
      <div className="board">
        <i data-i={String(play.log[play.log.length - 1]!.cell)} />
      </div>
      <i data-testid="grid-inf-target" />
    </div>
  );
}

let host: HTMLDivElement;
let reactRoot: Root;
let animate: ReturnType<typeof vi.fn>;
let anim: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null };

function setReduced(reduced: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  acknowledgeLanding.mockClear();
  setReduced(false);
  anim = { cancel: vi.fn(), onfinish: null };
  animate = vi.fn(() => anim);
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const target = this.getAttribute("data-testid") === "grid-inf-target";
    const w = target ? 12 : 40;
    return { left: target ? 200 : 20, top: target ? 500 : 100, width: w, height: w, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
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
  vi.useRealTimers();
});

const solve = () => act(() => reactRoot.render(<Harness phase="solved" />));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("финал V2 (PD-89)", () => {
  it("тайминги в сумме ~600 мс", () => {
    expect(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS + FINALE_FLIGHT_MS).toBe(600);
    expect(FINALE_DIM_REDUCED_MS).toBeLessThan(FINALE_DIM_MS);
  });

  it("данные гаснут 240 мс, карточка, через 60 мс стартует полёт 300 мс по дуге с промежуточным кадром", () => {
    solve();
    expect(latest.cardShown).toBe(false);
    wait(FINALE_DIM_MS - 1);
    expect(latest.cardShown).toBe(false);
    wait(1);
    expect(latest.cardShown).toBe(true);
    expect(document.querySelector(".flyer")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    wait(FINALE_FLIGHT_DELAY_MS);
    expect(document.querySelector(".flyer")!.textContent).toBe("7");
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as [Array<{ offset: number; transform: string }>, { duration: number }];
    expect(opts.duration).toBe(FINALE_FLIGHT_MS);
    expect(frames.map((f) => f.offset)).toEqual([0, 0.55, 1]);
    // только transform/opacity
    expect(Object.keys(frames[1]!).sort()).toEqual(["offset", "opacity", "transform"]);
    expect(latest.flown).toBe(false);
    act(() => anim.onfinish?.());
    expect(document.querySelector(".flyer")).toBeNull();
    expect(latest.flown).toBe(true);
    expect(acknowledgeLanding).toHaveBeenCalledTimes(1);
  });

  it("тап прерывает в фазе dim: карточка сразу, полёта нет", () => {
    solve();
    wait(100);
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    expect(latest.cardShown).toBe(true);
    expect(latest.flown).toBe(false);
    wait(1000);
    expect(animate).not.toHaveBeenCalled();
    expect(acknowledgeLanding).toHaveBeenCalledTimes(1);
  });

  it("тап прерывает в полёте: цифра снимается, состояние конечное, анимация отменена", () => {
    solve();
    wait(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS + 100);
    expect(document.querySelector(".flyer")).not.toBeNull();
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    expect(document.querySelector(".flyer")).toBeNull();
    expect(anim.cancel).toHaveBeenCalled();
    expect(latest.cardShown).toBe(true);
    expect(acknowledgeLanding).toHaveBeenCalledTimes(1);
  });

  it("reduced motion: данные гаснут 140 мс, карточка, без летящей цифры (кольцо в Grid ∞ даёт flown)", () => {
    setReduced(true);
    solve();
    wait(FINALE_DIM_REDUCED_MS);
    expect(latest.cardShown).toBe(true);
    expect(latest.flown).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".flyer")).toBeNull();
  });

  it("экран, смонтированный на уже решённом дне, показывает карточку сразу, без анимации", () => {
    act(() => reactRoot.unmount());
    reactRoot = createRoot(host);
    act(() => reactRoot.render(<Harness phase="solved" />));
    expect(latest.cardShown).toBe(true);
    wait(1000);
    expect(animate).not.toHaveBeenCalled();
  });
});
