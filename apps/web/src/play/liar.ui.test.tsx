// @vitest-environment jsdom
/**
 * PD-171: Лжец на экране Play. Главное — чек-лист утечек: до поимки DOM (разметка, классы, aria-подписи, data-атрибуты, тексты)
 * НЕ зависит от того, какая подсказка лжёт, — две партии с одинаковым полем и разными секретами рисуются байт-в-байт одинаково,
 * в том числе с неверной цифрой при включённой «Подсветке ошибок» и после неверного обвинения. Дальше: жест «обвинить» (долгое
 * нажатие → меню с одним пунктом), «⋯ → Обвинить», клавиша A, оправданная/пойманная клетка, подписи VoiceOver, карточка,
 * таймлапс, хаб и шит режима (Лжец дня), Year.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { dailyLiarPuzzle, timelapseFrames } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { setHighlightWrong } from "../settings/prefs";
import { progressOf } from "../sync/fixtures";
import { YearScreen } from "../year/YearScreen";
import { LONG_PRESS_MS } from "./controls";
import { accuseCell, createLiarPlay, liarSummaryOf, liarTimelapseLayer } from "./liar";
import type { PlayState } from "./logic";
import { enterDigit } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { ReplayField } from "./ReplayField";
import { ResultCard } from "./ResultCard";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATE = "2026-10-05";
let P: LiarPuzzle;
interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};

beforeAll(async () => {
  P = dailyLiarPuzzle(DATE, "medium");
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

const givens = (s: PlayState) => s.mission.flatMap((g, i) => (g !== 0 ? [i] : []));
const empties = (s: PlayState) => s.mission.flatMap((g, i) => (g === 0 ? [i] : []));
const real = (): PlayState =>
  createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
/** Та же видимая сетка, другой секрет: лжец — другая подсказка, другое «решение». */
const decoy = (): PlayState => {
  const s = real();
  const other = givens(s).find((c) => c !== P.liarCell)!;
  const shown = s.mission[other]!;
  return {
    ...s,
    solution: s.solution.map((d) => (d % 9) + 1),
    liar: { liarCell: other, liarDigit: shown as never, trueDigit: ((shown % 9) + 1) as never, honestMission: "0".repeat(81) },
  };
};
/** Подсказка, честная в обеих партиях. */
const bothHonest = (s: PlayState, d: PlayState) => givens(s).find((c) => c !== s.liar!.liarCell && c !== d.liar!.liarCell)!;

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
const pointer = (el: Element, type: string, x = 10, y = 10) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 })));
const cell = (i: number) => host.querySelector<HTMLElement>(`.cell[data-i="${i}"]`)!;
const render = () => act(() => root.render(<PlayScreen />));
const playing = (play: PlayState, extra: Record<string, unknown> = {}) =>
  (inner.snap = {
    ...inner.snap,
    hub: false,
    restoring: false,
    phase: "playing",
    mode: "liar",
    difficulty: "medium",
    daily: null,
    play,
    selected: empties(play)[0],
    notesMode: false,
    startedOn: new Date(2026, 9, 5, 12),
    ...extra,
  });
