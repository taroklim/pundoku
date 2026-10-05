// @vitest-environment jsdom
/**
 * PD-203: режим Мелодия на экране (решения владельца по макету PD-202). Звук только в партиях Мелодии (в Классике ядро не
 * создаётся вовсе), нота на постановку (ошибочная тоже), undo/стирание/заметки молчат, арпеджио + кольцо при закрытом юните,
 * пункт «Звук» в меню ⋯ (галочка, настройка сохраняется, чип «без звука»), уход/сворачивание — ядро закрыто; карточка:
 * «Сыграть мелодию» → «Остановить», стоп, кнопки нет без мелодии; i18n и подписи VoiceOver. Reduce Motion кольца — melody.css.test.ts.
 */
import { timelapseFrames } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import type { PlayState } from "../play/logic";
import { createPlay, enterDigit, setMelodyMode } from "../play/logic";
import { PlayScreen } from "../play/PlayScreen";
import { ResultCard } from "../play/ResultCard";
import { playStore } from "../play/store";
import { getMelodySound, MELODY_SOUND_KEY, setMelodySound } from "../settings/prefs";
import type { MelodyAudio, MelodyAudioOptions, PathEvent, PlayPathOptions } from "./audio";
import { TabActiveContext } from "../shell/tabSlide";
import { setMelodyAudioFactory } from "./factory";
import { ringLifetimeMs, ringSchedule, UNIT_LEAD_MS } from "./game";
import { END_RELEASE_MS, STOP_RELEASE_MS } from "./MelodyTune";
import { cardTuneOf, TUNE_MAX_MS, timelapseTuneOf } from "./tune";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const ROW0_EMPTY = [2, 3, 5, 6, 7, 8];

/** Мок ядра: записывает вызовы. */
interface Fake {
  readonly opts: MelodyAudioOptions | undefined;
  readonly calls: [string, ...unknown[]][];
  readonly paths: { events: readonly PathEvent[]; opts: PlayPathOptions<PathEvent>; stopped: boolean; end: () => void }[];
}
let fakes: Fake[] = [];
let restoreFactory: () => void = () => undefined;
function fakeFactory(opts?: MelodyAudioOptions): MelodyAudio {
  const f: Fake = { opts, calls: [], paths: [] };
  fakes.push(f);
  let muted = opts?.muted === true;
  return {
    unlock: () => (f.calls.push(["unlock"]), true),
    attachUnlock: (target) => (f.calls.push(["attach", target]), () => f.calls.push(["detach"])),
    playNote: (d) => (f.calls.push(["note", d]), !muted),
    playUnit: (ds, delay) => (f.calls.push(["unit", [...ds], delay]), !muted),
    playPath: (events, o = {}) => {
      const rec = { events, opts: o as PlayPathOptions<PathEvent>, stopped: false, end: () => o.onEnd?.() };
      f.paths.push(rec);
      f.calls.push(["path", events.length, o.fromMs ?? 0]);
      return { stop: () => void (rec.stopped = true), done: Promise.resolve("stopped" as const) };
    },
    setMuted: (m) => {
      muted = m;
      f.calls.push(["mute", m]);
    },
    isMuted: () => muted,
    setTimbre: () => undefined,
    getTimbre: () => "marimba",
    state: () => "running",
    dispose: () => void f.calls.push(["dispose"]),
  };
}
const kinds = (f: Fake, k: string) => f.calls.filter((c) => c[0] === k);

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));

beforeAll(() => {
  restoreFactory = setMelodyAudioFactory(fakeFactory);
});
afterAll(() => restoreFactory());
beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  setMelodySound(true);
  fakes = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  await i18n.changeLanguage("en");
});

