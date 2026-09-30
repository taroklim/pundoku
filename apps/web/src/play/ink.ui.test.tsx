// @vitest-environment jsdom
/** Чернильный режим (PD-74): поле с кляксой, панель без Undo, вход и шит правил, шаг «New puzzle», карточка дня. */
import { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { Board, BLOT_MOMENT_MS } from "./Board";
import { BLOT_SAY_DELAY_MS, GamePad, useBlotAnnouncement } from "./controls";
import type { PlaySnapshot } from "./gameStore";
import { InkEntry } from "./InkEntry";
import { createPlay, enterDigit, setInkMode } from "./logic";
import type { PlayState } from "./logic";
import { PlaySetup } from "./PlaySetup";
import { ResultCard } from "./ResultCard";
import { PlayStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const fresh = (): PlayState => createPlay({ mission: MISSION, solution: SOLUTION });
/** Клетка 2: решение 4; 1 — неверная цифра. */
const inkWithBlot = (): PlayState => enterDigit(setInkMode(fresh(), true), 2, 1, 1000);

const fakeStore = {
  select: () => undefined,
  moveSelection: () => null,
  input: vi.fn(),
  erase: vi.fn(),
  undo: vi.fn(),
  toggleNotesMode: () => undefined,
} as never;

const snapOf = (patch: Partial<PlaySnapshot>): PlaySnapshot => ({
  phase: "playing",
  difficulty: "medium",
  startedOn: new Date(0),
  play: fresh(),
  selected: 4,
  notesMode: false,
  pop: null,
  wave: null,
  blot: null,
  ...patch,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const cell = (i: number) => host.querySelector<HTMLElement>(`.cell[data-i="${i}"]`)!;

describe("Board: клякса", () => {
  it("клетка-клякса: пятно, верная цифра, заперта — без выбора и «той же цифры»; метка для VoiceOver", () => {
    const play = inkWithBlot();
    act(() => root.render(<Board snap={snapOf({ play, selected: 2 })} store={fakeStore} dim={false} />));
    const c = cell(2);
    expect(c.classList.contains("blot")).toBe(true);
    expect(c.querySelector(".stain")).not.toBeNull();
    expect(c.querySelector(".d")!.textContent).toBe("4");
    expect(c.getAttribute("aria-label")).toBe("Row 1, column 3, wrong digit. Cell sealed with a blot. 4");
    // Клякса выбрана, но «той же цифры» из неё не берётся: другие 4 не подсвечены.
    expect(host.querySelectorAll(".cell.same")).toHaveLength(0);
    // Обычная клетка той же партии — без пятна.
    expect(cell(3).querySelector(".stain")).toBeNull();
  });

  it("выбор клетки с той же цифрой (4, клетка 36) заливает другие 4, но не кляксу с верной 4", () => {
    const play = inkWithBlot();
    act(() => root.render(<Board snap={snapOf({ play, selected: 36 })} store={fakeStore} dim={false} />));
    expect(host.querySelectorAll(".cell.same").length).toBeGreaterThan(0);
    expect(cell(2).classList.contains("same")).toBe(false);
  });

  it("M7: момент играет .stain.anim, неверная цифра держится отдельным .leaving; по таймеру классы снимаются", () => {
    const play = inkWithBlot();
    const blot = { cell: 2, digit: 1, id: 1 };
    act(() => root.render(<Board snap={snapOf({ play, selected: 2, blot })} store={fakeStore} dim={false} />));
    const c = cell(2);
    expect(c.querySelector(".stain")!.classList.contains("anim")).toBe(true);
    expect(c.querySelector(".d.leaving")!.textContent).toBe("1");
    expect(c.querySelector(".d.swap-in")!.textContent).toBe("4");
    // Без M4: у кляксы нет кольца ошибки.
    expect(c.classList.contains("err")).toBe(false);
    act(() => void vi.advanceTimersByTime(BLOT_MOMENT_MS + 1));
    expect(c.querySelector(".stain")!.classList.contains("anim")).toBe(false);
    expect(c.querySelector(".d.leaving")).toBeNull();
    expect(c.querySelector(".d.swap-in")).toBeNull();
    expect(c.classList.contains("blot")).toBe(true);
  });

  it("тап завершает момент сразу", () => {
    const play = inkWithBlot();
    act(() => root.render(<Board snap={snapOf({ play, selected: 2, blot: { cell: 2, digit: 1, id: 7 } })} store={fakeStore} dim={false} />));
    expect(cell(2).querySelector(".stain.anim")).not.toBeNull();
    act(() => void window.dispatchEvent(new Event("pointerdown")));
    expect(cell(2).querySelector(".stain.anim")).toBeNull();
    expect(cell(2).querySelector(".d.leaving")).toBeNull();
  });
});

describe("GamePad: панель в чернилах", () => {
  const labels = () => [...host.querySelectorAll(".actions .act")].map((b) => b.textContent);

  it("обычная партия: Notes, Undo, Erase; чернильная — Notes и «Erase notes», Undo нет вовсе", () => {
    act(() => root.render(<GamePad snap={snapOf({})} store={fakeStore} />));
    expect(labels()).toEqual(["Notes", "Undo", "Erase"]);
    expect(host.querySelector(".actions")!.classList.contains("ink")).toBe(false);
    act(() => root.render(<GamePad snap={snapOf({ play: setInkMode(fresh(), true) })} store={fakeStore} />));
    expect(labels()).toEqual(["Notes", "Erase notes"]);
    expect(host.querySelector(".actions")!.classList.contains("ink")).toBe(true);
    expect(host.textContent).not.toContain("Undo");
  });

  it("uk и ru: подпись «Стерти нотатки» / «Стереть заметки»", async () => {
    const snap = snapOf({ play: setInkMode(fresh(), true) });
    await act(() => i18n.changeLanguage("uk"));
    act(() => root.render(<GamePad snap={snap} store={fakeStore} />));
    expect(labels()[1]).toBe(i18n.t("ink.eraseNotes"));
    await act(() => i18n.changeLanguage("ru"));
    expect(labels()[1]).toBe("Стереть заметки");
  });
});

describe("объявление кляксы", () => {
  function Live({ snap }: { snap: PlaySnapshot }) {
    return <p data-testid="live">{useBlotAnnouncement(snap)}</p>;
  }
  it("«Wrong digit. The cell is sealed with a blot. 4» после короткой паузы; потом очищается", () => {
    const play = inkWithBlot();
    act(() => root.render(<Live snap={snapOf({ play })} />));
    expect(host.textContent).toBe("");
    act(() => root.render(<Live snap={snapOf({ play, blot: { cell: 2, digit: 1, id: 1 } })} />));
    expect(host.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(BLOT_SAY_DELAY_MS));
    expect(host.textContent).toBe("Wrong digit. The cell is sealed with a blot. 4");
    act(() => void vi.advanceTimersByTime(10_000));
    expect(host.textContent).toBe("");
  });
});

describe("InkEntry и шит правил", () => {
  const press = (el: Element | null) => act(() => (el as HTMLElement).click());
  const sheet = () => document.querySelector('[data-testid="ink-sheet"]');

  function Harness({ initial = false }: { initial?: boolean }) {
    const [on, setOn] = useState(initial);
    return <InkEntry on={on} setOn={setOn} />;
  }

  it("строка «Ink mode · Off»: нажатие открывает шит, режим не включён до «Play in ink»", () => {
    act(() => root.render(<Harness />));
    expect(host.querySelector('[data-testid="ink-row-value"]')!.textContent).toBe("Off");
    expect(host.querySelector(".ink-foot")!.textContent).toContain("Choose before your first move");
    press(host.querySelector('[data-testid="ink-row"]'));
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain("Ink doesn’t lift");
    expect(sheet()!.querySelectorAll(".ink-rules li")).toHaveLength(4);
    expect(host.querySelector('[data-testid="ink-row-value"]')!.textContent).toBe("Off");
    // фон инертен
    expect(host.hasAttribute("inert")).toBe(true);
    press(document.querySelector('[data-testid="ink-rule-start"]'));
    expect(sheet()).toBeNull();
    expect(host.hasAttribute("inert")).toBe(false);
    expect(host.querySelector('[data-testid="ink-row-value"]')!.textContent).toBe("On");
  });

  it("«Not now», тап по затемнению и Esc закрывают шит, не включая режим", () => {
    act(() => root.render(<Harness />));
    for (const close of [
      () => press(document.querySelector('[data-testid="ink-rule-cancel"]')),
      () => press(document.querySelector('[data-testid="ink-sheet-scrim"]')),
      () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))),
    ]) {
      press(host.querySelector('[data-testid="ink-row"]'));
      expect(sheet()).not.toBeNull();
      close();
      expect(sheet()).toBeNull();
      expect(host.querySelector('[data-testid="ink-row-value"]')!.textContent).toBe("Off");
    }
  });

  it("тап внутри шита не закрывает его; при включённом режиме строка выключает без шита", () => {
    act(() => root.render(<Harness />));
    press(host.querySelector('[data-testid="ink-row"]'));
    press(sheet());
    expect(sheet()).not.toBeNull();
    press(document.querySelector('[data-testid="ink-rule-start"]'));
    press(host.querySelector('[data-testid="ink-row"]'));
    expect(sheet()).toBeNull();
    expect(host.querySelector('[data-testid="ink-row-value"]')!.textContent).toBe("Off");
  });
});

describe("PlaySetup: шаг «New puzzle»", () => {
  it("сложность, Ink mode и Start; сложность меняется нативным select", () => {
    const onDifficulty = vi.fn();
    const onInk = vi.fn();
    const onStart = vi.fn();
    act(() => root.render(<PlaySetup difficulty="hard" ink={false} onDifficulty={onDifficulty} onInk={onInk} onStart={onStart} />));
    expect(host.querySelector(".sect-head")!.textContent).toBe("New puzzle");
    expect(host.querySelector(".ink-row-select .row-v")!.textContent).toBe("Hard");
    const select = host.querySelector<HTMLSelectElement>('[data-testid="setup-difficulty"]')!;
    act(() => {
      select.value = "easy";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDifficulty).toHaveBeenCalledWith("easy");
    // Ink mode: шит → «Play in ink»
    act(() => host.querySelector<HTMLElement>('[data-testid="ink-row"]')!.click());
    act(() => document.querySelector<HTMLElement>('[data-testid="ink-rule-start"]')!.click());
    expect(onInk).toHaveBeenCalledWith(true);
    act(() => host.querySelector<HTMLElement>('[data-testid="setup-start"]')!.click());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".ink-foot")!.textContent).toBe("In ink mode there is no undo and no eraser for digits.");
  });
});

