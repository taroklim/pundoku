// @vitest-environment jsdom
/** PD-57: перехват ухода с Settings браузерным «назад»/hashchange, пока `guard` держит уход. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaveGuard, Route, Target } from "./tabs";
import { useRoute } from "./tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let route: Route;
let go: (t: Target) => void;

function Probe({ guard }: { guard?: LeaveGuard }) {
  [route, go] = useRoute(guard);
  return null;
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const mount = async (guard?: LeaveGuard) => {
  await act(async () => root.render(<Probe guard={guard} />));
};

beforeEach(async () => {
  window.history.replaceState(null, "", "#/today");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("useRoute: перехват ухода с Settings (PD-57)", () => {
  it("без guard «назад» из Settings уводит на Today, как раньше", async () => {
    await mount();
    await act(async () => go({ settings: true }));
    expect(route.settings).toBe(true);
    await act(async () => window.history.back());
    await settle();
    expect(route.settings).toBeUndefined();
    expect(window.location.hash).toBe("#/today");
  });

  it("guard перехватил: маршрут и адрес остаются Settings; подтверждённый уход завершает переход", async () => {
    let pending: (() => void) | null = null;
    let armed = true;
    const guard = vi.fn((proceed: () => void) => {
      if (!armed) return false;
      pending = proceed;
      return true;
    });
    await mount(guard);
    await act(async () => go({ settings: true }));
    await act(async () => window.history.back());
    await settle();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(route.settings).toBe(true);
    expect(window.location.hash).toBe("#/settings");
    expect(pending).not.toBeNull();

    // Шит «Остаться»: ничего не происходит, Settings на месте.
    // «Уйти»: guard больше не держит, proceed выполняет уход.
    armed = false;
    await act(async () => pending!());
    await settle();
    expect(route.settings).toBeUndefined();
    expect(window.location.hash).toBe("#/today");
  });

  it("правка адреса на другую вкладку тоже перехватывается и после подтверждения ведёт туда, куда шли", async () => {
    let pending: (() => void) | null = null;
    let armed = true;
    await mount((proceed) => {
      if (!armed) return false;
      pending = proceed;
      return true;
    });
    await act(async () => go({ settings: true }));
    await act(async () => {
      window.location.hash = "#/year";
    });
    await settle();
    expect(route.settings).toBe(true);
    expect(window.location.hash).toBe("#/settings");
    armed = false;
    await act(async () => pending!());
    await settle();
    expect(route.tab).toBe("year");
    expect(window.location.hash).toBe("#/year");
  });

  it("guard не трогает переходы вне Settings и сам go()", async () => {
    const guard = vi.fn(() => true);
    await mount(guard);
    await act(async () => go({ tab: "play" }));
    expect(route.tab).toBe("play");
    await act(async () => go({ settings: true }));
    await act(async () => go({ tab: "today" })); // штатный уход идёт через requestLeave в App, а не через guard
    expect(guard).not.toHaveBeenCalled();
    expect(route.tab).toBe("today");
  });
});
