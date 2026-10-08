// @vitest-environment jsdom
/**
 * PD-232 (а), аудит PD-228 п. 1: клавиатура партии работает без клика по клетке. Раньше ввод висел только на `onKeyDown`
 * корня `.play`, и после загрузки (фокус на <body>), клика по вкладке таб-бара или по пустому месту 1–9, стрелки,
 * Backspace/Delete и заметки молчали. Теперь — слушатель на document, пока партия на экране (вкладка активна, идёт игра);
 * молчит, если открыт шит/меню/диалог, фокус в поле ввода или нажат Cmd/Ctrl/Alt (кроме уже принятых сочетаний).
 */
import { dailyLiarPuzzle, dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { MelodyAudio } from "../melody/audio";
import { setMelodyAudioFactory } from "../melody/factory";
import { setMelodySound } from "../settings/prefs";
import { TabActiveContext } from "../shell/tabSlide";
import type { DayDeps } from "../today/dayStore";
import { DayStore } from "../today/dayStore";
import { InMemoryProgressRepository } from "../today/repository";
import { DayView } from "../today/TodayScreen";
import { createLiarPlay } from "./liar";
import type { PlayState } from "./logic";
import { createPlay, setGlyphMode, setInkMode, setLanternMode, setMelodyMode } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
/** Клетка (0,2) пустая, верная цифра — 4. */
const CELL = 2;

interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};
let notes: number[] = [];
let restoreFactory: () => void = () => undefined;
const fakeAudio = (): MelodyAudio => ({
  unlock: () => true,
  attachUnlock: () => () => undefined,
  playNote: (d) => (notes.push(d), true),
  playUnit: () => true,
  playPath: () => ({ stop: () => undefined, done: Promise.resolve("stopped" as const) }),
  setMuted: () => undefined,
  isMuted: () => false,
  setTimbre: () => undefined,
  getTimbre: () => "marimba",
  state: () => "running",
  dispose: () => undefined,
});

beforeAll(async () => {
  restoreFactory = setMelodyAudioFactory(fakeAudio);
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});
afterAll(() => restoreFactory());

let host: HTMLDivElement;
let root: Root;
/** Кнопка вне экрана партии — как вкладка таб-бара. */
let outside: HTMLButtonElement;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const cell = (i: number) => host.querySelector<HTMLElement>(`.cell[data-i="${i}"]`)!;
const key = (target: EventTarget, init: KeyboardEventInit) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
};
const digit = (target: EventTarget, d: number, extra: KeyboardEventInit = {}) => key(target, { code: `Digit${d}`, key: String(d), ...extra });
const snap = () => playStore.getSnapshot();
const valueAt = (i: number) => snap().play!.values[i];
const notesAt = (i: number) => snap().play!.notes[i];

const playing = (play: PlayState, mode = "classic", extra: Record<string, unknown> = {}) =>
  (inner.snap = {
    ...inner.snap,
    hub: false,
    restoring: false,
    phase: "playing",
    mode,
    difficulty: "medium",
    daily: null,
    play,
    selected: CELL,
    notesMode: false,
    startedOn: new Date(2026, 9, 5, 12),
    ...extra,
  });
const classic = () => createPlay({ mission: MISSION, solution: SOLUTION });
const render = (active = true) =>
  act(() =>
    root.render(
      <TabActiveContext.Provider value={active}>
        <PlayScreen />
      </TabActiveContext.Provider>,
    ),
  );

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  setMelodySound(true);
  notes = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  inner.snap = { ...base };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  host = document.createElement("div");
  document.body.append(host);
  outside = document.createElement("button");
  outside.textContent = "Today";
  document.body.append(outside);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  outside.remove();
  for (const el of document.querySelectorAll("[data-test-overlay]")) el.remove();
  vi.unstubAllGlobals();
});

