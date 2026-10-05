// @vitest-environment jsdom
/**
 * PD-189: экран ожидания генерации (вариант B макета PD-188). Фейковые таймеры + фейковый Worker: порог 600 мс, минимум показа
 * 700 мс, «долго» с 4 с (второй текст + «Отмена»), отмена (хаб, Worker погашен, поздний ответ проигнорирован), таймаут →
 * «Не удалось» → «Повторить» (панель сразу, без порога). Плюс тексты en/uk/ru и геометрия знака.
 */
import { act, useLayoutEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_SMALL_CELLS } from "../brand/markPaths";
import i18n from "../i18n";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import type { GenerateResponse } from "./generate.worker";
import { PlayScreen } from "./PlayScreen";
import { GENERATION_TIMEOUT_MS, playStore } from "./store";
import { CARRY_ORDER, CARRY_STILL } from "./WaitPanel";
import { WAIT_FADE_OUT_MS, WAIT_LONG_AFTER_MS, WAIT_MIN_SHOWN_MS, WAIT_SHOW_AFTER_MS } from "./waitView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

/** Фейковый Worker: запоминает запрос, отвечает по команде теста. */
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<GenerateResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  req: { id: number; difficulty: string } | null = null;
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(req: { id: number; difficulty: string }) {
    this.req = req;
  }
  terminate() {
    this.terminated = true;
  }
  /** Сетка готова (ответ доставляется, даже если Worker уже погашен — как запоздавшее сообщение). */
  done() {
    const id = this.req!.id;
    act(() => this.onmessage?.({ data: { id, ok: true, puzzle: { mission: MISSION, solution: SOLUTION, difficulty: "expert", seed: "t" } } } as MessageEvent<GenerateResponse>));
  }
}
const last = () => FakeWorker.all[FakeWorker.all.length - 1]!;

interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const render = () => act(() => root.render(<PlayScreen />));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const panel = () => q("wait-panel");
const screen = () => host.querySelector<HTMLElement>(".play")!;
const start = (mode: "classic" | "liar" = "classic", difficulty: "expert" | "master" = "expert") => {
  render();
  act(() => playStore.startNew(mode, difficulty));
};

beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("Worker", FakeWorker);
  FakeWorker.all = [];
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  inner.snap = { ...base, hub: true, phase: "loading", play: null };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => playStore.toHub());
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("пороги", () => {
  it("генерация < 600 мс: панели не было вовсе; первые миллисекунды поле и панель цифр скрыты, потом появляются", () => {
    start();
    expect(screen().classList.contains("play-waiting")).toBe(true); // пусто: место держится, ничего не видно
    expect(panel()).toBeNull();
    expect(host.querySelector('[role="status"]:not(.sr-only)')).toBeNull(); // VoiceOver молчит
    tick(WAIT_SHOW_AFTER_MS - 250);
    expect(panel()).toBeNull();
    last().done();
    expect(playStore.getSnapshot().phase).toBe("playing");
    expect(panel()).toBeNull();
    expect(screen().classList.contains("play-waiting")).toBe(false);
    expect(screen().classList.contains("play-in")).toBe(true); // fadeRise поля и панели цифр
    tick(WAIT_LONG_AFTER_MS);
    expect(panel()).toBeNull();
  });

  it("с 600 мс — панель «Preparing a puzzle…» (role=status); готово на 900 мс — держится до 1300 мс, гаснет 160 мс", () => {
    start();
    tick(WAIT_SHOW_AFTER_MS - 1);
    expect(panel()).toBeNull();
    tick(1);
    expect(panel()).not.toBeNull();
    expect(panel()!.dataset.state).toBe("wait");
    const st = panel()!.querySelector('[role="status"]')!;
    expect(st.textContent).toBe("Preparing a puzzle…");
    expect(st.getAttribute("aria-live")).toBe("polite");
    expect(panel()!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(panel()!.querySelectorAll("button")).toHaveLength(0); // «Отмены» до 4 с нет
    tick(300); // 900 мс
    last().done();
    expect(playStore.getSnapshot().phase).toBe("playing");
    // Партия готова, но панель держится минимум 700 мс от появления (до 1300 мс); поле под ней скрыто.
    expect(panel()!.dataset.state).toBe("wait");
    expect(screen().classList.contains("play-waiting")).toBe(true);
    tick(WAIT_MIN_SHOWN_MS - 300 - 1);
    expect(panel()!.dataset.state).toBe("wait");
    tick(1);
    expect(panel()!.dataset.state).toBe("out");
    expect(panel()!.classList.contains("out")).toBe(true);
    tick(WAIT_FADE_OUT_MS);
    expect(panel()).toBeNull();
    expect(screen().classList.contains("play-in")).toBe(true);
  });

  it("готово сильно позже показа — панель снимается сразу (минимум уже выдержан)", () => {
    start();
    tick(2000);
    last().done();
    expect(panel()!.dataset.state).toBe("out");
    tick(WAIT_FADE_OUT_MS);
    expect(panel()).toBeNull();
  });

  it("через 4 с — второй текст заменяет первый, появляется «Cancel»; Лжец master — то же", () => {
    start("liar", "master");
    tick(WAIT_LONG_AFTER_MS - 1);
    expect(panel()!.dataset.state).toBe("wait");
    tick(1);
    expect(panel()!.dataset.state).toBe("long");
    expect(panel()!.querySelector('[role="status"]')!.textContent).toBe("Some puzzles take a little longer.");
    expect(panel()!.textContent).not.toContain("Preparing");
    const btns = [...panel()!.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Cancel"]);
  });

  it("ввод с клавиатуры, пока панель держится над готовой партией, сквозь неё не проходит; лампочки нет", () => {
    start();
    tick(WAIT_SHOW_AFTER_MS + 50);
    last().done();
    const before = playStore.getSnapshot().play!.values.join("");
    act(() => void screen().dispatchEvent(new KeyboardEvent("keydown", { code: "Digit4", key: "4", bubbles: true })));
    expect(playStore.getSnapshot().play!.values.join("")).toBe(before);
    expect(q("hint-button")).toBeNull();
  });
});

describe("отмена", () => {
  it("«Cancel» → хаб, Worker погашен, запоздавший ответ проигнорирован, слот режима не создан", () => {
    start();
    tick(WAIT_LONG_AFTER_MS);
    const w = last();
    tap(q("wait-cancel")!);
    expect(playStore.getSnapshot().hub).toBe(true);
    expect(w.terminated).toBe(true);
    expect(panel()).toBeNull();
    expect(host.querySelector('[data-testid="mode-classic"]')).not.toBeNull();
    w.done(); // поздний ответ уже отменённой генерации
    expect(playStore.getSnapshot()).toMatchObject({ hub: true, phase: "loading", play: null });
    expect(playStore.slots().classic).toBeUndefined();
    tick(10_000);
    expect(panel()).toBeNull();
  });

  it("после отмены новая партия снова ждёт порог 600 мс (цикл сброшен)", () => {
    start();
    tick(WAIT_LONG_AFTER_MS);
    tap(q("wait-cancel")!);
    act(() => playStore.startNew("classic", "expert"));
    expect(panel()).toBeNull();
    tick(WAIT_SHOW_AFTER_MS);
    expect(panel()!.dataset.state).toBe("wait");
  });
});

describe("таймаут → ошибка → повтор", () => {
  it("таймаут expert: «Couldn’t prepare a puzzle.» (role=alert) + «Try again» / «Cancel»; повтор — панель сразу, минимум 700 мс", () => {
    start();
    const first = last();
    tick(GENERATION_TIMEOUT_MS.expert);
    expect(playStore.getSnapshot().phase).toBe("error");
    expect(first.terminated).toBe(true);
    expect(panel()!.dataset.state).toBe("error");
    const alert = panel()!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Couldn’t prepare a puzzle.");
    expect(panel()!.querySelector('[role="status"]')).toBeNull();
    expect(panel()!.querySelector(".wait-mark")!.classList.contains("still")).toBe(true); // движение остановлено
    expect([...panel()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Try again", "Cancel"]);

    tap(q("wait-retry")!);
    expect(FakeWorker.all).toHaveLength(2); // новая генерация той же партии
    expect(last().req!.difficulty).toBe("expert");
    expect(panel()!.dataset.state).toBe("wait"); // без порога 600 мс
    tick(100);
    last().done();
    expect(panel()!.dataset.state).toBe("wait"); // держим до 700 мс от появления
    tick(WAIT_MIN_SHOWN_MS - 100);
    expect(panel()!.dataset.state).toBe("out");
    tick(WAIT_FADE_OUT_MS);
    expect(panel()).toBeNull();
    expect(playStore.getSnapshot().phase).toBe("playing");
  });

  it("сбой Worker до порога — ошибка сразу; «Cancel» из ошибки — хаб", () => {
    start();
    act(() => last().onerror?.());
    expect(panel()!.dataset.state).toBe("error");
    tap(q("wait-cancel")!);
    expect(playStore.getSnapshot().hub).toBe(true);
    expect(panel()).toBeNull();
  });

  it("фокус на «Try again» → после повтора кнопка исчезла, фокус на заголовке вкладки, а не на <body>", () => {
    start();
    act(() => last().onerror?.());
    const retry = q<HTMLButtonElement>("wait-retry")!;
    act(() => retry.focus());
    tap(retry);
    expect(document.activeElement).toBe(host.querySelector("h1.title"));
  });

  it("повтор после таймаута, снова долго — через 4 с от повтора «долгий» текст и «Cancel»", () => {
    start();
    tick(GENERATION_TIMEOUT_MS.expert);
    tap(q("wait-retry")!);
    tick(WAIT_LONG_AFTER_MS);
    expect(panel()!.dataset.state).toBe("long");
  });
});

/**
 * PD-192: кадр сразу после перехода в загрузку. Проба — соседний компонент на том же сторе: её layout-эффект видит DOM
 * каждого коммита ДО пассивных эффектов (то, что браузер успевает нарисовать). Поле без `play-waiting` в фазе loading —
 * мигание пустой сетки с панелью цифр.
 */
describe("первый кадр загрузки (PD-192)", () => {
  interface Frame {
    phase: string;
    hub: boolean;
    cls: string;
    board: boolean;
  }
  let frames: Frame[] = [];
  function Probe() {
    const s = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
    useLayoutEffect(() => {
      const el = host.querySelector<HTMLElement>(".play");
      frames.push({ phase: s.phase, hub: s.hub, cls: el?.className ?? "", board: !!el?.querySelector(".board") });
    });
    return null;
  }
  const mount = () =>
    act(() =>
      root.render(
        <>
          <PlayScreen />
          <Probe />
        </>,
      ),
    );
  const flashes = () => frames.filter((f) => !f.hub && f.phase === "loading" && f.board && !/\bplay-waiting\b/.test(f.cls));

  beforeEach(() => {
    frames = [];
  });

  it("хаб → Classic: ни одного коммита с полем без play-waiting", () => {
    mount();
    act(() => playStore.startNew("classic", "expert"));
    expect(frames.some((f) => !f.hub && f.phase === "loading")).toBe(true);
    expect(flashes()).toEqual([]);
  });

  it("хаб → Лжец и хаб → Лжец дня — то же", () => {
    mount();
    act(() => playStore.startNew("liar", "master"));
    act(() => playStore.toHub());
    act(() => playStore.startDaily("2026-10-05"));
    expect(frames.filter((f) => !f.hub && f.phase === "loading").length).toBeGreaterThan(1);
    expect(flashes()).toEqual([]);
  });

  it("«Отмена» → повторный старт и «Повторить» после ошибки — то же", () => {
    mount();
    act(() => playStore.startNew("classic", "expert"));
    tick(WAIT_LONG_AFTER_MS);
    tap(q("wait-cancel")!);
    act(() => playStore.startNew("classic", "expert"));
    act(() => last().onerror?.());
    tap(q("wait-retry")!);
    expect(flashes()).toEqual([]);
  });

  it("новая партия с идущей: старое поле не мелькает до пустоты", () => {
    mount();
    act(() => playStore.startNew("classic", "expert"));
    last().done();
    expect(playStore.getSnapshot().phase).toBe("playing");
    frames = [];
    act(() => playStore.startNew("classic", "expert"));
    expect(flashes()).toEqual([]);
  });
});

describe("тексты и знак", () => {
  it("en/uk/ru: preparing, preparingLong, failed, retry, cancel; uk «Повторити» (короче — на 320 AX3 «Скасувати» не уходит под таб-бар)", () => {
    const pick = (l: { play: Record<string, unknown> }) => ({
      preparing: l.play.preparing,
      preparingLong: l.play.preparingLong,
      failed: l.play.failed,
      retry: l.play.retry,
      cancel: l.play.cancel,
    });
    expect(pick(en)).toEqual({ preparing: "Preparing a puzzle…", preparingLong: "Some puzzles take a little longer.", failed: "Couldn’t prepare a puzzle.", retry: "Try again", cancel: "Cancel" });
    expect(pick(uk)).toEqual({ preparing: "Готуємо головоломку…", preparingLong: "Деякі головоломки готуються трохи довше.", failed: "Не вдалося підготувати головоломку.", retry: "Повторити", cancel: "Скасувати" });
    expect(pick(ru)).toEqual({ preparing: "Готовим головоломку…", preparingLong: "Некоторые головоломки готовятся чуть дольше.", failed: "Не удалось подготовить головоломку.", retry: "Повторить", cancel: "Отмена" });
  });

  it("на украинском панель говорит по-украински", async () => {
    await act(() => i18n.changeLanguage("uk"));
    start();
    tick(WAIT_LONG_AFTER_MS);
    expect(panel()!.querySelector('[role="status"]')!.textContent).toBe("Деякі головоломки готуються трохи довше.");
    expect(q("wait-cancel")!.textContent).toBe("Скасувати");
  });

  it("знак — те же девять клеток P4, обход непрерывный (каждая следующая клетка — соседняя), стоп-кадр — правая верхняя", () => {
    const xy = CARRY_ORDER.map(([c, r]) => `${3 + 4 * c},${1 + 4 * r}`).sort();
    expect(xy).toEqual(MARK_SMALL_CELLS.map((c) => `${c.x},${c.y}`).sort());
    for (let i = 1; i < CARRY_ORDER.length; i++) {
      const [a, b] = [CARRY_ORDER[i - 1]!, CARRY_ORDER[i]!];
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1);
    }
    expect(CARRY_STILL).toBe("2,0");
  });
});