describe("PlayStore: шаг New puzzle", () => {
  it("стартует в setup без партии; режим выбирается только в setup и сбрасывается toSetup", () => {
    const s = new PlayStore();
    expect(s.getSnapshot()).toMatchObject({ setup: true, inkNext: false, play: null });
    s.setInkNext(true);
    s.setDifficulty("hard");
    expect(s.getSnapshot()).toMatchObject({ inkNext: true, difficulty: "hard" });
    s.toSetup("easy");
    expect(s.getSnapshot()).toMatchObject({ setup: true, inkNext: false, difficulty: "easy", play: null });
  });

  it("сгенерированная партия в чернильном режиме включает ink; обычная — нет", () => {
    const s = new PlayStore();
    const inner = s as unknown as {
      requestId: number;
      onGenerated(id: number, r: { id: number; ok: true; puzzle: { mission: string; solution: string; difficulty: "easy"; seed: string } }): void;
    };
    const puzzle = { mission: MISSION, solution: SOLUTION, difficulty: "easy" as const, seed: "t" };
    s.setInkNext(true);
    s.start(); // Worker в jsdom нет — фаза error, но requestId выдан
    inner.onGenerated(inner.requestId, { id: inner.requestId, ok: true, puzzle });
    expect(s.getSnapshot()).toMatchObject({ phase: "playing", setup: false });
    expect(s.getSnapshot().play!.ink).toBe(true);
    s.toSetup();
    s.newGame("easy", false);
    inner.onGenerated(inner.requestId, { id: inner.requestId, ok: true, puzzle });
    expect(s.getSnapshot().play!.ink).toBeUndefined();
  });
});

