// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { ANNOUNCE_DEBOUNCE_MS, LONG_PRESS_MS, StatusLine, handleGameKey, useCellsLeftAnnouncement, useClearEffectsOnUnmount } from "./controls";
import { GamePad } from "./controls";
import { createPlay, enterDigit, setInkMode } from "./logic";
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
  const longText = () => line().querySelector(".st-long")!.textContent;
  afterEach(() => {
    MOTION_FLAGS.statusRoll = true;
  });

  it("первый показ без анимации; смена числа ставит класс roll", () => {
    act(() => root.render(<StatusLine left={30} />));
    expect(line().className).toBe("status");
    expect(longText()).toBe("30 cells left");
    act(() => root.render(<StatusLine left={29} />));
    expect(line().className).toBe("status roll");
    expect(longText()).toBe("29 cells left");
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
    expect(longText()).toBe("29 cells left");
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

describe("PD-119: Fill candidates — долгий тап по Notes", () => {
  const SOLUTION =
    "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
  const MISSION =
    "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
  const snapOf = (ink = false): PlaySnapshot => {
    const p = createPlay({ mission: MISSION, solution: SOLUTION });
    return { phase: "playing", difficulty: "medium", startedOn: new Date(0), play: ink ? setInkMode(p, true) : p, selected: 2, notesMode: false, pop: null, wave: null } as PlaySnapshot;
  };
  const mkStore = () => ({ input: vi.fn(), undo: vi.fn(), erase: vi.fn(), toggleNotesMode: vi.fn(), fillCandidates: vi.fn() });
  const notesBtn = () => host.querySelector<HTMLButtonElement>(".actions .act")!;
  const sheet = () => document.querySelector('[data-testid="action-sheet"]');
  const down = () => act(() => void notesBtn().dispatchEvent(new Event("pointerdown", { bubbles: true })));
  const up = () => act(() => void notesBtn().dispatchEvent(new Event("pointerup", { bubbles: true })));
  const tap = () => act(() => void notesBtn().click());

  it("короткий тап — переключает Notes, шит не открывается", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    down();
    wait(LONG_PRESS_MS - 1);
    up();
    tap();
    wait(LONG_PRESS_MS * 2);
    expect(store.toggleNotesMode).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
  });

  it("удержание ≥ порога открывает шит «Fill candidates»; хвостовой click не переключает Notes; действие вызывает стор", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    down();
    wait(LONG_PRESS_MS);
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain("Fill candidates");
    up();
    tap(); // как если бы click всё же дошёл до кнопки
    expect(store.toggleNotesMode).not.toHaveBeenCalled();
    act(() => void document.querySelector<HTMLElement>('[data-testid="action-sheet-go"]')!.click());
    expect(store.fillCandidates).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
    // после закрытия следующий обычный тап снова переключает Notes (флаг «fired» не залип)
    tap();
    expect(store.toggleNotesMode).toHaveBeenCalledTimes(1);
  });

  it("QA PD-143 D1: хвост жеста (указательный click до нового нажатия) не жмёт Fill/Cancel и не закрывает шит по затемнению", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    down();
    wait(LONG_PRESS_MS);
    const go = document.querySelector<HTMLElement>('[data-testid="action-sheet-go"]')!;
    const cancel = document.querySelector<HTMLElement>('[data-testid="action-sheet-cancel"]')!;
    const scrim = document.querySelector<HTMLElement>('[data-testid="action-sheet-scrim"]')!;
    const pointerClick = (el: HTMLElement) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
    up();
    // Палец мог быть отпущен сильно позже открытия (не «окно N мс») — защита снимается только новым нажатием.
    wait(5000);
    pointerClick(go);
    pointerClick(cancel);
    pointerClick(scrim);
    expect(store.fillCandidates).not.toHaveBeenCalled();
    expect(sheet()).not.toBeNull();
    // Осознанный тап: pointerdown внутри шита, затем click — срабатывает сразу.
    act(() => void go.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    pointerClick(go);
    expect(store.fillCandidates).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
  });

  it("QA PD-143 D1: клавиатурный click (detail 0) и Esc работают сразу, без нажатия и без задержки", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    act(() => void notesBtn().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => void document.querySelector<HTMLElement>('[data-testid="action-sheet-go"]')!.click()); // Enter/пробел: detail 0
    expect(store.fillCandidates).toHaveBeenCalledTimes(1);
    act(() => void notesBtn().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(sheet()).not.toBeNull();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(sheet()).toBeNull();
  });

  it("«Cancel» закрывает шит и ничего не заполняет; тап по Notes после этого работает", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    down();
    wait(LONG_PRESS_MS);
    act(() => void document.querySelector<HTMLElement>('[data-testid="action-sheet-cancel"]')!.click());
    expect(sheet()).toBeNull();
    expect(store.fillCandidates).not.toHaveBeenCalled();
    tap();
    expect(store.toggleNotesMode).toHaveBeenCalledTimes(1);
  });

  it("уход пальца с кнопки до порога отменяет долгое нажатие", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    down();
    wait(LONG_PRESS_MS - 100);
    act(() => void notesBtn().dispatchEvent(new Event("pointerout", { bubbles: true })));
    wait(500);
    expect(sheet()).toBeNull();
  });

  it("правая кнопка/контекстное меню открывает тот же шит", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    act(() => void notesBtn().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(sheet()).not.toBeNull();
  });

  it("ink: долгий тап и контекстное меню ничего не открывают (подсказок в чернилах нет)", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf(true)} store={store as never} />));
    down();
    wait(LONG_PRESS_MS * 2);
    act(() => void notesBtn().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(sheet()).toBeNull();
    tap();
    expect(store.toggleNotesMode).toHaveBeenCalledTimes(1);
  });

  it("шит закрывается сам, если партия ушла в ink/решена под ним", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf()} store={store as never} />));
    down();
    wait(LONG_PRESS_MS);
    expect(sheet()).not.toBeNull();
    act(() => root.render(<GamePad snap={{ ...snapOf(), phase: "solved" } as PlaySnapshot} store={store as never} />));
    expect(sheet()).toBeNull();
  });

  it("клавиша F вызывает fillCandidates; Shift+F, Alt+F, Ctrl+F — нет; в диалоге клавиши не ввод", () => {
    const store = mkStore();
    const press = (init: KeyboardEventInit, target: HTMLElement = document.body) => {
      const e = { code: "KeyF", key: "f", target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), ...init };
      handleGameKey(e as never, store as never);
    };
    press({});
    expect(store.fillCandidates).toHaveBeenCalledTimes(1);
    press({ shiftKey: true });
    press({ altKey: true });
    press({ ctrlKey: true });
    press({ metaKey: true });
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    const inner = document.createElement("button");
    dlg.append(inner);
    document.body.append(dlg);
    press({}, inner);
    dlg.remove();
    expect(store.fillCandidates).toHaveBeenCalledTimes(1);
  });

  it("строка статуса: итог «Notes filled in N cells» (en/uk/ru, с множественным числом) и «Nothing to fill in»", async () => {
    const line = () => host.querySelector(".status")!.textContent;
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 1, count: 1 }} />));
    expect(line()).toBe("Notes filled in 1 cell");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 2, count: 57 }} />));
    expect(line()).toBe("Notes filled in 57 cells");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "fillNone", id: 3 }} />));
    expect(line()).toBe("Nothing to fill in");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 6, count: 50, dead: 1 }} />));
    expect(line()).toBe("Notes filled in 50 cells; 1 cell has no candidates");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 7, count: 50, dead: 3 }} />));
    expect(line()).toBe("Notes filled in 50 cells; 3 cells have no candidates");
    const i18n = (await import("../i18n")).default;
    await act(() => i18n.changeLanguage("ru"));
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 4, count: 3, dead: 2 }} />));
    expect(line()).toBe("Заметки заполнены в 3 клетках; в 2 клетках нет кандидатов");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 8, count: 3 }} />));
    expect(line()).toBe("Заметки заполнены в 3 клетках");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 9, count: 3, dead: 1 }} />));
    expect(line()).toBe("Заметки заполнены в 3 клетках; в 1 клетке нет кандидатов");
    await act(() => i18n.changeLanguage("uk"));
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 5, count: 1 }} />));
    expect(line()).toBe("Нотатки заповнено в 1 клітинці");
    act(() => root.render(<StatusLine left={30} hint={{ kind: "filled", id: 10, count: 2, dead: 5 }} />));
    expect(line()).toBe("Нотатки заповнено в 2 клітинках; у 5 клітинках немає кандидатів");
    await act(() => i18n.changeLanguage("en"));
  });
});

describe("PD-144: строка статуса при AX3 — короткая форма", () => {
  const line = () => host.querySelector<HTMLElement>("[data-testid=status-line]")!;

  it("обычный счёт несёт длинную форму (доступное имя) и короткую aria-hidden (её CSS показывает при data-type=ax3)", () => {
    act(() => root.render(<StatusLine left={47} />));
    expect(line().querySelector(".st-long")!.textContent).toBe("47 cells left");
    const short = line().querySelector(".st-short")!;
    expect(short.textContent).toBe("47 left");
    expect(short.getAttribute("aria-hidden")).toBe("true");
  });

  it("«Grid full» и подсказки — единым текстом, без короткой формы", () => {
    act(() => root.render(<StatusLine left={0} full />));
    expect(line().querySelector(".st-short")).toBeNull();
    expect(line().textContent).toBe("Grid full — something doesn’t match");
  });
});