describe("Play: ввод без фокуса в партии", () => {
  it("цифра с <body> (сразу после загрузки) ставится в выбранную клетку", () => {
    playing(classic());
    render();
    expect(document.activeElement).toBe(document.body);
    const e = digit(document.body, 4);
    expect(valueAt(CELL)).toBe(4);
    expect(e.defaultPrevented).toBe(true);
  });

  it("цифра с вкладки таб-бара (фокус на кнопке вне экрана) — тоже ввод", () => {
    playing(classic());
    render();
    outside.focus();
    digit(outside, 4);
    expect(valueAt(CELL)).toBe(4);
    expect(document.activeElement).toBe(outside); // фокус не отбираем
  });

  it("Shift/Alt+цифра — заметка; N — режим заметок; Backspace/Delete — стереть; Ctrl/Cmd+Z — отмена", () => {
    playing(classic());
    render();
    digit(document.body, 7, { shiftKey: true });
    expect(notesAt(CELL)! & (1 << 7)).toBeTruthy();
    digit(document.body, 8, { altKey: true });
    expect(notesAt(CELL)! & (1 << 8)).toBeTruthy();
    key(document.body, { code: "KeyN", key: "n" });
    expect(snap().notesMode).toBe(true);
    key(document.body, { code: "KeyN", key: "n" });
    expect(snap().notesMode).toBe(false);
    digit(document.body, 4);
    expect(valueAt(CELL)).toBe(4);
    key(document.body, { key: "Backspace", code: "Backspace" });
    expect(valueAt(CELL)).toBe(0);
    digit(document.body, 4);
    key(document.body, { key: "Delete", code: "Delete" });
    expect(valueAt(CELL)).toBe(0);
    digit(document.body, 4);
    key(document.body, { code: "KeyZ", key: "z", metaKey: true });
    expect(valueAt(CELL)).toBe(0);
  });

  it("стрелка с <body> двигает выбор и уводит фокус на клетку (дальше — обычная навигация поля)", () => {
    playing(classic());
    render();
    const e = key(document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(snap().selected).toBe(CELL + 1);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cell(CELL + 1));
    key(document.activeElement!, { key: "ArrowDown", code: "ArrowDown" });
    expect(snap().selected).toBe(CELL + 1 + 9);
  });

  it("стрелки с вкладки таб-бара не трогаем — там они переключают вкладки", () => {
    playing(classic());
    render();
    outside.focus();
    key(outside, { key: "ArrowRight", code: "ArrowRight" });
    expect(snap().selected).toBe(CELL);
    expect(document.activeElement).toBe(outside);
  });

  it("Cmd/Ctrl/Alt + стрелка или Cmd/Ctrl + цифра — не перехватываются (системные сочетания)", () => {
    playing(classic());
    render();
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      const e = digit(document.body, 4, mod);
      expect(e.defaultPrevented).toBe(false);
    }
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const e = key(document.body, { key: "ArrowLeft", code: "ArrowLeft", ...mod });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(valueAt(CELL)).toBe(0);
    expect(snap().selected).toBe(CELL);
  });

  it("фокус в поле ввода / textarea / contenteditable — клавиши не наши", () => {
    playing(classic());
    render();
    for (const tag of ["input", "textarea", "div"]) {
      const el = document.createElement(tag);
      el.setAttribute("data-test-overlay", "");
      if (tag === "div") el.setAttribute("contenteditable", "true");
      document.body.append(el);
      digit(el, 4);
      key(el, { key: "Backspace", code: "Backspace" });
      key(el, { key: "ArrowRight", code: "ArrowRight" });
    }
    expect(valueAt(CELL)).toBe(0);
    expect(snap().selected).toBe(CELL);
  });

  it("открыт шит/меню/диалог (порталом в body) — ввод в клетку молчит, даже если фокус ушёл на <body>", () => {
    playing(classic());
    render();
    for (const attrs of [{ role: "dialog", "aria-modal": "true" }, { role: "menu" }, { role: "alertdialog" }]) {
      const el = document.createElement("div");
      el.setAttribute("data-test-overlay", "");
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.body.append(el);
      digit(document.body, 4);
      key(document.body, { key: "ArrowRight", code: "ArrowRight" });
      el.remove();
    }
    expect(valueAt(CELL)).toBe(0);
    expect(snap().selected).toBe(CELL);
  });

  it("вкладка неактивна (Play под другой вкладкой или под Settings) — молчит", () => {
    playing(classic());
    render(false);
    digit(document.body, 4);
    key(document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(valueAt(CELL)).toBe(0);
    expect(snap().selected).toBe(CELL);
  });

  it("хаб Play (партии на экране нет) — молчит", () => {
    playing(classic(), "classic", { hub: true });
    render();
    digit(document.body, 4);
    expect(valueAt(CELL)).toBe(0);
  });

  it("фокус внутри экрана — ввод идёт один раз (не дублируется глобальным слушателем)", () => {
    playing(classic());
    render();
    cell(CELL).focus();
    key(cell(CELL), { code: "KeyN", key: "n" });
    expect(snap().notesMode).toBe(true); // дважды переключённый остался бы false
  });
});

