// @vitest-environment jsdom
/**
 * PD-255 (Minor QA PD-218): открытую партию Лжеца дня заменил победитель с другого устройства (`onRemoteApplied` →
 * `reloadDaily`, PD-217). Это не «решили сейчас»: карточка — сразу, без финала (поле не гаснет до 0,55, паузы 240 мс нет,
 * тап не перехватывается), как Today (`useSolveSequence`: не из `playing` — без анимации). Локальное решение — финал как
 * раньше (PD-89), в том числе в каждом режиме после того, как здесь уже показывали удалённую замену (пометка сбрасывается).
 *
 * Синхронизация заменяется на настоящий путь стора: свой `PlayStore` с хранилищем в памяти и подпиской `subscribeRemote`
 * (вместо боевого `syncRuntime`) — запись с сервера, затем уведомление, как `SyncManager.applyLocally`.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { dailyLiarPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { liarRecordFromSaved, savedFromLiarRecord } from "../sync/liarSchema";
import type { RemoteApplied } from "../sync/manager";
import type { InMemoryProgressRepository } from "../today/repository";
import { accuseCell, createLiarPlay } from "./liar";
import type { PlayState } from "./logic";
import { createPlay, enterDigit } from "./logic";
import type { ModeId } from "./modes";
import { PlayScreen } from "./PlayScreen";
import { liarDayKey } from "./savedPlay";
import type * as StoreModule from "./store";
import { playStore } from "./store";

const h = vi.hoisted(() => ({ listener: null as ((info: RemoteApplied) => void) | null, repo: null as InMemoryProgressRepository | null }));
vi.mock("./store", async (importOriginal) => {
  const m = await importOriginal<typeof StoreModule>();
  const { InMemoryProgressRepository } = await import("../today/repository");
  const repo = new InMemoryProgressRepository();
  h.repo = repo;
  const store = new m.PlayStore({
    storage: repo,
    subscribeRemote: (fn) => {
      h.listener = fn;
      return () => (h.listener = null);
    },
  });
  return { ...m, playStore: store };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Лжец: запись снапшота (`liarRecordFromSaved`) и рендер карточки тяжелее обычного — первый тест прогревает модули.
vi.setConfig({ testTimeout: 30_000 });

const DATE = "2026-10-05";
let P: LiarPuzzle;
interface Inner {
  snap: Record<string, unknown>;
  dailies: Map<string, unknown>;
  saved: Map<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};

const empties = (s: PlayState) => s.mission.flatMap((g, i) => (g === 0 ? [i] : []));
const liarPlay = (): PlayState =>
  createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });

/** Лжец, пойманный на 10-й постановке и решённый до последней клетки (`stopBefore` — сколько пустых оставить). */
function liarProgress(stopBefore: number): PlayState {
  let s = liarPlay();
  const cells = empties(s);
  cells.slice(0, 10).forEach((c, k) => (s = enterDigit(s, c, s.solution[c]!, 1000 + k * 700)));
  s = accuseCell(s, P.liarCell, 9000)!.play;
  cells.slice(10, cells.length - stopBefore).forEach((c, k) => (s = enterDigit(s, c, s.solution[c]!, 10_000 + k * 500)));
  return s;
}

/** Запись первого устройства, как её кладёт в хранилище `applyLocally`: решён, время «чужое» (не время этой партии). */
const REMOTE_MS = 777_000;
function remoteSaved() {
  const play = liarProgress(0);
  expect(play.solved).toBe(true);
  const rec = liarRecordFromSaved(
    { v: 1, mode: "liar", difficulty: "medium", startedOn: "2026-10-05T08:00:00.000Z", play, elapsedMs: REMOTE_MS, selected: null, notesMode: false, daily: DATE, solvedAt: "2026-10-05T09:00:00.000Z" },
    new Date(),
  )!;
  return savedFromLiarRecord(DATE, rec)!;
}

/** Сервер прислал решённого Лжеца дня: запись в хранилище, затем уведомление; ждём перечитывание (`reloadDaily`). */
async function applyRemote(): Promise<void> {
  await act(async () => {
    await playStore.flushed();
    await h.repo!.setMeta(liarDayKey(DATE), remoteSaved());
    h.listener!({ dates: [], gridChanged: false, liarDates: [DATE] });
    for (let i = 0; i < 50 && playStore.getSnapshot().phase !== "solved"; i++) await Promise.resolve();
  });
  expect(playStore.getSnapshot()).toMatchObject({ phase: "solved", daily: DATE, remoteSolved: true });
}

const SOLUTION = "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION = "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
/** Классическая партия без последней клетки: следующий верный ввод решает. */
function almostSolvedClassic(): { play: PlayState; last: number } {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  const open = empties(p);
  const last = open[open.length - 1]!;
  open.slice(0, -1).forEach((c, k) => (p = enterDigit(p, c, p.solution[c] as number, (k + 1) * 1000)));
  return { play: p, last };
}

