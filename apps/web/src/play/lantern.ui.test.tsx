// @vitest-environment jsdom
/**
 * PD-208: режим Фонарь на экране (основа без финального визуала). Свет = строка + столбец + блок выбранной клетки (`litCells`);
 * нет выбора — свет пуст. В тени свои цифры И заметки (класс `is-shadow`), подсказки видны всегда; подсветка одинаковых цифр —
 * только в свете; VoiceOver в тени не раскрывает ни цифру, ни заметки, ни «пусто»; «осмотр доски» — удержанием поля
 * (`INSPECT_HOLD_MS`) или пунктом ⋯ — показывает всё. Таймлапс/отпечаток не меняются (ReplayField не знает о Фонаре).
 */
import { litCells } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { setHighlightPeers, setHighlightWrong } from "../settings/prefs";
import { Board, INSPECT_HOLD_MS } from "./Board";
import type { PlaySnapshot } from "./gameStore";
import type { PlayState } from "./logic";
import { createPlay, enterDigit, fillCandidates, setLanternMode, toggleNote } from "./logic";
import { MoreMenu } from "./MoreMenu";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

/** Партия Фонаря: своя 6 в r1c4 (3, будет в свете), своя 5 в r5c5 (40, в тени), заметки в r1c6 (5, свет) и r9c7 (78, тень). */
function lanternPlay(): PlayState {
  let p = setLanternMode(createPlay({ mission: MISSION, solution: SOLUTION }));
  p = enterDigit(p, 3, 6, 100);
  p = enterDigit(p, 40, 5, 200);
  p = toggleNote(p, 5, 2, 300);
  p = toggleNote(p, 78, 1, 400);
  p = toggleNote(p, 78, 3, 500);
  return p;
}
const select = vi.fn();
const fakeStore = { select, moveSelection: () => null } as unknown as Parameters<typeof Board>[0]["store"];
const snapOf = (play: PlayState, patch: Partial<PlaySnapshot> = {}): PlaySnapshot => ({
  phase: "playing",
  difficulty: "medium",
  startedOn: new Date(0),
  play,
  selected: 3,
  notesMode: false,
  pop: null,
  wave: null,
  ...patch,
});

let host: HTMLDivElement;
let root: Root;
const cell = (i: number) => host.querySelector<HTMLElement>(`.cell[data-i="${i}"]`)!;
const boardEl = () => host.querySelector<HTMLElement>(".board")!;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
const pointer = (el: EventTarget, type: string, x = 10, y = 10) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 })));
const render = (play: PlayState, patch: Partial<PlaySnapshot> = {}, inspect = false) =>
  act(() => root.render(<Board snap={snapOf(play, patch)} store={fakeStore} dim={false} inspect={inspect} />));
const shadowCells = () => [...host.querySelectorAll(".cell.is-shadow")].map((c) => Number(c.getAttribute("data-i")));
const litCellsDom = () => [...host.querySelectorAll(".cell.is-lit")].map((c) => Number(c.getAttribute("data-i")));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  setHighlightWrong(false);
  setHighlightPeers(true);
  select.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setHighlightWrong(false);
  await i18n.changeLanguage("en");
});

