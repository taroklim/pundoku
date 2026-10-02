// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { Board, BLOT_MOMENT_MS } from "./Board";
import { MOTION_MS } from "./motion";
import { createPlay } from "./logic";
import { HIGHLIGHT_WRONG_KEY, setHighlightWrong } from "../settings/prefs";
import type { PlaySnapshot } from "./gameStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const play = createPlay({ mission: MISSION, solution: SOLUTION });
const fakeStore = { select: () => undefined, moveSelection: () => null } as unknown as Parameters<typeof Board>[0]["store"];

const snapOf = (patch: Partial<PlaySnapshot>): PlaySnapshot => ({
  phase: "playing",
  difficulty: "medium",
  startedOn: new Date(0),
  play,
  selected: 2,
  notesMode: false,
  pop: null,
  wave: null,
  ...patch,
});

const row = (r: number): number[] => Array.from({ length: 9 }, (_, c) => r * 9 + c);
const col = (c: number): number[] => Array.from({ length: 9 }, (_, r) => r * 9 + c);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  setHighlightWrong(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (snap: PlaySnapshot) => act(() => root.render(<Board snap={snap} store={fakeStore} dim={false} />));

const total = () => document.querySelectorAll(".board i").length;

describe("M3: волны не плодят элементы", () => {
  it("после серии пересекающихся волн в DOM не больше 81 элемента .wv и число узлов не растёт", () => {
    render(snapOf({}));
    const base = total();
    expect(document.querySelectorAll(".wv").length).toBeLessThanOrEqual(81);
    const units = [row(0), col(0), row(4), col(4), row(0), col(8), row(3), col(3), row(4), col(4)];
    units.forEach((cells, n) => {
      render(snapOf({ wave: { cells, id: n + 1 } }));
      expect(document.querySelectorAll(".wv").length).toBeLessThanOrEqual(81);
      expect(total()).toBe(base);
      expect(document.querySelectorAll(".cell.wave").length).toBe(9);
    });
    render(snapOf({ wave: null }));
    expect(document.querySelectorAll(".wv").length).toBeLessThanOrEqual(81);
    expect(total()).toBe(base);
    expect(document.querySelectorAll(".cell.wave").length).toBe(0);
  });

  it("клетка в двух волнах подряд меняет класс (перезапуск CSS-анимации)", () => {
    render(snapOf({ wave: { cells: row(0), id: 1 } }));
    const c = document.querySelector<HTMLElement>('.cell[data-i="0"]')!;
    expect(c.classList.contains("wave-a")).toBe(true);
    render(snapOf({ wave: { cells: col(0), id: 2 } }));
    expect(c.classList.contains("wave-b")).toBe(true);
    expect(c.classList.contains("wave-a")).toBe(false);
    render(snapOf({ wave: { cells: row(0), id: 3 } }));
    expect(c.classList.contains("wave-a")).toBe(true);
  });
});

describe("фокус следует за выбором", () => {
  it("если фокус в поле, смена выбора (undo) переносит его на выбранную клетку", () => {
    render(snapOf({ selected: 5 }));
    const c5 = document.querySelector<HTMLElement>('.cell[data-i="5"]')!;
    act(() => c5.focus());
    expect(document.activeElement).toBe(c5);
    render(snapOf({ selected: 20 }));
    expect(document.activeElement).toBe(document.querySelector('.cell[data-i="20"]'));
    expect(document.querySelector('.cell[data-i="20"]')!.getAttribute("tabindex")).toBe("0");
    expect(c5.getAttribute("tabindex")).toBe("-1");
  });

  it("если фокус вне поля (кнопка Undo), фокус не отбирается", () => {
    render(snapOf({ selected: 5 }));
    const btn = document.createElement("button");
    document.body.append(btn);
    btn.focus();
    render(snapOf({ selected: 20 }));
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });
});

describe("выбранная неверная клетка (подсветка включена)", () => {
  it("кольцо выбора получает класс err (сургуч снаружи), у верной клетки — нет", () => {
    setHighlightWrong(true);
    const wrong = { ...play, values: play.values.map((v, i) => (i === 2 ? 1 : v)) }; // решение клетки 2 — 4
    render(snapOf({ play: wrong, selected: 2 }));
    expect(document.querySelector(".ring")!.classList.contains("err")).toBe(true);
    render(snapOf({ selected: 2 }));
    expect(document.querySelector(".ring")!.classList.contains("err")).toBe(false);
  });
});

describe("PD-112: «Подсвечивать неверные цифры»", () => {
  const wrongPlay = { ...play, values: play.values.map((v, i) => (i === 2 ? 1 : v)) }; // решение клетки 2 — 4, поставлена 1
  const c2 = () => document.querySelector<HTMLElement>('.cell[data-i="2"]')!;

  it("по умолчанию выкл (чистый профиль): ни класса err, ни кольца err, ни «wrong» в подписи/title/live-регионе", () => {
    expect(localStorage.getItem(HIGHLIGHT_WRONG_KEY)).toBeNull();
    render(snapOf({ play: wrongPlay, selected: 2 }));
    expect(document.querySelector(".err")).toBeNull();
    expect(c2().classList.contains("err")).toBe(false);
    expect(c2().getAttribute("aria-label")).toBe("Row 1, column 3, your 1");
    expect(document.querySelector(".board")!.innerHTML).not.toMatch(/wrong|err\b|title=/i);
    expect(document.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it("профиль со «старым состоянием» (любые чужие ключи, нет нашего) — тоже выкл; только значение «1» включает", () => {
    localStorage.setItem("pundoku.locale", "ru");
    localStorage.setItem("pundoku.something", "1");
    render(snapOf({ play: wrongPlay, selected: 2 }));
    expect(document.querySelector(".err")).toBeNull();
    localStorage.setItem(HIGHLIGHT_WRONG_KEY, "true");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: HIGHLIGHT_WRONG_KEY })));
    expect(document.querySelector(".err")).toBeNull();
  });

  it("вкл возвращает подсветку (клетка, цифра, кольцо, подпись) и подхватывается на открытом поле без перерисовки снаружи", () => {
    render(snapOf({ play: wrongPlay, selected: 2 }));
    expect(document.querySelector(".err")).toBeNull();
    act(() => setHighlightWrong(true));
    expect(c2().classList.contains("err")).toBe(true);
    expect(c2().querySelector(".d")!.classList.contains("err")).toBe(true);
    expect(document.querySelector(".ring")!.classList.contains("err")).toBe(true);
    expect(c2().getAttribute("aria-label")).toBe("Row 1, column 3, your 1, wrong");
    act(() => setHighlightWrong(false));
    expect(document.querySelector(".err")).toBeNull();
    expect(c2().getAttribute("aria-label")).toBe("Row 1, column 3, your 1");
  });

  it("изменение в другой вкладке (событие storage) подхватывается", () => {
    render(snapOf({ play: wrongPlay, selected: 2 }));
    localStorage.setItem(HIGHLIGHT_WRONG_KEY, "1");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: HIGHLIGHT_WRONG_KEY })));
    expect(c2().classList.contains("err")).toBe(true);
  });

  it("выкл не мешает остальному: «та же цифра», выбор, заданные клетки", () => {
    render(snapOf({ play: wrongPlay, selected: 2 }));
    expect(c2().classList.contains("sel")).toBe(true);
    expect(document.querySelector('.cell[data-i="0"]')!.getAttribute("aria-label")).toBe("Row 1, column 1, clue 5");
    // другая клетка с такой же неверной цифрой подсвечивается как «та же», а не как ошибка
    const two = { ...wrongPlay, values: wrongPlay.values.map((v, i) => (i === 3 ? 1 : v)) };
    render(snapOf({ play: two, selected: 2 }));
    expect(document.querySelector('.cell[data-i="3"]')!.classList.contains("same")).toBe(true);
    expect(document.querySelector(".err")).toBeNull();
  });

  it("Ink не затронут: неверная цифра в ink-партии (правило «не заменять») подсвечена при выкл", () => {
    const ink = { ...wrongPlay, ink: true as const };
    render(snapOf({ play: ink, selected: 2 }));
    expect(c2().classList.contains("err")).toBe(true);
    expect(document.querySelector(".ring")!.classList.contains("err")).toBe(true);
  });
});

