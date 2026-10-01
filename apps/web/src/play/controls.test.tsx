// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { ANNOUNCE_DEBOUNCE_MS, StatusLine, useCellsLeftAnnouncement, useClearEffectsOnUnmount } from "./controls";
import { GamePad } from "./controls";
import { createPlay, enterDigit } from "./logic";
import type { PlaySnapshot } from "./gameStore";
import { MOTION_FLAGS, MOTION_MS } from "./motion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Live({ left, active }: { left: number; active: boolean }) {
  const text = useCellsLeftAnnouncement(left, active, 1);
  return <p data-testid="live">{text}</p>;
}
const live = () => host.querySelector("[data-testid=live]")!.textContent;
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("QA PD-23, Low 2: объявление «N cells left»", () => {
  it("озвучивается на пороге после debounce 600 мс", () => {
    act(() => root.render(<Live left={5} active />));
    expect(live()).toBe("");
    wait(ANNOUNCE_DEBOUNCE_MS - 1);
    expect(live()).toBe("");
    wait(1);
    expect(live()).toBe("5 cells left");
  });

  it("не озвучивает не-пороговые значения", () => {
    act(() => root.render(<Live left={17} active />));
    wait(2000);
    expect(live()).toBe("");
  });

  it("после решения регион очищается — «1 cell left» не остаётся", () => {
    act(() => root.render(<Live left={1} active />));
    wait(ANNOUNCE_DEBOUNCE_MS);
    expect(live()).toBe("1 cell left");
    act(() => root.render(<Live left={0} active={false} />));
    expect(live()).toBe("");
    wait(2000);
    expect(live()).toBe("");
  });
});

describe("QA PD-23, Low 1: сброс анимаций при размонтировании", () => {
  it("clearEffects вызывается при размонтировании экрана", () => {
    const clearEffects = vi.fn();
    function Screen() {
      useClearEffectsOnUnmount({ clearEffects });
      return null;
    }
    act(() => root.render(<Screen />));
    expect(clearEffects).not.toHaveBeenCalled();
    act(() => root.render(null));
    expect(clearEffects).toHaveBeenCalledTimes(1);
  });
});

describe("PD-89 M9: перекат «осталось N»", () => {
  const line = () => host.querySelector<HTMLElement>("[data-testid=status-line]")!;
  afterEach(() => {
    MOTION_FLAGS.statusRoll = true;
  });

  it("первый показ без анимации; смена числа ставит класс roll", () => {
    act(() => root.render(<StatusLine left={30} />));
    expect(line().className).toBe("status");
    expect(line().textContent).toBe("30 cells left");
    act(() => root.render(<StatusLine left={29} />));
    expect(line().className).toBe("status roll");
    expect(line().textContent).toBe("29 cells left");
  });

  it("повторный рендер с тем же числом (тик таймера) не перезапускает анимацию и не пересоздаёт узел", () => {
    act(() => root.render(<StatusLine left={30} />));
    act(() => root.render(<StatusLine left={29} />));
    const node = line();
    act(() => root.render(<StatusLine left={29} />));
    expect(line()).toBe(node);
    expect(line().className).toBe("status roll");
  });

  it("флаг MOTION_FLAGS.statusRoll = false отключает перекат целиком: число меняется молча, узел тот же", () => {
    MOTION_FLAGS.statusRoll = false;
    act(() => root.render(<StatusLine left={30} />));
    const node = line();
    act(() => root.render(<StatusLine left={29} />));
    expect(line()).toBe(node);
    expect(line().className).toBe("status");
    expect(line().textContent).toBe("29 cells left");
  });
});

describe("PD-89 M8: клавиша закрытой цифры", () => {
  const SOLUTION =
    "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
  const MISSION =
    "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
  let closed = createPlay({ mission: MISSION, solution: SOLUTION });
  for (let i = 0; i < 81; i++) if (!closed.mission[i] && closed.solution[i] === 5) closed = enterDigit(closed, i, 5, i + 1);
  const snap = (echo: PlaySnapshot["echo"]): PlaySnapshot =>
    ({ phase: "playing", difficulty: "medium", startedOn: new Date(0), play: closed, selected: 2, notesMode: false, pop: null, wave: null, echo }) as PlaySnapshot;
  const store = {} as never;
  const key5 = () => host.querySelectorAll<HTMLElement>(".key")[4]!;

  it("при echo остаток уходит вверх (kr out с --ed), клавиша приглушена; через keyOut класс снимается", () => {
    act(() => root.render(<GamePad snap={snap({ digit: 5, cells: [0], delay: 180, id: 1 })} store={store} />));
    expect(key5().classList.contains("done")).toBe(true);
    const kr = key5().querySelector<HTMLElement>(".kr")!;
    expect(kr.classList.contains("out")).toBe(true);
    expect(kr.style.getPropertyValue("--ed")).toBe("180");
    wait(MOTION_MS.keyOut);
    expect(key5().querySelector(".kr")!.classList.contains("out")).toBe(false);
    expect(key5().classList.contains("done")).toBe(true);
  });

  it("без echo (возврат на экран) уход не проигрывается", () => {
    act(() => root.render(<GamePad snap={snap(null)} store={store} />));
    expect(key5().querySelector(".kr")!.classList.contains("out")).toBe(false);
    expect(key5().classList.contains("done")).toBe(true);
  });
});