describe("свет и тень", () => {
  it("свет — ровно litCells выбранной клетки; остальное в тени; поле помечено `lantern`", () => {
    render(lanternPlay());
    expect(boardEl().classList.contains("lantern")).toBe(true);
    expect(boardEl().getAttribute("data-lantern")).toBe("lit");
    expect(litCellsDom().sort((a, b) => a - b)).toEqual([...litCells(3)]);
    expect(shadowCells()).toHaveLength(81 - 21);
    expect(cell(40).classList.contains("is-shadow")).toBe(true);
    expect(cell(3).classList.contains("is-lit")).toBe(true);
  });

  it("PD-216: в тени своя цифра и заметки в DOM, но скрыты от скринридера (aria-hidden) и без title; подсказки видны; классика — без классов света", () => {
    render(lanternPlay());
    const d = cell(40).querySelector(".d.player")!;
    expect(d.textContent).toBe("5"); // владелец принял: цифра технически в DOM, размывает CSS
    expect(d.getAttribute("aria-hidden")).toBe("true");
    expect(cell(78).querySelector(".marks")!.getAttribute("aria-hidden")).toBe("true");
    for (const c of host.querySelectorAll(".cell.is-shadow")) expect(c.querySelector("[title]") ?? c.getAttribute("title")).toBeNull();
    // В свете — обычные цифры и заметки.
    expect(cell(3).querySelector(".d.player")!.textContent).toBe("6");
    expect(cell(5).querySelector(".marks")!.textContent).toContain("2");
    expect(cell(36).querySelector(".d.given")!.textContent).toBe("4"); // подсказка в тени — как обычно
    render(createPlay({ mission: MISSION, solution: SOLUTION }));
    expect(boardEl().classList.contains("lantern")).toBe(false);
    expect(host.querySelectorAll(".is-lit, .is-shadow")).toHaveLength(0);
  });

  it("нет выбора — свет пуст: все клетки в тени", () => {
    render(lanternPlay(), { selected: null });
    expect(boardEl().getAttribute("data-lantern")).toBe("dark");
    expect(shadowCells()).toHaveLength(81);
    expect(litCellsDom()).toHaveLength(0);
  });

  it("PD-216: смена света перемонтирует свою цифру (переход только opacity через @starting-style, blur не анимируется)", () => {
    render(lanternPlay());
    const before = cell(40).querySelector(".d.player");
    render(lanternPlay(), { selected: 40 });
    const after = cell(40).querySelector(".d.player");
    expect(after).not.toBe(before);
    expect(after!.textContent).toBe("5");
  });

  it("свет идёт за выбором", () => {
    render(lanternPlay(), { selected: 80 });
    expect(litCellsDom().sort((a, b) => a - b)).toEqual([...litCells(80)]);
    expect(cell(78).classList.contains("is-lit")).toBe(true);
    expect(cell(3).classList.contains("is-shadow")).toBe(true);
  });

  it("вне партии (загрузка/решено) света нет — поле целиком", () => {
    render(lanternPlay(), { phase: "solved" });
    expect(host.querySelectorAll(".is-shadow")).toHaveLength(0);
    expect(boardEl().classList.contains("lantern")).toBe(false);
  });

  it("неверная цифра в тени не подсвечивается ошибкой даже при «Highlight mistakes»; в свете — как обычно", () => {
    setHighlightWrong(true);
    let p = lanternPlay();
    p = enterDigit(p, 42, 1, 600); // r5c7 — неверно (решение 7), в тени
    p = enterDigit(p, 5, 9, 700); // r1c6 — неверно (решение 8), в свете
    render(p);
    expect(cell(42).classList.contains("err")).toBe(false);
    expect(cell(42).querySelector(".d.err")).toBeNull(); // цвет ошибки в тени не выдаёт неверную цифру
    expect(cell(42).querySelector(".d.err")).toBeNull();
    expect(cell(5).classList.contains("err")).toBe(true);
  });
});

