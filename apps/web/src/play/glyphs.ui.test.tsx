// @vitest-environment jsdom
/**
 * PD-194: режим Глифы на экране. Маппинг цифра → форма (набор A PD-170), сигнатура «дано залитым / ваше контуром», заметки
 * мини-знаками, пад с контурными знаками и остатками, подписи VoiceOver именами форм (en/uk/ru), таймлапс знаками, строка
 * режима на хабе и старт партии из шита; Классика без изменений (ни одного знака).
 */
import { timelapseFrames } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { setHighlightWrong } from "../settings/prefs";
import { Board } from "./Board";
import { GamePad } from "./controls";
import type { PlaySnapshot } from "./gameStore";
import { GLYPH_FORMS, GLYPH_PATHS, glyphForm } from "./glyphs";
import type { PlayState } from "./logic";
import { createPlay, enterDigit, setGlyphMode, toggleNote } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { ReplayField } from "./ReplayField";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const glyphPlay = (): PlayState => setGlyphMode(createPlay({ mission: MISSION, solution: SOLUTION }));
const classicPlay = (): PlayState => createPlay({ mission: MISSION, solution: SOLUTION });
const fakeStore = { select: () => undefined, moveSelection: () => null } as unknown as Parameters<typeof Board>[0]["store"];
const snapOf = (play: PlayState, patch: Partial<PlaySnapshot> = {}): PlaySnapshot => ({
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

let host: HTMLDivElement;
let root: Root;
const cell = (i: number) => host.querySelector<HTMLElement>(`.cell[data-i="${i}"]`)!;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
const board = (play: PlayState, patch: Partial<PlaySnapshot> = {}) => act(() => root.render(<Board snap={snapOf(play, patch)} store={fakeStore} dim={false} />));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  setHighlightWrong(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  setHighlightWrong(false);
  await i18n.changeLanguage("en");
});

describe("маппинг цифра → форма (набор A «Фигуры», PD-170)", () => {
  it("пад 1→9: круг, треугольник, квадрат, плюс, ромб, купол, звезда, лист, песочные часы; формы уникальны", () => {
    expect(GLYPH_FORMS).toEqual(["circle", "triangle", "square", "plus", "diamond", "dome", "star", "leaf", "hourglass"]);
    expect(new Set(GLYPH_FORMS).size).toBe(9);
    expect(glyphForm(1)).toBe("circle");
    expect(glyphForm(9)).toBe("hourglass");
    expect(glyphForm(0)).toBeNull();
    expect(glyphForm(10)).toBeNull();
  });

  it("геометрия — дословно из макета (замкнутые силуэты в рамке 24)", () => {
    expect(GLYPH_PATHS.circle).toBe("M3.4 12a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0-17.2 0z");
    expect(GLYPH_PATHS.hourglass).toBe("M3.5 2h17L13.5 12l7 10h-17l7-10z");
    for (const f of GLYPH_FORMS) expect(GLYPH_PATHS[f]).toMatch(/z$/);
  });

  it("имена форм есть во всех трёх локалях и различаются внутри локали", () => {
    for (const loc of [en, uk, ru] as unknown as { glyphs: { shape: Record<string, string> } }[]) {
      const names = GLYPH_FORMS.map((f) => loc.glyphs.shape[f]);
      names.forEach((n) => expect(n).toEqual(expect.any(String)));
      expect(new Set(names).size).toBe(9);
    }
    expect(ru.glyphs.shape.circle).toBe("круг");
    expect(uk.glyphs.shape.circle).toBe("коло");
    expect(ru.glyphs.shape.hourglass).toBe("песочные часы");
  });
});

describe("поле", () => {
  it("дано — залитый знак, ваше — контур, ни одной цифры в клетках; та же цифра/выбор работают как раньше", () => {
    let play = glyphPlay();
    play = enterDigit(play, 2, 4, 1000); // верная: в решении (0,2) = 4 → плюс
    board(play);
    const given = cell(0).querySelector(".d.given.gd svg.gl")!; // 5 → ромб
    expect(given.getAttribute("data-form")).toBe("diamond");
    expect(given.querySelector("path.f")).not.toBeNull();
    expect(given.querySelector("path.o")).toBeNull();
    const mine = cell(2).querySelector(".d.player.gd svg.gl")!;
    expect(mine.getAttribute("data-form")).toBe("plus");
    expect(mine.querySelector("path.o")).not.toBeNull();
    expect(mine.querySelector("path.f")).toBeNull();
    for (const el of host.querySelectorAll(".cell .d")) expect(el.textContent).toBe("");
    // «та же цифра» по-прежнему по значению: все 4 (плюсы) на поле подсвечены
    expect(host.querySelectorAll(".cell.same").length).toBeGreaterThan(0);
  });

  it("заметки — залитые мини-знаки на позиции знака в паде; подпись перечисляет формы", () => {
    let play = glyphPlay();
    play = toggleNote(play, 2, 1, 100);
    play = toggleNote(play, 2, 5, 200);
    board(play);
    const slots = [...cell(2).querySelectorAll(".marks.gl-marks > span")];
    expect(slots).toHaveLength(9);
    expect(slots[0]!.querySelector("svg.gl-note")!.getAttribute("data-form")).toBe("circle");
    expect(slots[4]!.querySelector("svg.gl-note path.f")).not.toBeNull();
    expect(slots[1]!.childElementCount).toBe(0);
    expect(cell(2).getAttribute("aria-label")).toBe("Row 1, column 3, notes circle, diamond");
  });

  it("VoiceOver: имена форм вместо цифр — дано / ваш / ошибка (en и ru, uk)", async () => {
    setHighlightWrong(true);
    let play = glyphPlay();
    play = enterDigit(play, 2, 4, 1000);
    play = enterDigit(play, 3, 1, 2000); // неверная (в решении 6)
    board(play);
    expect(cell(0).getAttribute("aria-label")).toBe("Row 1, column 1, diamond, given");
    expect(cell(2).getAttribute("aria-label")).toBe("Row 1, column 3, plus, yours");
    expect(cell(3).getAttribute("aria-label")).toBe("Row 1, column 4, circle, yours, wrong");
    expect(cell(3).className).toContain("err");
    for (const el of host.querySelectorAll(".cell")) expect(el.getAttribute("aria-label")).not.toMatch(/(clue|your) \d/);
    await act(() => i18n.changeLanguage("ru"));
    board(play);
    expect(cell(0).getAttribute("aria-label")).toBe("Строка 1, столбец 1, ромб, дано");
    expect(cell(2).getAttribute("aria-label")).toBe("Строка 1, столбец 3, плюс, ваш знак");
    await act(() => i18n.changeLanguage("uk"));
    board(play);
    expect(cell(1).getAttribute("aria-label")).toBe("Рядок 1, стовпець 2, квадрат, дано");
  });

  it("Классика без изменений: цифры текстом, ни одного знака, прежние подписи", () => {
    board(classicPlay());
    expect(host.querySelector(".gl")).toBeNull();
    expect(cell(0).querySelector(".d")!.textContent).toBe("5");
    expect(cell(0).getAttribute("aria-label")).toBe("Row 1, column 1, clue 5");
  });
});

describe("пад", () => {
  const mkStore = () => ({ input: vi.fn(), undo: vi.fn(), erase: vi.fn(), toggleNotesMode: vi.fn(), fillCandidates: vi.fn() });

  it("контурные знаки в порядке 1→9, остатки на месте, подпись — имя формы; тап вводит цифру знака", () => {
    const store = mkStore();
    act(() => root.render(<GamePad snap={snapOf(glyphPlay())} store={store as never} />));
    const keys = [...host.querySelectorAll<HTMLButtonElement>(".pad.gl-pad .key")];
    expect(keys).toHaveLength(9);
    expect(keys.map((k) => k.querySelector("svg.gl-pad")!.getAttribute("data-form"))).toEqual([...GLYPH_FORMS]);
    expect(keys.every((k) => k.querySelector("svg.gl-pad path.o") !== null)).toBe(true);
    expect(keys.every((k) => k.querySelector(".kd")!.textContent === "")).toBe(true);
    // Остатки: пятёрок (ромбов) на поле 4 → осталось 5.
    expect(keys[4]!.querySelector(".kr")!.textContent).toBe(String(9 - [...MISSION].filter((c) => c === "5").length));
    expect(keys[4]!.getAttribute("aria-label")).toBe(`diamond, ${9 - [...MISSION].filter((c) => c === "5").length} left`);
    act(() => keys[6]!.click());
    expect(store.input).toHaveBeenCalledWith(7);
  });

  it("Классика: цифры на паде, прежние подписи", () => {
    act(() => root.render(<GamePad snap={snapOf(classicPlay())} store={mkStore() as never} />));
    expect(host.querySelector(".pad.gl-pad")).toBeNull();
    expect(host.querySelector(".key .kd")!.textContent).toBe("1");
    expect(host.querySelector(".key")!.getAttribute("aria-label")).toMatch(/^Enter 1, \d left$/);
  });
});

describe("таймлапс", () => {
  it("кадры показывают знаки (дано залитым, ваше контуром), цифр нет; Классика — цифрами", () => {
    let play = glyphPlay();
    play = enterDigit(play, 2, 4, 1000);
    play = enterDigit(play, 3, 6, 2000);
    const frames = timelapseFrames(play.log, { mission: MISSION, solution: SOLUTION }).frames;
    act(() => root.render(<ReplayField frames={frames} idx={frames.length - 1} mission={play.mission} blots={new Map()} animate={false} label="x" glyphs />));
    const at = (i: number) => host.querySelector(`.tl-field [data-i="${i}"] .d`)!;
    expect(at(0).querySelector("svg.gl-given")!.getAttribute("data-form")).toBe("diamond");
    expect(at(2).querySelector("svg.gl-placed")!.getAttribute("data-form")).toBe("plus");
    expect(at(3).querySelector("svg.gl-placed")!.getAttribute("data-form")).toBe("dome");
    for (const el of host.querySelectorAll(".tl-field .d")) expect(el.textContent).toBe("");
    act(() => root.render(<ReplayField frames={frames} idx={frames.length - 1} mission={play.mission} blots={new Map()} animate={false} label="x" />));
    expect(host.querySelector(".tl-field .gl")).toBeNull();
    expect(at(0).textContent).toBe("5");
  });
});

describe("хаб и старт партии", () => {
  interface Inner {
    snap: Record<string, unknown>;
    requestId: number;
    onGenerated(id: number, r: unknown): void;
  }
  const inner = playStore as unknown as Inner;
  let base: Record<string, unknown> = {};
  beforeAll(async () => {
    await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
    await playStore.flushed();
    base = { ...inner.snap };
  });

  it("строка «Глифы» со значком и описанием; шит → «Начать» → партия знаками с чипом режима", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
    inner.snap = { ...base };
    (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
    try {
      act(() => root.render(<PlayScreen />));
      const row = q("mode-glyphs")!;
      expect(row.textContent).toContain("Glyphs");
      expect(row.textContent).toContain("Nine shapes instead of digits.");
      tap(row);
      expect(q("mode-sheet")!.getAttribute("data-mode")).toBe("glyphs");
      tap(q("sheet-start")!);
      expect(playStore.getSnapshot()).toMatchObject({ mode: "glyphs", hub: false, phase: "loading" });
      act(() => inner.onGenerated(inner.requestId, { id: inner.requestId, ok: true, puzzle: { mission: MISSION, solution: SOLUTION, difficulty: "medium", seed: "t" } }));
      expect(playStore.getSnapshot().play?.glyphs).toBe(true);
      expect(q("mode-chip")!.getAttribute("data-mode")).toBe("glyphs");
      expect(cell(0).querySelector("svg.gl-given")).not.toBeNull();
      expect(host.querySelectorAll(".pad .key svg.gl-pad")).toHaveLength(9);
      // Слот режима — строка хаба «В процессе».
      act(() => playStore.toHub());
      expect(playStore.slots().glyphs).toBeDefined();
    } finally {
      act(() => playStore.toHub());
      inner.snap = { ...base };
      vi.unstubAllGlobals();
    }
  });
});
