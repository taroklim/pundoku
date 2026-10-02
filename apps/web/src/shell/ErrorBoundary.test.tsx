// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ErrorBoundary } from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let errSpy: { mock: { calls: unknown[][] } };

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new TypeError("undefined is not an object (evaluating 'e.solved')");
  return <p data-testid="ok">fine</p>;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = (ui: React.ReactNode) => act(async () => root.render(ui));

describe("ErrorBoundary (PD-146)", () => {
  it("без ошибки — детей показывает как есть", async () => {
    await render(
      <ErrorBoundary scope="tab">
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    expect(host.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="crash-screen"]')).toBeNull();
  });

  it("ошибка рендера: тихий экран «Something went wrong — Reload», не пустой экран; ошибка в console.error", async () => {
    await render(
      <ErrorBoundary scope="tab">
        <Bomb explode />
      </ErrorBoundary>,
    );
    const screen = host.querySelector('[data-testid="crash-screen"]')!;
    expect(screen).not.toBeNull();
    expect(screen.getAttribute("role")).toBe("alert");
    expect(screen.querySelector("h1")!.textContent).toBe("Something went wrong");
    expect(screen.querySelector("button")!.textContent).toBe("Reload");
    const logged = errSpy.mock.calls.some((c) => String(c[0]).includes("[pundoku]") && c.some((a) => a instanceof TypeError));
    expect(logged).toBe(true); // баг не замаскирован
  });

  it("Reload перезагружает страницу и больше ничего не делает (ни сети, ни очистки данных)", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const clear = vi.spyOn(Storage.prototype, "clear");
    await render(
      <ErrorBoundary scope="app">
        <Bomb explode />
      </ErrorBoundary>,
    );
    await act(async () => host.querySelector<HTMLButtonElement>(".crash button")!.click());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    ["uk", "Щось пішло не так", "Перезавантажити"],
    ["ru", "Что-то пошло не так", "Перезагрузить"],
  ])("локализация %s", async (lng, title, reload) => {
    await i18n.changeLanguage(lng);
    await render(
      <ErrorBoundary scope="tab">
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(host.querySelector(".crash h1")!.textContent).toBe(title);
    expect(host.querySelector(".crash button")!.textContent).toBe(reload);
  });

  it("сбой одного места не затрагивает соседа вне границы (граница вкладки не трогает таб-бар)", async () => {
    await render(
      <div>
        <nav data-testid="tabbar">tabs</nav>
        <ErrorBoundary scope="tab">
          <Bomb explode />
        </ErrorBoundary>
      </div>,
    );
    expect(host.querySelector('[data-testid="tabbar"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="crash-screen"]')).not.toBeNull();
  });
});