describe("PD-230: заметки в тени — одно пятно без позиций (QA PD-211: одиночная заметка читалась по месту пятна 3×3)", () => {
  /** Чистая партия Фонаря, в r9c7 (78, в тени при выборе r1c4) — заметки `ds`. */
  const withNotes = (ds: number[]) => {
    let p = setLanternMode(createPlay({ mission: MISSION, solution: SOLUTION }));
    ds.forEach((d, k) => (p = toggleNote(p, 78, d, 100 + k)));
    return p;
  };
  const SETS = [[1], [2], [3], [4], [5], [6], [7], [8], [9], [1, 9], [2, 4, 6], [1, 2, 3, 4, 5, 6, 7, 8, 9]];

  it("отрисовка клетки тени не зависит от того, какие цифры в заметках: одна 1 / одна 9 / набор — одинаковый DOM", () => {
    const html = SETS.map((ds) => {
      render(withNotes(ds));
      expect(cell(78).classList.contains("is-shadow")).toBe(true);
      return cell(78).outerHTML;
    });
    for (const [k, h] of html.entries()) expect(h, `заметки ${SETS[k]!.join("")}`).toBe(html[0]);
  });

  it("в тени: одно пятно `.marks.spot` — без цифр, без элемента на цифру, без классов/стилей по цифре; aria-hidden", () => {
    render(withNotes([7]));
    const m = cell(78).querySelector(".marks")!;
    expect(m.classList.contains("spot")).toBe(true);
    expect(m.getAttribute("aria-hidden")).toBe("true");
    expect(m.textContent).toBe("");
    expect(m.children).toHaveLength(0);
    expect(m.hasAttribute("style")).toBe(false);
    expect(cell(78).querySelectorAll(".struck, [data-d], [style]")).toHaveLength(0);
    expect(cell(78).textContent).toBe("");
  });

  it("в свете и при осмотре — обычная сетка заметок 3×3 с цифрами (не тронуто)", () => {
    render(withNotes([7]), { selected: 80 }); // 78 в свете
    const lit = cell(78).querySelector(".marks")!;
    expect(lit.classList.contains("spot")).toBe(false);
    expect(lit.children).toHaveLength(9);
    expect(lit.children[6]!.textContent).toBe("7");
    render(withNotes([7]), {}, true); // осмотр
    const peek = cell(78).querySelector(".marks")!;
    expect(cell(78).classList.contains("is-peek")).toBe(true);
    expect(peek.classList.contains("spot")).toBe(false);
    expect(peek.textContent).toBe("7");
  });

  it("Fill candidates: все клетки тени с заметками — одно и то же пятно, независимо от числа и набора кандидатов; в свете — цифры", () => {
    const p = fillCandidates(setLanternMode(createPlay({ mission: MISSION, solution: SOLUTION })), 100);
    render(p, { selected: 40 });
    const noted = [...host.querySelectorAll<HTMLElement>(".cell.is-shadow")].filter((c) => c.querySelector(".marks"));
    expect(noted.length).toBeGreaterThan(20);
    // Наборы кандидатов в этих клетках разные (иначе проверка ничего не доказывает).
    expect(new Set(noted.map((c) => p.notes[Number(c.getAttribute("data-i"))])).size).toBeGreaterThan(5);
    const inner = new Set(noted.map((c) => c.innerHTML));
    expect([...inner]).toEqual(['<i class="fl" aria-hidden="true"></i><span class="marks spot" aria-hidden="true"></span>']);
    for (const c of noted) expect(c.textContent).toBe("");
    const litNoted = [...host.querySelectorAll<HTMLElement>(".cell.is-lit")].find((c) => c.querySelector(".marks"))!;
    expect(litNoted.querySelector(".marks")!.textContent).toMatch(/^\d+$/);
  });
});

describe("подсветка одинаковых цифр — только в свете", () => {
  it("та же цифра вне света не подсвечивается; при осмотре — как в классике", () => {
    render(lanternPlay()); // выбрана своя 6 в r1c4; подсказки 6 — r2c1, r3c8, r4c5… все вне света
    expect(host.querySelectorAll(".cell.same")).toHaveLength(0);
    render(lanternPlay(), {}, true);
    const same = [...host.querySelectorAll(".cell.same")].map((c) => Number(c.getAttribute("data-i")));
    expect(same).toEqual(expect.arrayContaining([9, 25, 31]));
  });

  it("дубликат в свете (конфликт) подсвечивается", () => {
    const p = enterDigit(lanternPlay(), 7, 6, 800); // r1c8 = 6 — та же строка, в свете
    render(p);
    expect(cell(7).classList.contains("same")).toBe(true);
  });
});