describe("Play: режимы", () => {
  it("Чернила: цифра с <body> ставится (без Undo)", () => {
    playing(setInkMode(classic(), true), "ink");
    render();
    digit(document.body, 4);
    expect(valueAt(CELL)).toBe(4);
  });

  it("Глифы: клавиша 1–9 с <body> ставит знак (значение клетки)", () => {
    playing(setGlyphMode(classic()), "glyphs");
    render();
    digit(document.body, 4);
    expect(valueAt(CELL)).toBe(4);
    expect(cell(CELL).querySelector("svg.gl")).not.toBeNull();
  });

  it("Мелодия: цифра с <body> ставится и звучит нота", () => {
    playing(setMelodyMode(classic()), "melody");
    render();
    digit(document.body, 4);
    expect(valueAt(CELL)).toBe(4);
    expect(notes).toContain(4);
  });

  it("Лжец: A с <body> на подсказке открывает меню «Обвинить»", () => {
    const P = dailyLiarPuzzle("2026-10-05", "medium");
    const play = createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
    const given = Array.from(play.mission).findIndex((g) => Number(g) !== 0);
    playing(play, "liar", { selected: given });
    render();
    key(document.body, { code: "KeyA", key: "a" });
    expect(q('[data-testid="accuse-menu"]')).not.toBeNull();
  });
});

describe("Today: ввод без фокуса в партии", () => {
  const NOW = new Date(2026, 8, 29, 12, 0);
  const dayStore = () => {
    const deps: DayDeps = {
      repo: new InMemoryProgressRepository(),
      fetchDay: vi.fn(async (d: string) => ({
        ok: true as const,
        puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 58.2 },
      })),
      verify: vi.fn(async () => true),
      generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
      now: () => NOW,
      isOnline: () => true,
      slowFetchMs: 50,
    };
    return new DayStore(deps);
  };
  const started = async (active = true) => {
    const s = dayStore();
    await act(async () =>
      root.render(
        <TabActiveContext.Provider value={active}>
          <DayView store={s} />
        </TabActiveContext.Provider>,
      ),
    );
    await act(async () => s.ensureStarted());
    await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
    const p = s.getSnapshot().play!;
    const empty = Array.from(p.mission).findIndex((g) => Number(g) === 0);
    act(() => s.select(empty));
    return { s, empty };
  };

  it("цифра и стрелка с <body> работают на Today", async () => {
    const { s, empty } = await started();
    (document.activeElement as HTMLElement | null)?.blur();
    digit(document.body, 1, { shiftKey: true });
    expect(s.getSnapshot().play!.notes[empty]! & (1 << 1)).toBeTruthy();
    key(document.body, { key: "ArrowDown", code: "ArrowDown" });
    expect(s.getSnapshot().selected).toBe(empty + 9);
  });

  it("вкладка Today неактивна — молчит", async () => {
    const { s, empty } = await started(false);
    digit(document.body, 1, { shiftKey: true });
    expect(s.getSnapshot().play!.notes[empty]).toBe(0);
  });
});

