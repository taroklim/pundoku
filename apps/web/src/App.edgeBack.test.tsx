// @vitest-environment jsdom
// PD-253: жест «назад» от левого края на Settings и справке (только установленное приложение). Касание в полосе 16 px, захват
// после 24 px под пологим углом, экран едет за пальцем, за 35 % ширины или броском — «назад» туда же, куда «‹» (справка →
// Settings, Settings → вкладка-источник через guard PD-57); недотянул/бросил влево/pointercancel — экран возвращается.
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";
import { EDGE_BACK } from "./shell/edgeBack";

const store = vi.hoisted(() => ({
  held: false,
  guardLeave: vi.fn<(proceed: () => void) => boolean>(),
  requestLeave: vi.fn<(proceed: () => void) => void>((proceed) => proceed()),
}));
vi.mock("./recovery/runtime", () => ({ recoveryStore: store }));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./play/PlayScreen", () => ({
  PlayScreen: ({ onOpenSettings }: { onOpenSettings?: () => void }) => <button data-testid="play-gear" onClick={onOpenSettings} />,
}));
vi.mock("./today/TodayScreen", () => ({
  TodayScreen: ({ onOpenSettings, onOpenHelp }: { onOpenSettings?: () => void; onOpenHelp?: (b: "grid") => void }) => (
    <div>
      <button data-testid="today-gear" onClick={onOpenSettings} />
      <button data-testid="today-help" onClick={() => onOpenHelp?.("grid")} />
    </div>
  ),
}));
vi.mock("./year/YearTab", () => ({ YearTab: () => <p>year</p> }));
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "settings.backLabel", play: "settings.backLabelPlay", year: "settings.backLabelYear" },
  SettingsScreen: ({ onBack, onOpenHelp }: { onBack: () => void; onOpenHelp: () => void }) => (
    <div data-testid="settings-screen">
      <button data-testid="settings-back" onClick={onBack} />
      <button data-testid="open-help" onClick={onOpenHelp} />
    </div>
  ),
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const W = 390;
let host: HTMLDivElement;
let root: Root;
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const settle = () => wait(30);
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const layer = () => host.querySelector<HTMLElement>(".push-layer");
const stack = () => host.querySelector<HTMLElement>(".stack")!;
const press = async (id: string) => {
  await act(async () => q(id)!.click());
  await settle();
};

let clock = 1000;
/** Указатель с явным временем (скорость броска считается по `timeStamp`). */
function pointer(target: EventTarget, type: string, x: number, y = 300, { id = 1, kind = "touch", dt = 16 } = {}) {
  clock += dt;
  const ev = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }), { pointerId: id, pointerType: kind });
  Object.defineProperty(ev, "timeStamp", { value: clock });
  act(() => void target.dispatchEvent(ev));
}
/** Касание у края `x0`, ведение через точки `xs` (по 16 мс), отпускание в последней. */
function drag(x0: number, xs: number[], { y = 300, dys = [] as number[], release = true, kind = "touch", dt = 16 } = {}) {
  const el = layer()!;
  pointer(el, "pointerdown", x0, y, { kind });
  xs.forEach((x, i) => pointer(document, "pointermove", x, y + (dys[i] ?? 0), { kind, dt }));
  if (release) pointer(document, "pointerup", xs.at(-1) ?? x0, y + (dys.at(-1) ?? 0), { kind, dt });
}
const shift = () => layer()?.style.transform ?? "";

async function mount(standalone: boolean) {
  if (standalone) Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
}
async function openSettings(from: "today" | "play" = "play") {
  await act(async () => void (window.location.hash = `#/${from}`));
  await settle();
  await press(`${from}-gear`);
  Object.defineProperty(layer()!, "clientWidth", { configurable: true, value: W });
}

beforeEach(() => {
  store.held = false;
  store.guardLeave.mockReset().mockImplementation(() => store.held);
  store.requestLeave.mockClear();
  window.history.replaceState(null, "", "#/today");
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (navigator as { standalone?: boolean }).standalone;
  document.documentElement.style.removeProperty("--mo");
  window.dispatchEvent(new Event("pointerdown")); // снять перехватчик призрачного клика, если остался
});

