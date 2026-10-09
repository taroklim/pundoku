// @vitest-environment jsdom
/**
 * PD-266: страница режима — хаб Play в раскладке C «Сайдбар». Только в раскладке с сайдбаром и только на хабе; содержимое —
 * как у шита режима (описание, сложность, «Начать», Лжец дня); «Начать» запускает партию, а у необратимого режима сначала
 * его правило; повторный выбор Play закрывает страницу. Вне раскладки с сайдбаром — прежний хаб, даже если страница открыта.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { DESK_QUERY, deskStore } from "../shell/desk";
import { modeDef } from "./modes";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const inner = playStore as unknown as { snap: Record<string, unknown> };
let base: Record<string, unknown> = {};
let deskOn = true;
let host: HTMLDivElement;
let root: Root;
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const tap = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const render = () => act(() => root.render(<PlayScreen />));

beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  deskOn = true;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === DESK_QUERY && deskOn;
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
  deskStore.reset();
  inner.snap = { ...base, hub: true, restoring: false };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("страница режима", () => {
  it("вместо хаба: имя, описание, сложность списком, «Start»; шита нет", () => {
    act(() => deskStore.showModePage("classic"));
    render();
    const page = q("mode-page")!;
    expect(page.dataset.mode).toBe("classic");
    expect(page.querySelector("h2")!.textContent).toBe("Classic");
    expect(q("mode-desc")!.textContent).toBe("Plain sudoku: notes, undo and hints are all there.");
    expect(page.querySelectorAll('[role="radio"]').length).toBe(modeDef("classic").difficulties.length);
    expect(q("mode-page-start")!.textContent).toBe("Start");
    expect(q("mode-sheet")).toBeNull();
    expect(host.querySelector('[data-testid="mode-classic"]')).toBeNull(); // строк хаба нет
  });

  it("«Start» запускает партию режима с выбранной сложностью", () => {
    const start = vi.spyOn(playStore, "startNew").mockImplementation(() => undefined);
    act(() => deskStore.showModePage("glyphs"));
    render();
    tap(q("difficulty-hard"));
    expect(q("difficulty-hard")!.getAttribute("aria-checked")).toBe("true");
    tap(q("mode-page-start"));
    expect(start).toHaveBeenCalledWith("glyphs", "hard");
  });

  it("Ink: «Start» сначала показывает правило режима, партия — только после него", () => {
    const start = vi.spyOn(playStore, "startNew").mockImplementation(() => undefined);
    act(() => deskStore.showModePage("ink"));
    render();
    tap(q("mode-page-start"));
    expect(start).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("Лжец: строка Лжеца дня и прогрев сеток, как у шита", () => {
    const warm = vi.spyOn(playStore, "warmLiar").mockImplementation(() => undefined);
    const refresh = vi.spyOn(playStore, "refreshDaily").mockImplementation(() => undefined);
    act(() => deskStore.showModePage("liar"));
    render();
    expect(q("liar-daily")).not.toBeNull();
    expect(warm).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("повторный выбор Play (reselect) закрывает страницу — снова хаб", () => {
    act(() => deskStore.showModePage("melody"));
    render();
    expect(q("mode-page")).not.toBeNull();
    act(() => playStore.reselect());
    expect(deskStore.getSnapshot().modePage).toBeNull();
    expect(q("mode-page")).toBeNull();
    expect(q("mode-melody")).not.toBeNull();
  });

  it("вне раскладки с сайдбаром (компакт, телефон) — прежний хаб, даже если страница открыта", () => {
    deskOn = false;
    act(() => deskStore.showModePage("classic"));
    render();
    expect(q("mode-page")).toBeNull();
    expect(q("mode-classic")).not.toBeNull();
  });
});