describe("PD-89: M3 стаггер от поставленной клетки", () => {
  it("--wi берётся из steps (расстояние по юниту), а не из порядка клеток", () => {
    const cells = row(0);
    const steps = [2, 1, 0, 1, 2, 3, 4, 5, 6];
    render(snapOf({ wave: { cells, steps, id: 1 } }));
    cells.forEach((c, k) => {
      expect(document.querySelector<HTMLElement>(`.cell[data-i="${c}"]`)!.style.getPropertyValue("--wi")).toBe(String(steps[k]));
    });
  });
});

describe("PD-89: M8 эхо закрытой цифры", () => {
  const cells = [0, 14, 71, 24, 28, 40, 52, 57, 74];
  it("клетки цифры получают echo-a/b, --ei в порядке постановки и общую задержку --ed; остальные — нет", () => {
    render(snapOf({ echo: { digit: 5, cells, delay: 180, id: 1 } }));
    expect(document.querySelectorAll(".cell.echo")).toHaveLength(9);
    cells.forEach((c, n) => {
      const el = document.querySelector<HTMLElement>(`.cell[data-i="${c}"]`)!;
      expect(el.classList.contains("echo-a")).toBe(true);
      expect(el.style.getPropertyValue("--ei")).toBe(String(n));
      expect(el.style.getPropertyValue("--ed")).toBe("180");
    });
    render(snapOf({ echo: { digit: 5, cells, delay: 60, id: 2 } }));
    expect(document.querySelector('.cell[data-i="0"]')!.classList.contains("echo-b")).toBe(true);
    expect(document.querySelectorAll(".cell.echo-a")).toHaveLength(0);
  });

  it("без echo в снапшоте классов нет, число узлов не меняется", () => {
    render(snapOf({}));
    const base = total();
    render(snapOf({ echo: { digit: 5, cells, delay: 60, id: 1 } }));
    expect(total()).toBe(base);
    render(snapOf({ echo: null }));
    expect(document.querySelectorAll(".cell.echo")).toHaveLength(0);
  });
});