let host: HTMLDivElement;
let root: Root;
const card = () => host.querySelector('[data-testid="new-puzzle"]');
const dimmed = () => host.querySelector(".board.dim") !== null;
const sheetOpen = () => document.querySelector('[data-testid="mode-sheet"]') !== null;
const render = () => act(() => root.render(<PlayScreen />));
/** Открытая партия Лжеца дня на доске (её же заменит победитель). */
const openLiarDay = (play: PlayState) =>
  (inner.snap = {
    ...inner.snap,
    hub: false,
    restoring: false,
    phase: "playing",
    mode: "liar",
    difficulty: "medium",
    daily: DATE,
    play,
    selected: empties(play).find((c) => play.values[c] === 0) ?? null,
    notesMode: false,
    startedOn: new Date(2026, 9, 5, 12),
  });
const pointerdowns = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((c: unknown[]) => c[0] === "pointerdown").length;

beforeAll(async () => {
  P = dailyLiarPuzzle(DATE, "medium");
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    },
  );
  await playStore.restore();
  expect(h.listener).not.toBeNull();
  base = { ...inner.snap };
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    },
  );
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  inner.snap = { ...base };
  inner.dailies.clear();
  inner.saved.clear();
  await h.repo!.setMeta(liarDayKey(DATE), null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PD-255: удалённая замена открытой партии — карточка сразу, без финала", () => {
  it("открытый Лжец дня заменён решённым с другого устройства: карточка в том же кадре, поле не гаснет, тап не перехватывается", async () => {
    openLiarDay(liarProgress(20));
    render();
    expect(card()).toBeNull();
    const add = vi.spyOn(document, "addEventListener");
    await applyRemote();
    // Ни одного таймера не прошло: карточка уже на экране, приглушённого поля нет.
    expect(card()).not.toBeNull();
    expect(dimmed()).toBe(false);
    expect(host.querySelector(".board")).toBeNull();
    // Финал не взводился: перехватчика касаний (тап-прерывание dim-фазы) нет.
    expect(pointerdowns(add)).toBe(0);
    add.mockRestore();
    // Время на карточке — время победителя.
    expect(playStore.getElapsedMs()).toBe(REMOTE_MS);
    // Первый же тап по «New game» срабатывает (хвост касания не гасится — гасить нечего).
    act(() => {
      card()!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      card()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(sheetOpen()).toBe(true);
    // И позже ничего не «доигрывается».
    act(() => void vi.advanceTimersByTime(1000));
    expect(card()).not.toBeNull();
    expect(dimmed()).toBe(false);
  });

  it("замена пришла посреди своего финала (dim-фаза): финал обрывается, карточка сразу, перехватчик снят", async () => {
    const play = liarProgress(1);
    const last = empties(play).find((c) => play.values[c] === 0)!;
    openLiarDay(play);
    render();
    const remove = vi.spyOn(document, "removeEventListener");
    act(() => playStore.input(play.solution[last]!));
    expect(dimmed()).toBe(true);
    expect(card()).toBeNull();
    act(() => void vi.advanceTimersByTime(100));
    await applyRemote();
    expect(card()).not.toBeNull();
    expect(dimmed()).toBe(false);
    expect(pointerdowns(remove)).toBeGreaterThan(0);
    remove.mockRestore();
  });

  it("локальное решение Лжеца дня — финал как раньше: dim 240 мс, затем карточка", () => {
    const play = liarProgress(1);
    const last = empties(play).find((c) => play.values[c] === 0)!;
    openLiarDay(play);
    render();
    act(() => playStore.input(play.solution[last]!));
    expect(playStore.getSnapshot().phase).toBe("solved");
    expect(playStore.getSnapshot().remoteSolved).not.toBe(true);
    expect(dimmed()).toBe(true);
    expect(card()).toBeNull();
    act(() => void vi.advanceTimersByTime(239));
    expect(card()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(card()).not.toBeNull();
  });

  it.each<ModeId>(["classic", "ink", "liar", "melody", "glyphs"])(
    "после показанной удалённой замены новая партия «%s», решённая здесь, снова идёт через финал",
    async (mode) => {
      openLiarDay(liarProgress(20));
      render();
      await applyRemote();
      expect(card()).not.toBeNull();
      // Новая партия режима — настоящим путём стора (фаза сменилась → пометка снята), затем почти решённое поле.
      act(() => playStore.startNew(mode, "easy"));
      expect(playStore.getSnapshot().remoteSolved).toBe(false);
      const { play, last } = almostSolvedClassic();
      act(() => {
        inner.snap = { ...inner.snap, phase: "playing", play, selected: last, startedOn: new Date() };
        playStore.select(last);
      });
      act(() => playStore.input(SOLUTION.charCodeAt(last) - 48));
      expect(playStore.getSnapshot()).toMatchObject({ phase: "solved", remoteSolved: false });
      expect(dimmed()).toBe(true);
      expect(card()).toBeNull();
      act(() => void vi.advanceTimersByTime(240));
      expect(card()).not.toBeNull();
    },
  );
});