describe("VoiceOver", () => {
  it("в тени: «в тени» / «заметки, в тени» без цифр; пустая — «пусто» (видно и глазами); подсказка и свет — обычные подписи", () => {
    render(lanternPlay());
    expect(cell(40).getAttribute("aria-label")).toBe("Row 5, column 5, in shadow");
    expect(cell(78).getAttribute("aria-label")).toBe("Row 9, column 7, notes, in shadow");
    expect(cell(42).getAttribute("aria-label")).toBe("Row 5, column 7, empty");
    expect(cell(41).getAttribute("aria-label")).toBe("Row 5, column 6, clue 3"); // подсказка в тени
    expect(cell(36).getAttribute("aria-label")).toContain("4"); // подсказка
    expect(cell(3).getAttribute("aria-label")).toBe("Row 1, column 4, your 6");
    expect(cell(5).getAttribute("aria-label")).toContain("2"); // заметка в свете
  });

  it("uk/ru: подпись тени переведена", async () => {
    await act(() => i18n.changeLanguage("ru"));
    render(lanternPlay());
    expect(cell(40).getAttribute("aria-label")).toBe("Строка 5, столбец 5, в тени");
    expect(cell(78).getAttribute("aria-label")).toBe("Строка 9, столбец 7, заметки, в тени");
    await act(() => i18n.changeLanguage("uk"));
    render(lanternPlay());
    expect(cell(40).getAttribute("aria-label")).toBe("Рядок 5, стовпець 5, у тіні");
    expect(cell(78).getAttribute("aria-label")).toBe("Рядок 9, стовпець 7, нотатки, у тіні");
  });

  it("при осмотре (вид b) — обычные подписи и цифры, клетки тени помечены `is-peek` (граница света видна)", () => {
    render(lanternPlay(), {}, true);
    expect(cell(40).getAttribute("aria-label")).toBe("Row 5, column 5, your 5");
    expect(boardEl().getAttribute("aria-label")).toContain("Inspecting the board");
    expect(boardEl().classList.contains("inspecting")).toBe(true);
    expect(cell(40).classList.contains("is-peek")).toBe(true);
    expect(cell(40).querySelector(".d.player")!.textContent).toBe("5");
    expect(cell(78).querySelector(".marks")).not.toBeNull();
    expect(cell(3).classList.contains("is-lit")).toBe(true);
    expect(host.querySelectorAll(".cell.is-peek")).toHaveLength(81 - 21);
  });

  it("строки Фонаря есть во всех локалях, плейсхолдеры одинаковы", () => {
    for (const loc of [en, uk, ru] as unknown as { lantern: Record<string, string>; modes: { lantern: { name: string; desc: string } } }[]) {
      expect(loc.modes.lantern.name.length).toBeGreaterThan(2);
      expect(loc.modes.lantern.desc.length).toBeGreaterThan(30);
      for (const k of ["cellShadow", "cellShadowNotes", "inspect", "inspectHint", "inspecting", "chipInspect", "done", "rowMode", "yearValue"]) expect(loc.lantern[k], k).toEqual(expect.any(String));
      for (const k of ["cellShadow", "cellShadowNotes"]) {
        expect(loc.lantern[k]).toContain("{{row}}");
        expect(loc.lantern[k]).toContain("{{col}}");
      }
      const st = (loc.lantern as unknown as { status: Record<string, string> }).status;
      for (const k of ["dark", "darkShort", "hold", "holdShort", "menu", "menuShort"]) expect(st[k], k).toEqual(expect.any(String));
    }
  });
});