describe("PD-89: события движения гаснут сами", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("волна и эхо снимают классы по таймеру, чтобы пересборка клетки не переигрывала стухшую анимацию", () => {
    render(snapOf({ wave: { cells: row(0), id: 1 }, echo: { digit: 5, cells: [0, 14], delay: 60, id: 1 } }));
    expect(document.querySelectorAll(".cell.wave")).toHaveLength(9);
    expect(document.querySelectorAll(".cell.echo")).toHaveLength(2);
    wait(MOTION_MS.wave);
    expect(document.querySelectorAll(".cell.wave")).toHaveLength(0);
    wait(MOTION_MS.echo);
    expect(document.querySelectorAll(".cell.echo")).toHaveLength(0);
  });

  it("M7: клетка вжимается (blotting) на 620 мс; тап в любой точке завершает момент сразу", () => {
    expect(BLOT_MOMENT_MS).toBe(620);
    render(snapOf({ blot: { cell: 2, digit: 5, id: 1 } }));
    expect(document.querySelectorAll(".cell.blotting").length).toBeGreaterThan(0);
    wait(BLOT_MOMENT_MS - 1);
    expect(document.querySelectorAll(".cell.blotting").length).toBeGreaterThan(0);
    wait(1);
    expect(document.querySelectorAll(".cell.blotting")).toHaveLength(0);

    render(snapOf({ blot: { cell: 2, digit: 5, id: 2 } }));
    expect(document.querySelectorAll(".cell.blotting").length).toBeGreaterThan(0);
    act(() => void window.dispatchEvent(new Event("pointerdown")));
    expect(document.querySelectorAll(".cell.blotting")).toHaveLength(0);
  });
});