describe("партия на экране", () => {
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
  beforeEach(() => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
    inner.snap = { ...base };
    (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  });
  afterEach(() => {
    act(() => playStore.toHub());
    inner.snap = { ...base };
    vi.unstubAllGlobals();
  });
  const start = (mode: "melody" | "classic") => {
    act(() => root.render(<PlayScreen />));
    tap(q(`mode-${mode}`)!);
    tap(q("sheet-start")!);
    act(() => inner.onGenerated(inner.requestId, { id: inner.requestId, ok: true, puzzle: { mission: MISSION, solution: SOLUTION, difficulty: "medium", seed: "t" } }));
  };
  const place = (cell: number, digit: number) =>
    act(() => {
      playStore.select(cell);
      playStore.input(digit);
    });

  it("строка «Мелодия» на хабе — между Лжецом и Глифами, со значком и описанием PD-163", () => {
    act(() => root.render(<PlayScreen />));
    const rows = [...host.querySelectorAll(".hub-row.mode")].map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["mode-classic", "mode-ink", "mode-liar", "mode-melody", "mode-glyphs"]);
    expect(q("mode-melody")!.textContent).toContain("Each digit you place sounds a note.");
    expect(q("mode-melody")!.querySelector("svg")).not.toBeNull();
  });

  it("Классика беззвучна: ядро звука не создаётся вовсе, в меню ⋯ пункта «Звук» нет", () => {
    start("classic");
    expect(playStore.getSnapshot().play?.melody).toBeUndefined();
    place(2, 4);
    place(3, 6);
    expect(fakes).toHaveLength(0);
    tap(q("more-button")!);
    expect(q("menu-sound")).toBeNull();
  });

  it("Мелодия: при входе — ядро без контекста; нота на постановку (и ошибочную); undo/стирание/заметки молчат", () => {
    start("melody");
    expect(playStore.getSnapshot().play?.melody).toBe(true);
    expect(fakes).toHaveLength(1);
    const f = fakes[0]!;
    // PD-206: никакой разблокировки на любом жесте документа — контекст создаётся только при первой ноте.
    expect(kinds(f, "attach")).toHaveLength(0);
    act(() => playStore.select(2)); // выбор клетки — тоже жест, но контекста не создаёт
    tap(q("more-button")!);
    tap(q("more-button")!);
    expect(kinds(f, "unlock")).toHaveLength(0);
    expect(f.opts?.muted).toBe(false);
    // До первого хода — строка о звуке вместо «осталось N».
    expect(q("melody-hint")!.textContent).toContain("Each digit you place plays a note.");
    place(2, 4);
    // Первая цифра: unlock и её нота — в одном обработчике (тем же тапом).
    expect(f.calls.filter((c) => c[0] === "unlock" || c[0] === "note").slice(0, 2)).toEqual([["unlock"], ["note", 4]]);
    expect(kinds(f, "note")).toEqual([["note", 4]]);
    expect(q("melody-hint")).toBeNull();
    place(3, 9); // ошибка (верная — 6): звучит так же
    expect(kinds(f, "note").map((c) => c[1])).toEqual([4, 9]);
    const before = f.calls.length;
    act(() => playStore.undo());
    act(() => {
      playStore.select(2);
      playStore.erase();
    });
    act(() => playStore.toggleNotesMode());
    place(5, 7); // заметка
    expect(f.calls.length).toBe(before);
    expect(kinds(f, "unit")).toHaveLength(0);
  });

  it("PD-206: строка о звуке — три формы (полная / короткая / «осталось N»); видимые замены aria-hidden, полная — доступное имя", () => {
    start("melody");
    const h = q("melody-hint")!;
    expect(h.querySelector(".mh-long")!.textContent).toBe("Each digit you place plays a note. Mute: the ⋯ menu or the silent switch.");
    expect(h.querySelector(".mh-long")!.getAttribute("aria-hidden")).toBeNull();
    expect(h.querySelector(".mh-short")!.textContent).toBe("Each digit plays a note");
    expect(h.querySelector(".mh-short")!.getAttribute("aria-hidden")).toBe("true");
    expect(h.querySelector(".mh-left")!.textContent).toBe(`${MISSION.split("").filter((c) => c === "0").length} left`);
    expect(h.querySelector(".mh-left")!.getAttribute("aria-hidden")).toBe("true");
    // Зазор тот же (одна строка статуса в --chrome): подсказка уходит — элемент-зазор прежний, место не меняется.
    const gap = h.parentElement!;
    expect(gap.classList.contains("gap")).toBe(true);
    place(2, 4);
    expect(q("melody-hint")).toBeNull();
    expect(q("status-line")!.parentElement).toBe(gap);
  });

  it("PD-206: при AX3 (data-type=ax3) строка о звуке — та же разметка, CSS показывает «осталось N»", () => {
    document.documentElement.setAttribute("data-type", "ax3");
    try {
      start("melody");
      const h = q("melody-hint")!;
      expect(h.classList.contains("melody-hint")).toBe(true);
      expect(h.querySelector(".mh-left")).not.toBeNull();
      expect(h.querySelector(".mh-long")!.textContent).toContain("Each digit you place plays a note.");
    } finally {
      document.documentElement.removeAttribute("data-type");
    }
  });

  it("PD-206: «Звук» выкл — цифры не создают и не будят контекст; включили — следующая цифра звучит тем же тапом", () => {
    setMelodySound(false);
    start("melody");
    const f = fakes[0]!;
    place(2, 4);
    place(3, 6);
    expect(kinds(f, "unlock")).toHaveLength(0);
    expect(kinds(f, "note")).toHaveLength(0);
    tap(q("more-button")!);
    tap(q("menu-sound")!);
    place(5, 8);
    expect(f.calls.filter((c) => c[0] === "unlock" || c[0] === "note")).toEqual([["unlock"], ["note", 8]]);
  });

  it("закрыт юнит: после ноты — арпеджио (задержка 350 мс), на поле кольцо по 9 клеткам строки в порядке арпеджио", () => {
    start("melody");
    const f = fakes[0]!;
    const sol = (c: number) => Number(SOLUTION[c]);
    ROW0_EMPTY.slice(0, -1).forEach((c) => place(c, sol(c)));
    expect(kinds(f, "unit")).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="mring"]')).toHaveLength(0);
    place(8, sol(8));
    const units = kinds(f, "unit");
    expect(units[0]).toEqual(["unit", [...SOLUTION.slice(0, 9)].map(Number), UNIT_LEAD_MS]);
    const ringCells = [...host.querySelectorAll('[data-testid="mring"]')].map((r) => Number(r.closest(".cell")!.getAttribute("data-i")));
    expect(ringCells.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const r5 = host.querySelector<HTMLElement>('.cell[data-i="5"] .mring')!;
    expect(r5.style.getPropertyValue("--mi")).toBe("5");
    expect(r5.style.getPropertyValue("--mu")).toBe(String(UNIT_LEAD_MS));
  });

  it("меню ⋯ → «Звук»: галочка снимается, ядро в mute, чип «Мелодия · без звука», настройка переживает перезапуск экрана", () => {
    start("melody");
    const f = fakes[0]!;
    expect(q("mode-chip")!.getAttribute("data-muted")).toBeNull();
    tap(q("more-button")!);
    const item = q("menu-sound")!;
    expect(item.getAttribute("role")).toBe("menuitemcheckbox");
    expect(item.getAttribute("aria-checked")).toBe("true");
    expect(item.getAttribute("aria-label")).toBe("Sound");
    tap(item);
    expect(q("more-menu")).toBeNull();
    expect(kinds(f, "mute").at(-1)).toEqual(["mute", true]);
    expect(localStorage.getItem(MELODY_SOUND_KEY)).toBe("0");
    expect(getMelodySound()).toBe(false);
    const chip = q("mode-chip")!;
    expect(chip.getAttribute("data-muted")).toBe("true");
    expect(chip.textContent).toBe("Melody · muted");
    expect(chip.classList.contains("off")).toBe(true);
    // Экран заново (перезагрузка): ядро создаётся уже немым, чип — «без звука».
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<PlayScreen />));
    act(() => void playStore.open("melody"));
    expect(fakes.at(-1)!.opts?.muted).toBe(true);
    expect(q("mode-chip")!.getAttribute("data-muted")).toBe("true");
    tap(q("more-button")!);
    expect(q("menu-sound")!.getAttribute("aria-checked")).toBe("false");
    tap(q("menu-sound")!);
    expect(localStorage.getItem(MELODY_SOUND_KEY)).toBeNull();
    expect(q("mode-chip")!.getAttribute("data-muted")).toBeNull();
  });

  it("на хаб, сворачивание PWA, уход со вкладки — ядро закрывается; вернулись — новое ждёт жеста", () => {
    start("melody");
    const f = fakes[0]!;
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(kinds(f, "dispose")).toHaveLength(1);
    vis.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(fakes).toHaveLength(2);
    vis.mockRestore();
    act(() => playStore.toHub());
    expect(kinds(fakes[1]!, "dispose")).toHaveLength(1);
    expect(kinds(fakes[1]!, "detach").length + kinds(fakes[1]!, "dispose").length).toBeGreaterThan(0);
  });
});

