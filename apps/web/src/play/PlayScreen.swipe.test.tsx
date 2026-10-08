// @vitest-environment jsdom
/**
 * PD-225, экран Play целиком: удаление незаконченной партии режима с хаба → слот удалён сразу, тост «… puzzle deleted · Undo»
 * 6 с; «Undo» возвращает партию (строка снова «In progress»); путь клавиатуры — фокус на «Undo», после отмены — на строку;
 * удаление «запаркованной» живой партии → тап по строке открывает шит режима, а не удалённую партию (§A11 п. 9); тост
 * закрывается уходом с хаба (шит, партия, другая вкладка) и скрытием страницы — удаление при этом остаётся.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { TabActiveContext } from "../shell/tabSlide";
import { createPlay, enterDigit } from "./logic";
import type { PlayState } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const fresh = (): PlayState => createPlay({ mission: MISSION, solution: SOLUTION });

interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};
const playing = (play: PlayState, extra: Record<string, unknown> = {}) =>
  (inner.snap = { ...inner.snap, hub: false, restoring: false, phase: "playing", play, selected: 2, notesMode: false, startedOn: new Date(2026, 9, 3, 12), ...extra });

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element, detail = 1) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
const render = (active = true) =>
  act(() =>
    root.render(
      <TabActiveContext.Provider value={active}>
        <PlayScreen />
      </TabActiveContext.Provider>,
    ),
  );
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** Партия Классики с ходом, игрок вышел на хаб тапом по вкладке (живая партия «запаркована» за хабом). */
function parkedClassic() {
  playing(enterDigit(fresh(), 2, 4, 100), { mode: "classic" });
  render();
  act(() => playStore.reselect());
}

beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  inner.snap = { ...base };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PD-225: удаление незаконченной партии с хаба и «Undo»", () => {
  it("«Удалить» — слот удалён сразу, строка с описанием, тост «Classic puzzle deleted»; «Undo» — партия вернулась", () => {
    parkedClassic();
    const play = playStore.getSnapshot().play;
    expect(q("mode-status-classic")).not.toBeNull();
    tap(q("del-classic")!);
    expect(playStore.slots().classic).toBeUndefined();
    expect(q("mode-status-classic")).toBeNull();
    expect(q("mode-desc-classic")).not.toBeNull();
    expect(q("undo-toast")!.textContent).toContain("Classic puzzle deleted");
    expect(q("undo-toast-action")!.textContent).toBe("Undo");
    tap(q("undo-toast-action")!);
    expect(playStore.slots().classic).toBeDefined();
    expect(q("mode-status-classic")).not.toBeNull();
    wait(200);
    expect(q("undo-toast")).toBeNull();
    expect(q("undo-toast-live")!.textContent).toBe("Classic puzzle restored");
    tap(q("mode-classic")!);
    expect(playStore.getSnapshot().hub).toBe(false);
    expect(playStore.getSnapshot().play).toEqual(play);
  });

  it("6 с без отмены — тост уходит, партия удалена окончательно", () => {
    parkedClassic();
    tap(q("del-classic")!);
    wait(6000);
    wait(200);
    expect(q("undo-toast")).toBeNull();
    expect(playStore.slots().classic).toBeUndefined();
  });

  it("удалённая «запаркованная» живая партия: тап по строке — шит режима, а не удалённая партия (§A11 п. 9)", () => {
    parkedClassic();
    tap(q("del-classic")!);
    tap(q("mode-classic")!);
    expect(q("mode-sheet")!.getAttribute("data-mode")).toBe("classic");
    expect(q("discard-note")).toBeNull(); // удалять больше нечего — без предупреждения
    expect(playStore.getSnapshot().hub).toBe(true);
    // шит открыт — тост убран, удаление осталось
    wait(200);
    expect(q("undo-toast")).toBeNull();
    expect(playStore.slots().classic).toBeUndefined();
  });

  it("путь клавиатуры: фокус на «Undo»; после отмены фокус — на строке режима", () => {
    parkedClassic();
    tap(q("del-classic")!, 0);
    wait(300);
    expect(document.activeElement).toBe(q("undo-toast-action"));
    wait(30_000);
    expect(q("undo-toast")).not.toBeNull(); // пока фокус в тосте, по таймеру не гаснет
    tap(q("undo-toast-action")!, 0);
    expect(playStore.slots().classic).toBeDefined();
    expect(document.activeElement).toBe(q("mode-classic"));
  });

  it("уход на другую вкладку или скрытие страницы закрывают тост; удаление остаётся", () => {
    parkedClassic();
    tap(q("del-classic")!);
    render(false);
    wait(200);
    expect(q("undo-toast")).toBeNull();
    expect(playStore.slots().classic).toBeUndefined();

    render(true);
    playing(enterDigit(fresh(), 3, 6, 100), { mode: "ink" });
    act(() => playStore.reselect());
    tap(q("del-ink")!);
    expect(q("undo-toast")).not.toBeNull();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    wait(200);
    expect(q("undo-toast")).toBeNull();
    expect(playStore.slots().ink).toBeUndefined();
  });

  it("новое удаление заменяет тост; прежняя отмена теряется", () => {
    parkedClassic();
    playStore.open("classic");
    act(() => playStore.reselect());
    // вторая игра — Чернила в слоте
    (playStore as unknown as { saved: Map<string, unknown> }).saved.set("ink", { ...(playStore as unknown as { saved: Map<string, { mode: string }> }).saved.get("classic")!, mode: "ink" });
    render();
    tap(q("del-ink")!);
    tap(q("del-classic")!);
    expect(document.querySelectorAll('[data-testid="undo-toast"]')).toHaveLength(1);
    expect(q("undo-toast")!.textContent).toContain("Classic puzzle deleted");
    tap(q("undo-toast-action")!);
    expect(playStore.slots().classic).toBeDefined();
    expect(playStore.slots().ink).toBeUndefined();
  });
});