describe("осмотр доски удержанием", () => {
  beforeEach(() => void vi.useFakeTimers());

  it("удержание дольше порога — свет везде, пока держишь; отпустил — обратно", () => {
    render(lanternPlay());
    pointer(cell(40), "pointerdown");
    act(() => void vi.advanceTimersByTime(INSPECT_HOLD_MS - 50));
    expect(shadowCells().length).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(60));
    expect(shadowCells()).toHaveLength(0);
    expect(boardEl().getAttribute("data-lantern")).toBe("inspect");
    pointer(window, "pointerup");
    expect(shadowCells()).toHaveLength(81 - 21);
  });

  it("клик отпускания после осмотра проглатывается (фонарь не прыгает); обычный тап — выбирает клетку", () => {
    render(lanternPlay());
    pointer(cell(40), "pointerdown");
    act(() => void vi.advanceTimersByTime(INSPECT_HOLD_MS + 10));
    pointer(window, "pointerup");
    tap(cell(40));
    expect(select).not.toHaveBeenCalled();
    pointer(cell(41), "pointerdown");
    act(() => void vi.advanceTimersByTime(100));
    pointer(window, "pointerup");
    tap(cell(41));
    expect(select).toHaveBeenCalledWith(41);
    expect(shadowCells()).toHaveLength(81 - 21);
  });

  it("если браузер сдвинул выбор фокусом на нажатии, удержание возвращает фонарь на клетку до нажатия", () => {
    render(lanternPlay());
    pointer(cell(40), "pointerdown");
    render(lanternPlay(), { selected: 40 }); // фокус кнопки → выбор (chromium/desktop webkit)
    act(() => void vi.advanceTimersByTime(INSPECT_HOLD_MS + 10));
    expect(select).toHaveBeenCalledWith(3);
    pointer(window, "pointerup");
  });

  it("сдвиг пальца до порога — не удержание", () => {
    render(lanternPlay());
    pointer(cell(40), "pointerdown", 10, 10);
    pointer(window, "pointermove", 40, 10);
    act(() => void vi.advanceTimersByTime(INSPECT_HOLD_MS + 50));
    expect(shadowCells().length).toBeGreaterThan(0);
  });

  it("pointercancel (жест ушёл системе) заканчивает осмотр", () => {
    render(lanternPlay());
    pointer(cell(40), "pointerdown");
    act(() => void vi.advanceTimersByTime(INSPECT_HOLD_MS + 10));
    expect(shadowCells()).toHaveLength(0);
    pointer(window, "pointercancel");
    expect(shadowCells()).toHaveLength(81 - 21);
  });

  it("в классике удержание ничего не меняет", () => {
    render(createPlay({ mission: MISSION, solution: SOLUTION }));
    pointer(cell(40), "pointerdown");
    act(() => void vi.advanceTimersByTime(INSPECT_HOLD_MS + 10));
    expect(boardEl().classList.contains("inspecting")).toBe(false);
    pointer(window, "pointerup");
  });
});

describe("пункт ⋯ «Осмотреть доску»", () => {
  it("menuitemcheckbox с галочкой и подсказкой про удержание; нет пропса — нет пункта", () => {
    const onToggle = vi.fn();
    act(() => root.render(<MoreMenu fill="ready" onNew={() => {}} onFill={() => {}} inspect={{ on: false, onToggle }} />));
    tap(q("more-button")!);
    const item = q("menu-inspect")!;
    expect(item.getAttribute("role")).toBe("menuitemcheckbox");
    expect(item.getAttribute("aria-checked")).toBe("false");
    expect(item.getAttribute("aria-label")).toBe("Inspect the board");
    expect(item.textContent).toContain("touch and hold");
    tap(item);
    expect(onToggle).toHaveBeenCalledTimes(1);
    act(() => root.render(<MoreMenu fill="ready" onNew={() => {}} onFill={() => {}} />));
    tap(q("more-button")!);
    expect(q("menu-inspect")).toBeNull();
  });
});