describe("PD-232 (г): Esc в партии снимает выбор, из партии не выводит", () => {
  const esc = (target: EventTarget = document.body, extra: KeyboardEventInit = {}) => key(target, { key: "Escape", code: "Escape", ...extra });

  it("Play: Esc с <body> и с клетки снимает выбор; партия на месте; стрелка на клетке выбирает её снова", () => {
    playing(classic());
    render();
    const e = esc();
    expect(snap().selected).toBeNull();
    expect(e.defaultPrevented).toBe(true);
    expect(snap().hub).toBe(false);
    expect(host.querySelector(".board")).not.toBeNull();
    act(() => playStore.select(CELL));
    cell(CELL).focus();
    esc(cell(CELL));
    expect(snap().selected).toBeNull();
    key(cell(CELL), { key: "ArrowRight", code: "ArrowRight" });
    expect(snap().selected).toBe(CELL); // выбор вернулся туда, где фокус, а не сдвинулся с «ничего»
    // Ничего не выбрано: Esc с <body>, затем стрелка — выбор с остановки поля (клетка 0).
    esc(cell(CELL));
    (document.activeElement as HTMLElement).blur();
    key(document.body, { key: "ArrowDown", code: "ArrowDown" });
    expect(snap().selected).toBe(0);
    expect(document.activeElement).toBe(cell(0));
  });

  it("Esc с модификатором — не наш", () => {
    playing(classic());
    render();
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) esc(document.body, mod);
    expect(snap().selected).toBe(CELL);
  });

  it("Esc при открытом шите/меню — их (выбор не снимается)", () => {
    playing(classic());
    render();
    const el = document.createElement("div");
    el.setAttribute("data-test-overlay", "");
    el.setAttribute("role", "menu");
    document.body.append(el);
    esc();
    expect(snap().selected).toBe(CELL);
  });
});