const longPress = (i: number) => {
  pointer(cell(i), "pointerdown");
  act(() => void vi.advanceTimersByTime(LONG_PRESS_MS + 10));
  pointer(cell(i), "pointerup");
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  inner.snap = { ...base };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  setHighlightWrong(true); // самый «болтливый» режим: ошибки подсвечиваются — до поимки их всё равно быть не должно
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setHighlightWrong(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("утечки до поимки", () => {
  const snapshotOf = (play: PlayState): string => {
    playing(play);
    render();
    const html = host.innerHTML + [...document.body.children].filter((n) => n !== host).map((n) => n.outerHTML).join("");
    act(() => root.render(<></>));
    return html;
  };

  it("DOM одинаков при любом секрете: свежая партия, неверная цифра с подсветкой ошибок, неверное обвинение", () => {
    const a = real();
    const b = decoy();
    expect(snapshotOf(a)).toBe(snapshotOf(b));
    // Цифра, неверная по одному «решению» и верная по другому, — ни кольца ошибки, ни подписи «wrong».
    const c = empties(a)[0]!;
    const a2 = enterDigit(a, c, a.solution[c]! === 1 ? 2 : 1, 500);
    const b2 = enterDigit(b, c, a.solution[c]! === 1 ? 2 : 1, 500);
    const html = snapshotOf(a2);
    expect(html).toBe(snapshotOf(b2));
    expect(html).not.toMatch(/\berr\b/);
    expect(html.toLowerCase()).not.toContain("wrong digit");
    // Неверное обвинение подсказки, честной в обеих партиях, — та же оправданная печать.
    const y = bothHonest(a, b);
    const a3 = accuseCell(a2, y, 600)!.play;
    const b3 = accuseCell(b2, y, 600)!.play;
    expect(snapshotOf(a3)).toBe(snapshotOf(b3));
  });

  it("до поимки нет лампочки подсказок, а клетка лжеца выглядит как любая подсказка (сериф, без печати)", () => {
    playing(real());
    render();
    expect(q("hint-button")).toBeNull();
    const c = cell(P.liarCell);
    expect(c.querySelector(".d.given")!.textContent).toBe(String(P.liarDigit));
    expect(c.querySelector(".seal, .lie")).toBeNull();
    expect(c.className).toBe(cell(givens(real()).find((g) => g !== P.liarCell)!).className);
    expect(c.getAttribute("aria-label")).toBe(`Row ${Math.floor(P.liarCell / 9) + 1}, column ${(P.liarCell % 9) + 1}, clue ${P.liarDigit}, press and hold to accuse`);
  });
});

describe("обвинение на поле", () => {
  it("долгое нажатие на подсказку → меню с одним пунктом; неверное → «оправдана», повторно меню не открывается", () => {
    playing(real());
    render();
    const y = givens(real()).find((g) => g !== P.liarCell)!;
    longPress(y);
    const menu = q("accuse-menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
    // Хвост жеста (палец отпущен над пунктом без нового нажатия) пункт не нажимает.
    tap(q("accuse-confirm")!);
    expect(playStore.getSnapshot().play!.accusations).toHaveLength(0);
    pointer(q("accuse-confirm")!, "pointerdown");
    tap(q("accuse-confirm")!);
    expect(q("accuse-menu")).toBeNull();
    expect(playStore.getSnapshot().play!.accusations).toHaveLength(1);
    expect(cell(y).classList.contains("acquitted")).toBe(true);
    expect(cell(y).querySelector(".seal")).not.toBeNull();
    expect(cell(y).getAttribute("aria-label")).toContain("acquitted");
    expect(q("status-line")!.querySelector(".st-long")!.textContent).toBe("Acquitted · 1 wrong");
    expect(q("status-line")!.querySelector(".st-short")!.textContent).toBe("Acquitted"); // AX3: короткая форма
    longPress(y);
    expect(q("accuse-menu")).toBeNull();
    act(() => void cell(y).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(q("accuse-menu")).toBeNull();
    // Пустая клетка меню не открывает вовсе.
    longPress(empties(real())[0]!);
    expect(q("accuse-menu")).toBeNull();
  });

  it("верное обвинение: истинная цифра, зачёркнутая ложь, печать; включаются подсветка ошибок и подсказки", () => {
    const c = empties(real())[0]!;
    const wrong = real().solution[c]! === 1 ? 2 : 1;
    playing(enterDigit(real(), c, wrong, 100));
    render();
    expect(cell(c).classList.contains("err")).toBe(false);
    act(() => void cell(P.liarCell).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    pointer(q("accuse-confirm")!, "pointerdown");
    tap(q("accuse-confirm")!);
    const lc = cell(P.liarCell);
    expect(lc.classList.contains("caught")).toBe(true);
    expect(lc.querySelector(".d.given")!.textContent).toBe(String(P.trueDigit));
    expect(lc.querySelector(".lie")!.textContent).toBe(String(P.liarDigit));
    expect(lc.getAttribute("aria-label")).toContain(`the lie ${P.liarDigit} is struck out`);
    expect(cell(c).classList.contains("err")).toBe(true); // подсветка ошибок снова работает
    expect(q("hint-button")).not.toBeNull(); // и лесенка подсказок
    expect(q("status-line")!.querySelector(".st-long")!.textContent).toBe("Liar caught");
    // После поимки обвинять нельзя: ни жеста, ни пункта меню.
    const y = givens(real()).find((g) => g !== P.liarCell)!;
    act(() => void cell(y).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(q("accuse-menu")).toBeNull();
    tap(q("more-button")!);
    expect(q("menu-accuse")).toBeNull();
  });

  it("«⋯ → Обвинить эту цифру…»: недоступно без выбранной подсказки (с причиной), с подсказкой — то же меню; клавиша A", () => {
    playing(real());
    render();
    tap(q("more-button")!);
    expect(q("menu-accuse")!.getAttribute("aria-disabled")).toBe("true");
    expect(q("menu-accuse-why")!.textContent).toBe("Select a given digit first");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const y = givens(real()).find((g) => g !== P.liarCell)!;
    act(() => playStore.select(y));
    if (q("more-menu")) tap(q("more-scrim")!);
    tap(q("more-button")!);
    expect(q("menu-accuse")!.getAttribute("aria-disabled")).toBe("false");
    tap(q("menu-accuse")!);
    expect(q("accuse-menu")).not.toBeNull();
    expect(q("accuse-desc")!.textContent).toContain(`row ${Math.floor(y / 9) + 1}, column ${(y % 9) + 1}`);
    pointer(q("accuse-scrim")!, "pointerdown");
    tap(q("accuse-scrim")!);
    expect(q("accuse-menu")).toBeNull();
    // Клавиатура: A на выбранной подсказке.
    act(() => void host.querySelector(".play")!.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", key: "a", bubbles: true })));
    expect(q("accuse-menu")).not.toBeNull();
  });

  it("Ink в Лжеце недоступен: чип режима — Лжец, отметки чернил нет", () => {
    playing(real());
    render();
    expect(q("mode-chip")!.getAttribute("data-mode")).toBe("liar");
    expect(playStore.setInk(true)).toBe(false);
  });
});

describe("итог партии", () => {
  const solvedPlay = (): PlayState => {
    let s = real();
    const y = givens(s).find((g) => g !== P.liarCell)!;
    s = accuseCell(s, y, 50)!.play;
    empties(s).forEach((c, k) => {
      s = enterDigit(s, c, s.solution[c]!, 1000 * (k + 1));
    });
    return accuseCell(s, P.liarCell, 999_000)!.play;
  };

  it("карточка: ход обвинения, неверные, время поимки, сравнение с собой", () => {
    const play = solvedPlay();
    const sum = liarSummaryOf(play)!;
    act(() =>
      root.render(<ResultCard play={play} cardRef={{ current: null }} title="Liar caught" liar={{ info: sum, average: { avg: 31, games: 4 } }} />),
    );
    expect(q("liar-move-row")!.textContent).toBe(`Catch move${empties(real()).length}`);
    expect(q("liar-accuse-row")!.textContent).toBe("Accusations1 wrong");
    expect(q("liar-time-row")!.textContent).toBe("Caught at16:39");
    expect(q("liar-compare")!.textContent).toBe("Your average catch move: 31 (4 earlier games)");
    act(() => root.render(<ResultCard play={play} cardRef={{ current: null }} title="x" liar={{ info: { ...sum, firstTry: true, wrongAccusations: 0 }, average: null }} />));
    expect(q("liar-accuse-row")!.textContent).toBe("Accusationsfirst try");
    expect(q("liar-compare")!.textContent).toBe("Your first catch — nothing to compare with yet.");
  });

  it("таймлапс: до кадра поимки в клетке ложь, после — истина с зачёркнутой ложью; оправданная — печать", () => {
    const play = solvedPlay();
    const frames = timelapseFrames(play.log, { mission: play.mission.join(""), solution: play.solution.join("") }).frames;
    const layer = liarTimelapseLayer(play, frames)!;
    const at = (idx: number) =>
      act(() => root.render(<ReplayField frames={frames} idx={idx} mission={play.mission} blots={new Map()} animate={false} label="x" liar={layer} />));
    at(0);
    const lc = () => host.querySelector<HTMLElement>(`.tl-field [data-i="${P.liarCell}"]`)!;
    expect(lc().querySelector(".d")!.textContent).toBe(String(P.liarDigit));
    expect(lc().querySelector(".lie")).toBeNull();
    expect(host.querySelectorAll(".tl-field .acquitted")).toHaveLength(1); // обвинение до первого хода
    at(frames.length - 1);
    expect(lc().querySelector(".d")!.textContent).toBe(String(P.trueDigit));
    expect(lc().querySelector(".lie")!.textContent).toBe(String(P.liarDigit));
  });
});

describe("хаб и шит режима", () => {
  it("Лжец — строка списка «Режимы»; шит Лжеца — строка «Лжец дня» над сложностью; тап открывает Лжеца дня", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    render();
    tap(q("mode-liar")!);
    expect(q("mode-sheet")!.getAttribute("data-mode")).toBe("liar");
    expect(q("liar-daily")!.textContent).toContain("Liar of the day");
    expect(q("liar-daily")!.textContent).toContain("Medium · the same for everyone today");
    tap(q("liar-daily")!);
    expect(playStore.getSnapshot()).toMatchObject({ daily: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), mode: "liar", hub: false, phase: "loading" });
    act(() => playStore.toHub());
  });

  it("незаконченный Лжец дня — строка «Продолжить» с подписью слота", () => {
    const play = enterDigit(real(), empties(real())[0]!, 1, 100);
    playing(play, { daily: "2099-01-01", hub: true });
    vi.spyOn(playStore, "liarDaySlot").mockReturnValue({ difficulty: "medium", left: 40, elapsedMs: 65_000, ink: false });
    render();
    expect(q("continue-liar-day")!.textContent).toContain("Liar of the day");
    expect(q("continue-liar-day")!.textContent).toContain("Medium · 40 cells left · 1:05");
  });
});

describe("Year", () => {
  it("день с пойманным Лжецом дня — вторичная отметка на клетке дня, легенда; цвет клетки — качество классики", () => {
    const liar = new Map([["2026-10-03", { caught: true, firstTry: true, wrongAccusations: 0, catchT: 1000, catchPlacement: 12 }]]);
    const days = [progressOf("2026-10-03", { withFix: true })];
    act(() => root.render(<YearScreen days={days} firstUse="2026-10-01" liar={liar} today="2026-10-05" onOpenToday={() => undefined} onPlayDay={() => undefined} />));
    const mark = host.querySelector('.year-month [data-date="2026-10-03"]')!;
    expect(mark.querySelector(".ylie")).not.toBeNull();
    expect(mark.className).toBe("ymark is-solved has-corr"); // цвет/форма — качество классики, отметка — отдельным слоем
    expect(host.querySelector('.year-month [data-date="2026-10-04"] .ylie')).toBeNull();
    // Шит месяца: подпись дня называет пойманного лжеца словами; карточка дня — строка Лжеца дня.
    act(() => host.querySelector<HTMLElement>('[data-month="9"]')!.click());
    expect(document.querySelector('.ycell[data-date="2026-10-03"]')!.getAttribute("aria-label")).toContain("liar caught");
    act(() => document.querySelector<HTMLElement>('.ycell[data-date="2026-10-03"]')!.click());
    expect(q("liar-year-row")!.textContent).toBe("Liar of the daycaught, move 12 · first try");
    expect(q("year-legend-liar")!.textContent).toBe("Liar caught");
    expect(host.querySelector('[data-month="9"]')!.getAttribute("aria-label")).toContain("1 liar caught");
  });
});
