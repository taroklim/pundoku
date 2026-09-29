// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { ANNOUNCE_DEBOUNCE_MS, useCellsLeftAnnouncement, useClearEffectsOnUnmount } from "./controls";

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