describe("установленное приложение: Settings", () => {
  beforeEach(() => mount(true));

  it("слой помечен для touch-action: pan-y", async () => {
    await openSettings();
    expect(layer()!.hasAttribute("data-edge-back")).toBe(true);
  });

  it("от края дальше 35 % ширины — экран едет за пальцем, под ним вкладка, затем «назад» на вкладку-источник", async () => {
    await openSettings("play");
    drag(6, [20, 40, 120, 160], { release: false });
    expect(shift()).toBe("translate3d(154px, 0, 0)");
    expect(stack().hasAttribute("data-peek")).toBe(true);
    expect(layer()!.hasAttribute("data-edge-drag")).toBe(true);
    pointer(document, "pointerup", 160, 300, { dt: 200 }); // пауза перед отпусканием — не бросок
    expect(store.guardLeave).toHaveBeenCalledTimes(1); // уход через guard PD-57
    expect(q("settings-screen")).not.toBeNull(); // сначала доводка за край
    expect(shift()).toBe(`translate3d(${W}px, 0, 0)`);
    await wait(EDGE_BACK.SETTLE_MS + 40);
    await settle();
    expect(q("settings-screen")).toBeNull();
    expect(window.location.hash).toBe("#/play");
    expect(q("play-gear")).not.toBeNull();
    expect(stack().hasAttribute("data-peek")).toBe(false);
  });

  it("вкладка уже видна под экраном — возврат на неё без повторного входа M10 (кнопка «‹» его играет)", async () => {
    const animated: Element[] = [];
    (Element.prototype as { animate?: unknown }).animate = function (this: Element) {
      animated.push(this);
      return { finished: new Promise(() => undefined), cancel() {} } as unknown as Animation;
    };
    try {
      await openSettings("play");
      animated.length = 0; // слайд Today → Play при открытии — не наш
      await press("settings-back");
      expect(animated.filter((el) => (el as HTMLElement).dataset.tab === "play")).toHaveLength(1);
      animated.length = 0;
      await press("play-gear");
      Object.defineProperty(layer()!, "clientWidth", { configurable: true, value: W });
      drag(4, [40, 200], { dt: 60 });
      await wait(EDGE_BACK.SETTLE_MS + 40);
      await settle();
      expect(q("settings-screen")).toBeNull();
      expect(animated.filter((el) => (el as HTMLElement).dataset.tab === "play")).toHaveLength(0);
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });

  it("недотянул (< 35 %) и отпустил медленно — экран возвращается, Settings на месте", async () => {
    await openSettings();
    drag(4, [30, 80, 120], { release: false });
    pointer(document, "pointerup", 120, 300, { dt: 200 });
    expect(shift()).toBe(""); // возврат на 0 (transition)
    await wait(EDGE_BACK.SETTLE_MS + 40);
    expect(q("settings-screen")).not.toBeNull();
    expect(window.location.hash).toBe("#/settings");
    expect(layer()!.hasAttribute("data-edge-drag")).toBe(false);
    expect(stack().hasAttribute("data-peek")).toBe(false);
    expect(store.guardLeave).not.toHaveBeenCalled();
  });

  it("бросок вправо с малой дистанции — «назад»; бросок влево с большой — возврат", async () => {
    await openSettings();
    drag(4, [30, 60, 300], { release: false, dt: 120 }); // медленно далеко за 35 %…
    pointer(document, "pointermove", 260, 300, { dt: 8 }); // …и резко обратно
    pointer(document, "pointermove", 220, 300, { dt: 8 });
    pointer(document, "pointerup", 200, 300, { dt: 8 });
    await wait(EDGE_BACK.SETTLE_MS + 40);
    expect(q("settings-screen")).not.toBeNull(); // бросок влево
    drag(4, [30, 60, 100], { dt: 8 });
    await wait(EDGE_BACK.SETTLE_MS + 40);
    await settle();
    expect(q("settings-screen")).toBeNull();
  });

  it("касание дальше 16 px от края, вертикаль, мышь — не жест", async () => {
    await openSettings();
    drag(EDGE_BACK.EDGE + 4, [60, 200, 300]);
    expect(shift()).toBe("");
    drag(4, [6, 8, 30, 300], { dys: [8, 20, 60, 120] }); // вертикаль набрала slop раньше горизонтали
    expect(shift()).toBe("");
    drag(4, [60, 200, 300], { kind: "mouse" });
    expect(shift()).toBe("");
    await wait(EDGE_BACK.SETTLE_MS + 40);
    expect(q("settings-screen")).not.toBeNull();
  });

  it("pointercancel после захвата (браузер забрал жест) — возврат, не «назад»", async () => {
    await openSettings();
    drag(4, [40, 300], { release: false });
    pointer(document, "pointercancel", 300);
    await wait(EDGE_BACK.SETTLE_MS + 40);
    expect(q("settings-screen")).not.toBeNull();
    expect(shift()).toBe("");
  });

  it("второй палец на самом экране посреди жеста — отмена, Settings на месте", async () => {
    await openSettings("play");
    drag(6, [40, 200], { release: false });
    pointer(layer()!, "pointerdown", 330, 500, { id: 2 });
    pointer(document, "pointermove", 260, 300);
    pointer(document, "pointerup", 260, 300, { dt: 200 });
    await wait(EDGE_BACK.SETTLE_MS + EDGE_BACK.FALLBACK_MS);
    expect(store.guardLeave).not.toHaveBeenCalled();
    expect(q("settings-screen")).not.toBeNull();
    expect(window.location.hash).toBe("#/settings");
    expect(shift()).toBe("");
  });

  it("PD-286: второй палец на таб-баре (вне слоя) посреди жеста — тоже отмена, не уход на вкладку-источник", async () => {
    await openSettings("play");
    drag(6, [40, 200], { release: false });
    const tabbar = host.querySelector<HTMLElement>(".tabbar")!;
    expect(layer()!.contains(tabbar)).toBe(false);
    pointer(tabbar, "pointerdown", 300, 820, { id: 2 });
    expect(layer()!.hasAttribute("data-edge-drag")).toBe(true); // доводка назад на место идёт
    pointer(document, "pointermove", 260, 300);
    pointer(document, "pointerup", 260, 300, { dt: 200 });
    await wait(EDGE_BACK.SETTLE_MS + EDGE_BACK.FALLBACK_MS);
    expect(store.guardLeave).not.toHaveBeenCalled();
    expect(q("settings-screen")).not.toBeNull();
    expect(window.location.hash).toBe("#/settings");
    expect(shift()).toBe("");
    expect(stack().hasAttribute("data-peek")).toBe(false);
    // после отмены жест снова доступен
    drag(6, [40, 200], { dt: 60 });
    await wait(EDGE_BACK.SETTLE_MS + 40);
    await settle();
    expect(window.location.hash).toBe("#/play");
  });

  it("клик хвоста жеста под пальцем не срабатывает как тап", async () => {
    await openSettings();
    const onClick = vi.fn();
    layer()!.addEventListener("click", onClick);
    drag(4, [40, 80]);
    act(() => void layer()!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("несохранённый ключ: guard перехватил — экран возвращается, шит показывает стор (Settings не уходит)", async () => {
    await openSettings();
    store.held = true;
    drag(4, [40, 200, 300], { dt: 60 });
    expect(store.guardLeave).toHaveBeenCalledTimes(1);
    await wait(EDGE_BACK.SETTLE_MS + EDGE_BACK.FALLBACK_MS);
    expect(q("settings-screen")).not.toBeNull();
    expect(window.location.hash).toBe("#/settings");
    expect(shift()).toBe("");
  });

  it("открыт шит/диалог — жест молчит (касание его)", async () => {
    await openSettings();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    drag(4, [40, 200, 300], { dt: 60 });
    dialog.remove();
    await wait(EDGE_BACK.SETTLE_MS + 40);
    expect(q("settings-screen")).not.toBeNull();
    expect(store.guardLeave).not.toHaveBeenCalled();
  });

  it("Reduce Motion: экран за пальцем не едет, «назад» — сразу по отпусканию", async () => {
    document.documentElement.style.setProperty("--mo", "0");
    await openSettings("play");
    drag(4, [40, 200, 300], { release: false, dt: 60 });
    expect(shift()).toBe("");
    expect(stack().hasAttribute("data-peek")).toBe(false);
    pointer(document, "pointerup", 300, 300, { dt: 60 });
    await settle();
    expect(q("settings-screen")).toBeNull();
    expect(window.location.hash).toBe("#/play");
  });
});

describe("установленное приложение: справка", () => {
  beforeEach(() => mount(true));

  it("справка из Settings → жест ведёт в Settings (без показа вкладки под экраном)", async () => {
    await openSettings();
    await press("open-help");
    expect(q("help-screen")).not.toBeNull();
    Object.defineProperty(layer()!, "clientWidth", { configurable: true, value: W });
    drag(4, [40, 200], { release: false, dt: 60 });
    expect(stack().hasAttribute("data-peek")).toBe(false);
    pointer(document, "pointerup", 200, 300, { dt: 60 });
    expect(store.guardLeave).not.toHaveBeenCalled(); // справку guard не держит
    await wait(EDGE_BACK.SETTLE_MS + 40);
    await settle();
    expect(q("help-screen")).toBeNull();
    expect(q("settings-screen")).not.toBeNull();
    expect(shift()).toBe(""); // слой в покое на новом экране
  });

  it("справка со ссылки на Today → жест ведёт на Today, Today видна под экраном", async () => {
    await press("today-help");
    Object.defineProperty(layer()!, "clientWidth", { configurable: true, value: W });
    drag(4, [40, 200], { release: false, dt: 60 });
    expect(stack().hasAttribute("data-peek")).toBe(true);
    pointer(document, "pointerup", 200, 300, { dt: 60 });
    await wait(EDGE_BACK.SETTLE_MS + 40);
    await settle();
    expect(q("help-screen")).toBeNull();
    expect(window.location.hash).toBe("#/today");
  });
});

describe("Safari-вкладка (не установлено): жест выключен — там системный «назад»", () => {
  beforeEach(() => mount(false));

  it("нет pan-y на слое, свайп от края ничего не делает", async () => {
    await openSettings();
    expect(layer()!.hasAttribute("data-edge-back")).toBe(false);
    drag(4, [40, 200, 300], { dt: 60 });
    expect(shift()).toBe("");
    await wait(EDGE_BACK.SETTLE_MS + 40);
    expect(q("settings-screen")).not.toBeNull();
  });
});
