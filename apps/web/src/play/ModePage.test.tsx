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
import { TabActiveContext } from "../shell/tabSlide";
import { ModePage } from "./ModePage";
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
    expect(q("mode-page-start")!.querySelector("span")!.textContent).toBe("Start");
    expect(q("mode-page-enter")!.textContent).toBe("↩"); // PD-269: чип клавиши
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

/**
 * PD-269: «Start ↩» — Enter запускает партию (макет C, аудит PD-228 п. 9; правило шита режима PD-232 в). Нажатие Enter по
 * сфокусированной кнопке jsdom в click не превращает — здесь: куда встаёт фокус и что делает Enter вне кнопок; нативный Enter
 * по «Start» — живая проверка design/pd269-check.mjs.
 */
describe("страница режима: Enter = «Start»", () => {
  const mode = modeDef("classic");
  const page = (props: { discard?: never | null; active?: boolean; onStart?: () => void; daily?: boolean } = {}) =>
    act(() =>
      root.render(
        <TabActiveContext.Provider value={props.active ?? true}>
          <ModePage
            mode={mode}
            pick="easy"
            discard={props.discard ?? null}
            onPick={vi.fn()}
            onStart={props.onStart ?? vi.fn()}
            daily={props.daily ? { state: { kind: "none" }, onOpen: vi.fn() } : null}
          />
        </TabActiveContext.Provider>,
      ),
    );
  const enter = (target: EventTarget, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
    act(() => void target.dispatchEvent(e));
    return e;
  };

  it("страница открылась — фокус на «Start», у неё чип ↩ и aria-keyshortcuts", () => {
    page();
    expect(document.activeElement).toBe(q("mode-page-start"));
    expect(q("mode-page-start")!.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(q("mode-page-enter")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("Enter с фона документа и со строки сложности — «Start»; модификаторы и повтор — нет", () => {
    const onStart = vi.fn();
    page({ onStart });
    (document.activeElement as HTMLElement).blur();
    expect(enter(document.body).defaultPrevented).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    enter(q("difficulty-easy")!);
    expect(onStart).toHaveBeenCalledTimes(2);
    enter(document.body, { metaKey: true });
    enter(document.body, { shiftKey: true });
    enter(document.body, { repeat: true });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("Enter на другой кнопке (Лжец дня, вне страницы) — её действие, не «Start»", () => {
    const onStart = vi.fn();
    page({ onStart, daily: true });
    const other = document.createElement("button");
    document.body.append(other);
    enter(q("liar-daily")!);
    enter(other);
    other.remove();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("открыт шит/диалог — Enter его, не страницы", () => {
    const onStart = vi.fn();
    page({ onStart });
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    document.body.append(dlg);
    enter(document.body);
    dlg.remove();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("«Start new» отбросит незаконченную партию — ни фокуса, ни чипа, ни Enter", () => {
    const onStart = vi.fn();
    page({ onStart, discard: { difficulty: "medium", left: 50, elapsedMs: 60_000 } as never });
    expect(document.activeElement).not.toBe(q("mode-page-start"));
    expect(q("mode-page-enter")).toBeNull();
    expect(q("mode-page-start")!.hasAttribute("aria-keyshortcuts")).toBe(false);
    enter(document.body);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("вкладка Play скрыта — фокус не крадёт и Enter не слушает", () => {
    const onStart = vi.fn();
    page({ onStart, active: false });
    expect(document.activeElement).not.toBe(q("mode-page-start"));
    enter(document.body);
    expect(onStart).not.toHaveBeenCalled();
  });
});