describe("PD-244 (QA PD-233): Esc в осмотре доски Фонаря — сначала заканчивает осмотр, потом док, потом выбор", () => {
  const esc = (target: EventTarget = document.body) => key(target, { key: "Escape", code: "Escape" });
  const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
  const tid = (id: string) => q(`[data-testid="${id}"]`);
  const light = () => host.querySelector(".board")!.getAttribute("data-lantern");
  const inspectFromMenu = () => {
    tap(tid("more-button")!);
    tap(tid("menu-inspect")!);
    expect(light()).toBe("inspect");
  };
  const lantern = () => {
    playing(setLanternMode(classic()), "lantern");
    render();
    expect(light()).toBe("lit");
  };

  it("Esc с кнопки ⋯ (фокус после меню), с <body> и с клетки: первый — конец осмотра (выбор цел), второй — снимает выбор; партия на месте", () => {
    lantern();
    inspectFromMenu();
    // Фокус вернулся на «⋯» — Esc оттуда (сценарий QA).
    const e = esc(document.activeElement ?? document.body);
    expect(e.defaultPrevented).toBe(true);
    expect(light()).toBe("lit");
    expect(snap().selected).toBe(CELL);
    expect(tid("mode-chip")!.getAttribute("data-inspecting")).toBeNull();
    esc();
    expect(snap().selected).toBeNull();
    expect(light()).toBe("dark");
    esc();
    expect(snap().hub).toBe(false);
    expect(host.querySelector(".board")).not.toBeNull();
    // С <body> и с клетки — так же.
    act(() => playStore.select(CELL));
    inspectFromMenu();
    (document.activeElement as HTMLElement | null)?.blur();
    esc();
    expect(light()).toBe("lit");
    inspectFromMenu();
    cell(CELL).focus();
    esc(cell(CELL));
    expect(light()).toBe("lit");
    expect(snap().selected).toBe(CELL);
    esc(cell(CELL));
    expect(snap().selected).toBeNull();
  });

  it("осмотр и док вместе: Esc — осмотр, Esc — док, Esc — выбор", () => {
    lantern();
    inspectFromMenu();
    (document.activeElement as HTMLElement | null)?.blur();
    key(document.body, { key: "h", code: "KeyH" });
    // Первый раз — шит правила подсказок (это слой: пока открыт, Esc его, осмотр не трогается).
    const go = tid("hint-rule-go");
    if (go) {
      esc(go);
      expect(light()).toBe("inspect");
      key(document.body, { key: "h", code: "KeyH" });
      tap(tid("hint-rule-go")!);
    }
    expect(tid("hint-dock")).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    esc();
    expect(light()).not.toBe("inspect");
    expect(tid("hint-dock")).not.toBeNull();
    expect(snap().selected).toBe(CELL);
    esc();
    expect(tid("hint-dock")).toBeNull();
    expect(snap().selected).toBe(CELL);
    esc();
    expect(snap().selected).toBeNull();
  });

  it("открытое меню ⋯ поверх осмотра: Esc закрывает меню, осмотр остаётся; следующий Esc — конец осмотра", () => {
    lantern();
    inspectFromMenu();
    tap(tid("more-button")!);
    expect(tid("more-menu")).not.toBeNull();
    esc(document.activeElement ?? document.body);
    expect(tid("more-menu")).toBeNull();
    expect(light()).toBe("inspect");
    expect(snap().selected).toBe(CELL);
    esc(document.activeElement ?? document.body);
    expect(light()).toBe("lit");
  });

  it("выход из осмотра как раньше: пункт ⋯, «Готово», тап по полю; после Esc пункт снова включает осмотр", () => {
    lantern();
    inspectFromMenu();
    esc();
    tap(tid("more-button")!);
    expect(tid("menu-inspect")!.getAttribute("aria-checked")).toBe("false");
    tap(tid("menu-inspect")!);
    expect(light()).toBe("inspect");
    tap(tid("more-button")!);
    tap(tid("menu-inspect")!);
    expect(light()).toBe("lit");
    inspectFromMenu();
    act(() => playStore.select(null));
    tap(tid("inspect-done")!);
    expect(light()).toBe("dark");
    inspectFromMenu();
    tap(cell(CELL));
    expect(light()).toBe("lit");
  });

  it("классика: Esc по-прежнему снимает выбор с первого нажатия", () => {
    playing(classic());
    render();
    esc();
    expect(snap().selected).toBeNull();
  });
});

describe("PD-232 (г): Esc в архиве", () => {
  const NOW = new Date(2026, 8, 29, 12, 0);
  const DATE = "2026-09-20";
  const archiveStore = (pending: boolean) =>
    new DayStore(
      {
        repo: new InMemoryProgressRepository(),
        fetchDay: vi.fn(async (d: string) =>
          pending
            ? new Promise<never>(() => undefined)
            : { ok: true as const, puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 58.2 } },
        ),
        verify: vi.fn(async () => true),
        generateFallback: vi.fn(async (d, diff) => (pending ? new Promise<never>(() => undefined) : dailyPuzzle(d, diff))),
        now: () => NOW,
        isOnline: () => true,
        slowFetchMs: 60_000,
      },
      { archive: true },
    );

  it("идёт партия: Esc снимает выбор, «назад в Year» не зовётся", async () => {
    const s = archiveStore(false);
    const onBack = vi.fn();
    await act(async () => root.render(<DayView store={s} archive={{ date: DATE, onBack }} />));
    await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
    const empty = Array.from(s.getSnapshot().play!.mission).findIndex((g) => Number(g) === 0);
    act(() => s.select(empty));
    key(document.body, { key: "Escape", code: "Escape" });
    expect(s.getSnapshot().selected).toBeNull();
    key(document.body, { key: "Escape", code: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("партии нет (загрузка/недоступно/карточка): Esc = «‹ Year»", async () => {
    const s = archiveStore(true);
    const onBack = vi.fn();
    await act(async () => root.render(<DayView store={s} archive={{ date: DATE, onBack }} />));
    key(document.body, { key: "Escape", code: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
