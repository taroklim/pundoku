// @vitest-environment jsdom
// Финал V2 (PD-89): dim 240 -> карточка -> пауза 60 -> полёт 300 мс (итого ~600); тап прерывает; reduced — без полёта.
// PD-95: Grid ∞ монтируется СЛЕДОМ за карточкой (после кадра), полёт стартует после кадра с Grid ∞; фокус — по finaleDone;
// ни одного чтения раскладки до таймера (нет форсированного layout в задаче коммита решённой партии).
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
const onWatch = vi.fn();
let landing: { cell: number; digit: number } | null = { cell: 5, digit: 7 };
const store = {
  getSnapshot: () => ({ play, landing }) as never,
  acknowledgeLanding,
};
/** Один «кадр» тестового rAF (см. beforeEach): rAF 16 мс + setTimeout(0) после него. */
const FRAME_MS = 16;

let latest: SolveSequence;
function Harness({ phase }: { phase: string }) {
  const root = useRef<HTMLDivElement>(null);
  latest = useSolveSequence(phase, store, root);
  return (
    <div ref={root}>
      <div className="board">
        <i data-i={String(play.log[play.log.length - 1]!.cell)} />
      </div>
      {latest.gridShown && <i data-testid="grid-inf-target" />}
      {latest.cardShown && (
        <button type="button" data-testid="tl-watch" onClick={onWatch}>
          watch
        </button>
      )}
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
  landing = { cell: 5, digit: 7 };
  // rAF под управлением fake-таймеров: один кадр = 16 мс.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), FRAME_MS));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  acknowledgeLanding.mockClear();
  onWatch.mockClear();
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
  vi.unstubAllGlobals();
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
    wait(FINALE_FLIGHT_DELAY_MS - 1);
    expect(document.querySelector(".flyer")).toBeNull();
    wait(1);
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

  it("PD-95: карточка раньше Grid ∞ — сетка монтируется следующим кадром, цель полёта существует до вылета", () => {
    solve();
    wait(FINALE_DIM_MS);
    expect(latest.cardShown).toBe(true);
    expect(latest.gridShown).toBe(false);
    expect(host.querySelector('[data-testid="grid-inf-target"]')).toBeNull();
    wait(FRAME_MS); // rAF отработал, ждём «после кадра»
    wait(1);
    expect(latest.gridShown).toBe(true);
    expect(host.querySelector('[data-testid="grid-inf-target"]')).not.toBeNull();
    expect(document.querySelector(".flyer")).toBeNull(); // вылет — не раньше паузы 60 мс и кадра с Grid ∞
    wait(FINALE_FLIGHT_DELAY_MS);
    expect(document.querySelector(".flyer")).not.toBeNull();
  });

  it("PD-95: полёт не стартует, пока Grid ∞ не отрисован, даже если пауза 60 мс уже прошла", () => {
    // Медленное устройство: кадры приходят реже паузы — страховочный afterPaint (200 мс) ещё впереди.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 150));
    solve();
    wait(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS + 20);
    expect(latest.cardShown).toBe(true);
    expect(latest.gridShown).toBe(false);
    expect(document.querySelector(".flyer")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    wait(400);
    expect(document.querySelector(".flyer")).not.toBeNull();
  });

  it("PD-95: раскладка не читается до таймера (нет принудительного layout в задаче коммита), скролл цели — только после Grid ∞", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    solve();
    wait(FINALE_DIM_MS - 1);
    expect(rect).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    wait(1); // таймер: один замер источника (до записи карточки), цели ещё нет
    expect(rect).toHaveBeenCalledTimes(1);
    expect(scroll).not.toHaveBeenCalled();
    wait(FINALE_FLIGHT_DELAY_MS);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(rect).toHaveBeenCalledTimes(2); // цель
  });

  it("PD-95: фокус разрешается только в конце финала — не посреди полёта", () => {
    solve();
    wait(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS + 100);
    expect(document.querySelector(".flyer")).not.toBeNull();
    expect(latest.cardShown).toBe(true);
    expect(latest.finaleDone).toBe(false);
    act(() => anim.onfinish?.());
    expect(latest.finaleDone).toBe(true);
  });

  it("PD-95: тап в dim — карточка синхронно, Grid ∞ следующим кадром, финал закончен (фокус можно переводить)", () => {
    solve();
    wait(100);
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    expect(latest.cardShown).toBe(true);
    expect(latest.finaleDone).toBe(true);
    expect(latest.gridShown).toBe(false);
    wait(FRAME_MS + 1);
    expect(latest.gridShown).toBe(true);
    wait(1000);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".flyer")).toBeNull();
  });

  it("PD-95: тап между карточкой и Grid ∞ — Grid ∞ всё равно появляется, полёта нет", () => {
    solve();
    wait(FINALE_DIM_MS);
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    expect(latest.cardShown).toBe(true);
    wait(1000);
    expect(latest.gridShown).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(acknowledgeLanding).toHaveBeenCalledTimes(1);
  });

  it("PD-95: уход с экрана посреди последовательности отменяет отложенный монтаж и полёт", () => {
    solve();
    wait(FINALE_DIM_MS);
    act(() => reactRoot.render(<Harness phase="playing" />));
    wait(1000);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".flyer")).toBeNull();
    expect(latest.gridShown).toBe(false);
    expect(latest.cardShown).toBe(false);
  });

  it("PD-95: нечего сажать (архив: landing нет) — финал заканчивается сразу после карточки, Grid ∞ всё равно монтируется", () => {
    landing = null;
    solve();
    wait(FINALE_DIM_MS);
    expect(latest.cardShown).toBe(true);
    expect(latest.finaleDone).toBe(true);
    wait(1000);
    expect(animate).not.toHaveBeenCalled();
    expect(latest.gridShown).toBe(true);
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

  // PD-94: хвост прерывающего касания не должен нажать кнопку карточки под пальцем (tl-watch/share на Today).
  const tapOnWatch = (detail = 1) => {
    const b = host.querySelector('[data-testid="tl-watch"]')!;
    act(() => {
      b.dispatchEvent(new Event("pointerup", { bubbles: true }));
      b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
    });
  };

  it("тап-прерывание в dim: click того же касания над кнопкой таймлапса гасится (PD-94)", () => {
    solve();
    wait(100);
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    tapOnWatch();
    expect(onWatch).not.toHaveBeenCalled();
  });

  it("тап-прерывание в полёте: click того же касания гасится; следующий тап работает", () => {
    solve();
    wait(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS + 100);
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    tapOnWatch();
    expect(onWatch).not.toHaveBeenCalled();
    act(() => void host.querySelector('[data-testid="tl-watch"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    tapOnWatch();
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it("клавиатурная активация сразу после прерывания проходит (detail 0)", () => {
    solve();
    wait(100);
    act(() => void document.dispatchEvent(new Event("pointerdown")));
    tapOnWatch(0);
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it("финал дошёл до конца сам: последующий тап по кнопке без перехвата", () => {
    solve();
    wait(FINALE_DIM_MS + FINALE_FLIGHT_DELAY_MS);
    act(() => anim.onfinish?.()); // полёт дошёл до конца: слушатель снят, тапы обычные
    act(() => void host.querySelector('[data-testid="tl-watch"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    tapOnWatch();
    expect(onWatch).toHaveBeenCalledTimes(1);
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

  it("reduced motion: данные гаснут 140 мс, карточка, без летящей цифры (кольцо в Grid ∞ даёт flown — после его кадра)", () => {
    setReduced(true);
    solve();
    wait(FINALE_DIM_REDUCED_MS);
    expect(latest.cardShown).toBe(true);
    expect(latest.gridShown).toBe(false);
    wait(2 * (FRAME_MS + 1));
    expect(latest.gridShown).toBe(true);
    expect(latest.flown).toBe(true);
    expect(latest.finaleDone).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".flyer")).toBeNull();
  });

  it("экран, смонтированный на уже решённом дне, показывает карточку сразу, без анимации", () => {
    act(() => reactRoot.unmount());
    reactRoot = createRoot(host);
    act(() => reactRoot.render(<Harness phase="solved" />));
    expect(latest.cardShown).toBe(true);
    expect(latest.gridShown).toBe(true);
    expect(latest.finaleDone).toBe(true);
    wait(1000);
    expect(animate).not.toHaveBeenCalled();
  });
});