/** Решённая партия Мелодии: все пустые клетки по порядку, с шагом 2 с. */
function solvedMelody(): PlayState {
  let p = setMelodyMode(createPlay({ mission: MISSION, solution: SOLUTION }));
  let t = 0;
  for (let c = 0; c < 81; c++) {
    if (MISSION[c] !== "0") continue;
    t += 2000;
    p = enterDigit(p, c, Number(SOLUTION[c]), t);
  }
  expect(p.solved).toBe(true);
  return p;
}

describe("карточка: «♪ Сыграть мелодию» (вариант A)", () => {
  const card = (play: PlayState) => act(() => root.render(<ResultCard play={play} cardRef={{ current: null }} title="Solved" timelapse={{ date: "2026-10-05", difficulty: "medium" }} />));

  it("кнопка под картой пути; «Сыграть» → «Остановить», карта проявляется под ноты, live-region; стоп возвращает карту", () => {
    card(solvedMelody());
    const btn = q("melody-tune")!;
    expect(btn.textContent).toBe("Play the tune");
    expect(q("heat")!.nextElementSibling!.classList.contains("legend")).toBe(true);
    expect(q("heat")!.nextElementSibling!.nextElementSibling).toBe(btn);
    expect(fakes).toHaveLength(0); // ядро создаётся только по нажатию
    tap(btn);
    const f = fakes[0]!;
    expect(kinds(f, "unlock")).toHaveLength(1);
    const path = f.paths[0]!;
    expect(path.events.length).toBe(51);
    expect(btn.textContent).toBe("Stop");
    expect(btn.getAttribute("data-playing")).toBe("true");
    expect(q("melody-live")!.textContent).toBe("Playing the tune");
    expect(host.querySelectorAll(".heat i.pend")).toHaveLength(51);
    act(() => path.opts.onStep!(path.events[0]!, 0));
    expect(host.querySelectorAll(".heat i.pend")).toHaveLength(50);
    expect(q("heat-cur")).not.toBeNull();
    tap(btn);
    expect(path.stopped).toBe(true);
    expect(btn.textContent).toBe("Play the tune");
    expect(q("melody-live")!.textContent).toBe("Stopped");
    expect(host.querySelectorAll(".heat i.pend")).toHaveLength(0);
  });

  it("доиграла сама — кнопка возвращается; размонтирование закрывает ядро", () => {
    card(solvedMelody());
    tap(q("melody-tune")!);
    const f = fakes[0]!;
    act(() => f.paths[0]!.end());
    expect(q("melody-tune")!.textContent).toBe("Play the tune");
    act(() => root.unmount());
    root = createRoot(host);
    expect(kinds(f, "dispose")).toHaveLength(1);
  });

  describe("PD-206: контекст карточки живёт только пока мелодия звучит", () => {
    beforeEach(() => void vi.useFakeTimers());
    afterEach(() => void vi.useRealTimers());

    it("«Остановить» — ядро закрыто после затухания шины; следующее «Сыграть» — новое ядро в своём жесте", () => {
      card(solvedMelody());
      tap(q("melody-tune")!);
      const f = fakes[0]!;
      tap(q("melody-tune")!); // стоп
      expect(f.paths[0]!.stopped).toBe(true);
      expect(kinds(f, "dispose")).toHaveLength(0); // шина ещё гаснет — без щелчка
      act(() => void vi.advanceTimersByTime(STOP_RELEASE_MS));
      expect(kinds(f, "dispose")).toHaveLength(1);
      tap(q("melody-tune")!);
      expect(fakes).toHaveLength(2);
      expect(kinds(fakes[1]!, "unlock")).toHaveLength(1);
    });

    it("конец мелодии — ядро закрыто, когда последняя нота отзвучала; «Сыграть» в хвосте берёт живое ядро", () => {
      card(solvedMelody());
      tap(q("melody-tune")!);
      const f = fakes[0]!;
      act(() => f.paths[0]!.end());
      act(() => void vi.advanceTimersByTime(END_RELEASE_MS - 1));
      expect(kinds(f, "dispose")).toHaveLength(0);
      tap(q("melody-tune")!); // повтор в хвосте — то же ядро, закрытие отменено
      expect(fakes).toHaveLength(1);
      act(() => void vi.advanceTimersByTime(END_RELEASE_MS * 2));
      expect(kinds(f, "dispose")).toHaveLength(0);
      act(() => f.paths[1]!.end());
      act(() => void vi.advanceTimersByTime(END_RELEASE_MS));
      expect(kinds(f, "dispose")).toHaveLength(1);
    });

    it("сворачивание (visibilitychange → hidden) и pagehide — стоп и ядро закрыто сразу", () => {
      card(solvedMelody());
      tap(q("melody-tune")!);
      const f = fakes[0]!;
      const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      vis.mockRestore();
      expect(f.paths[0]!.stopped).toBe(true);
      expect(kinds(f, "dispose")).toHaveLength(1);
      tap(q("melody-tune")!);
      const g = fakes[1]!;
      act(() => void window.dispatchEvent(new Event("pagehide")));
      expect(kinds(g, "dispose")).toHaveLength(1);
    });

    it("уход на Today/Year (карточка смонтирована, вкладка неактивна) — стоп и ядро закрыто", () => {
      const play = solvedMelody();
      const at = (active: boolean) =>
        act(() =>
          root.render(
            <TabActiveContext.Provider value={active}>
              <ResultCard play={play} cardRef={{ current: null }} title="Solved" timelapse={{ date: "2026-10-05", difficulty: "medium" }} />
            </TabActiveContext.Provider>,
          ),
        );
      at(true);
      tap(q("melody-tune")!);
      const f = fakes[0]!;
      at(false);
      expect(f.paths[0]!.stopped).toBe(true);
      expect(kinds(f, "dispose")).toHaveLength(1);
      expect(q("melody-tune")!.textContent).toBe("Play the tune");
    });
  });

  it("мелодии нет — кнопки нет: лог синтетический/урезан, а у Классики — нет вовсе", () => {
    card({ ...solvedMelody(), logSynthetic: true });
    expect(q("melody-tune")).toBeNull();
    card({ ...solvedMelody(), log: [] });
    expect(q("melody-tune")).toBeNull();
    const classic = { ...solvedMelody() } as { melody?: true };
    delete classic.melody;
    card(classic as PlayState);
    expect(q("melody-tune")).toBeNull();
    expect(fakes).toHaveLength(0);
  });

  it("открыли таймлапс — мелодия карточки стоп; в плеере кнопка звука (вкл), ▶ — мелодия за кадрами", () => {
    card(solvedMelody());
    tap(q("melody-tune")!);
    const path = fakes[0]!.paths[0]!;
    tap(q("tl-watch")!);
    expect(path.stopped).toBe(true);
    tap(q("tl-start")!);
    const snd = q("tl-sound")!;
    expect(snd.getAttribute("aria-pressed")).toBe("true");
    expect(snd.getAttribute("aria-label")).toBe("Sound");
    expect(snd.getAttribute("title")).toBe("Sound on");
    expect(q("tl-note")!.textContent).toBe("Real rhythm, long pauses shortened. The tune follows the replay.");
    tap(q("tl-play")!);
    const tl = fakes.at(-1)!;
    expect(kinds(tl, "unlock").length).toBeGreaterThan(0);
    expect(tl.paths.at(-1)!.events.length).toBe(51);
    tap(q("tl-play")!); // пауза
    expect(tl.paths.at(-1)!.stopped).toBe(true);
    tap(snd);
    expect(q("tl-sound")!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("мелодия пути (tune.ts)", () => {
  it("карточка: ноты по порядку пути, паузы сжаты ≤ 0,45 с (+ вдох после акцента), трек ≤ 18 с, акценты на закрытых юнитах", () => {
    const tune = cardTuneOf(solvedMelody())!;
    expect(tune).toHaveLength(51);
    expect(tune[0]!.t).toBe(0);
    for (let k = 1; k < tune.length; k++) {
      const gap = tune[k]!.t - tune[k - 1]!.t;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(450 + 120 + 1);
    }
    expect(tune.at(-1)!.t).toBeLessThanOrEqual(TUNE_MAX_MS);
    expect(tune.filter((n) => n.accent).length).toBeGreaterThan(0);
    expect(tune.at(-1)!.accent).toBe(true); // последняя постановка закрывает всё
  });

  it("таймлапс: нота стоит на смещении кадра своей постановки", () => {
    const play = solvedMelody();
    const frames = timelapseFrames(play.log, { mission: MISSION, solution: SOLUTION }, { maxGapMs: Infinity }).frames;
    const offsets = frames.map((_, i) => i * 100);
    const tune = timelapseTuneOf(play, frames, offsets)!;
    expect(tune).toHaveLength(51);
    tune.forEach((n) => {
      expect(frames[n.frame]!.cell).toBe(n.cell);
      expect(n.t).toBe(offsets[n.frame]);
    });
  });

  it("кольцо: клетка на пересечении двух закрытых юнитов получает два кольца; время жизни покрывает оба арпеджио", () => {
    const row = { kind: "row" as const, index: 0, cells: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
    const col = { kind: "col" as const, index: 0, cells: [0, 9, 18, 27, 36, 45, 54, 63, 72] };
    const s = ringSchedule([row, col]);
    expect(s.get(0)).toHaveLength(2);
    expect(s.get(9)![0]!.unitMs).toBeGreaterThan(s.get(1)![0]!.unitMs);
    expect(ringLifetimeMs([row, col])).toBeGreaterThan(s.get(72)![0]!.unitMs + 8 * 110);
  });
});

describe("тексты en/uk/ru", () => {
  const keys = ["sound", "soundOn", "soundOff", "chipMuted", "hint", "hintShort", "tune", "stop", "livePlaying", "liveStopped", "tlNote"];
  it("все строки Мелодии есть во всех трёх локалях", () => {
    for (const loc of [en, uk, ru] as unknown as { melody: Record<string, string> }[]) {
      for (const k of keys) expect(loc.melody[k], k).toEqual(expect.any(String));
    }
    expect((uk as unknown as { melody: Record<string, string> }).melody.chipMuted).toBe("Мелодія · без звуку");
    expect((ru as unknown as { melody: Record<string, string> }).melody.tune).toBe("Сыграть мелодию");
  });
});
