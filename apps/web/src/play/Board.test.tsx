// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../i18n";
import { Board } from "./Board";
import { createPlay } from "./logic";
import type { PlaySnapshot, PlayStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const play = createPlay({ mission: MISSION, solution: SOLUTION });
const fakeStore = { select: () => undefined, moveSelection: () => null } as unknown as PlayStore;

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

describe("выбранная неверная клетка", () => {
  it("кольцо выбора получает класс err (сургуч снаружи), у верной клетки — нет", () => {
    const wrong = { ...play, values: play.values.map((v, i) => (i === 2 ? 1 : v)) }; // решение клетки 2 — 4
    render(snapOf({ play: wrong, selected: 2 }));
    expect(document.querySelector(".ring")!.classList.contains("err")).toBe(true);
    render(snapOf({ selected: 2 }));
    expect(document.querySelector(".ring")!.classList.contains("err")).toBe(false);
  });
});