describe("хаб и партия (PlayScreen)", () => {
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

  it("строка «Фонарь» → шит с правилом → партия в темноте; ⋯ «Осмотреть доску» вкл/выкл; классика — без пункта", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
    inner.snap = { ...base };
    (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
    try {
      act(() => root.render(<PlayScreen />));
      const row = q("mode-lantern")!;
      expect(row.textContent).toContain("Lantern");
      // PD-210 (макет §6): в строке списка — первое предложение правила, в шите — все три.
      expect(row.textContent).toContain("Your digits and notes show only in the row, column and box of the selected cell.");
      expect(row.textContent).not.toContain("Givens stay visible");
      tap(row);
      expect(q("mode-sheet")!.getAttribute("data-mode")).toBe("lantern");
      expect(q("mode-desc")!.textContent).toBe(
        "Your digits and notes show only in the row, column and box of the selected cell. Givens stay visible. Touch and hold the board to see it all.",
      );
      tap(q("sheet-start")!);
      act(() => inner.onGenerated(inner.requestId, { id: inner.requestId, ok: true, puzzle: { mission: MISSION, solution: SOLUTION, difficulty: "medium", seed: "t" } }));
      expect(playStore.getSnapshot().play?.lantern).toBe(true);
      expect(playStore.getSnapshot().selected).toBeNull();
      expect(q("mode-chip")!.getAttribute("data-mode")).toBe("lantern");
      expect(boardEl().getAttribute("data-lantern")).toBe("dark");
      // Нет выбора — строка статуса учит действием (макет §2 п. 5).
      expect(q("lantern-status")!.getAttribute("data-kind")).toBe("dark");
      expect(q("lantern-status")!.textContent).toContain("Tap a cell to light its row, column and box.");
      tap(q("more-button")!);
      expect(q("menu-inspect")!.getAttribute("aria-checked")).toBe("false");
      tap(q("menu-inspect")!);
      expect(boardEl().getAttribute("data-lantern")).toBe("inspect");
      // Осмотр из меню: чип «Inspecting» с глазом, строка «Inspecting the board» + «Done».
      expect(q("mode-chip")!.getAttribute("data-inspecting")).toBe("true");
      expect(q("mode-chip")!.textContent).toBe("Inspecting");
      expect(q("lantern-status")!.getAttribute("data-kind")).toBe("menu");
      tap(q("more-button")!);
      expect(q("menu-inspect")!.getAttribute("aria-checked")).toBe("true");
      tap(q("menu-inspect")!);
      expect(boardEl().getAttribute("data-lantern")).toBe("dark");
      expect(q("mode-chip")!.getAttribute("data-inspecting")).toBeNull();
      // «Готово» заканчивает осмотр.
      tap(q("more-button")!);
      tap(q("menu-inspect")!);
      expect(boardEl().getAttribute("data-lantern")).toBe("inspect");
      tap(q("inspect-done")!);
      expect(boardEl().getAttribute("data-lantern")).toBe("dark");
      // Тап по полю тоже заканчивает осмотр из меню — и выбирает клетку (свет загорается).
      tap(q("more-button")!);
      tap(q("menu-inspect")!);
      tap(cell(40));
      expect(boardEl().getAttribute("data-lantern")).toBe("lit");
      expect(q("lantern-status")).toBeNull(); // выбор есть — обычное «осталось N»
      act(() => playStore.toHub());
      expect(playStore.slots().lantern).toBeDefined();
      // Классика: пункта нет.
      tap(q("mode-classic")!);
      tap(q("sheet-start")!);
      act(() => inner.onGenerated(inner.requestId, { id: inner.requestId, ok: true, puzzle: { mission: MISSION, solution: SOLUTION, difficulty: "medium", seed: "t" } }));
      tap(q("more-button")!);
      expect(q("menu-inspect")).toBeNull();
    } finally {
      act(() => playStore.toHub());
      inner.snap = { ...base };
      vi.unstubAllGlobals();
    }
  }, 30000);
});