/** Решённая чернильная партия: одна клякса в первой пустой клетке. */
function solvedInk(blots: number): PlayState {
  let p = setInkMode(fresh(), true);
  let t = 0;
  let made = 0;
  for (let i = 0; i < 81; i++) {
    if (p.mission[i]) continue;
    t += 1000;
    if (made < blots) {
      p = enterDigit(p, i, (p.solution[i]! % 9) + 1, t);
      made++;
      t += 1000;
      continue;
    }
    p = enterDigit(p, i, p.solution[i]!, t);
  }
  return p;
}

describe("ResultCard: чернильный день", () => {
  const card = (play: PlayState) => act(() => root.render(<ResultCard play={play} cardRef={createRef()} title="Your path" winRate={61} />));
  const rows = () => [...host.querySelectorAll(".rows .row")].map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent]);

  it("чип «Ink», строка «Blots — N» вместо «Corrections», кляксы в тепловой карте, подпись, win rate на месте", () => {
    const play = solvedInk(2);
    expect(play.solved).toBe(true);
    card(play);
    expect(host.querySelector('[data-testid="ink-chip"]')!.textContent).toBe("Ink");
    expect(rows().map((r) => r[0])).not.toContain("Corrections");
    expect(rows()).toContainEqual(["Blots", "2"]);
    expect(host.querySelector('[data-testid="blots-row"] dd')!.classList.contains("wax")).toBe(true);
    expect(host.querySelectorAll(".heat i.b")).toHaveLength(2);
    expect(host.querySelector(".card .sub")!.textContent).toContain("Notched cells are blots.");
    expect(host.querySelector('[data-testid="winrate"]')).not.toBeNull();
  });

  it("чистая партия в чернилах: «Blots — clean», без сургуча и без клякс в карте", () => {
    card(solvedInk(0));
    expect(rows()).toContainEqual(["Blots", "clean"]);
    expect(host.querySelector('[data-testid="blots-row"] dd')!.classList.contains("wax")).toBe(false);
    expect(host.querySelectorAll(".heat i.b")).toHaveLength(0);
    expect(host.querySelector('[data-testid="ink-chip"]')).not.toBeNull();
  });

  it("обычная партия: без чипа, «Corrections» как раньше", () => {
    let p = fresh();
    let t = 0;
    for (let i = 0; i < 81; i++) {
      if (p.mission[i]) continue;
      t += 1000;
      p = enterDigit(p, i, p.solution[i]!, t);
    }
    card(p);
    expect(host.querySelector('[data-testid="ink-chip"]')).toBeNull();
    expect(rows().map((r) => r[0])).toContain("Corrections");
    expect(host.querySelector('[data-testid="blots-row"]')).toBeNull();
    expect(host.querySelectorAll(".heat i.b")).toHaveLength(0);
  });
});
