// @vitest-environment jsdom
/**
 * PD-217 (бэклог QA PD-178): PlayStore слушает `onRemoteApplied`. На втором устройстве с открытой партией Лжеца дня решённая
 * на первом устройстве запись, пришедшая синхронизацией, не перезаписывается локальными сохранениями открытой партии: живая
 * партия этой даты заменяется победителем (как Today — `reloadSolved`), строка «Продолжить» исчезает, метрики восстановленной
 * записи (лог урезан бюджетом) не теряются при повторной записи.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { LIAR_VERSION, dailyLiarPuzzle } from "@pundoku/engine";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { liarRecordFromSaved, savedFromLiarRecord } from "../sync/liarSchema";
import type { RemoteApplied } from "../sync/manager";
import { InMemoryProgressRepository } from "../today/repository";
import { liarInfoMap } from "../year/YearTab";
import type { GeneratedPuzzle } from "./generate.worker";
import { accuseCell, createLiarPlay } from "./liar";
import type { PlayState } from "./logic";
import { enterDigit } from "./logic";
import { liarDayKey, liarInfoOf, parseSavedLiarDay } from "./savedPlay";
import { PlayStore } from "./store";

const DATE = "2026-10-05";
let P: LiarPuzzle;
beforeAll(() => {
  P = dailyLiarPuzzle(DATE, "medium");
});

interface Inner {
  requestId: number;
  onGenerated(id: number, r: unknown): void;
}
const generated = (p: LiarPuzzle): GeneratedPuzzle => ({
  mission: p.mission,
  solution: p.solution,
  difficulty: p.difficulty,
  seed: p.seed,
  liar: { liarCell: p.liarCell, liarDigit: p.liarDigit, trueDigit: p.trueDigit, honestMission: p.honestMission, version: LIAR_VERSION },
});
const deliver = (s: PlayStore) => {
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: generated(P) });
};
const empties = (s: PlayState) => s.mission.flatMap((g, i) => (g === 0 ? [i] : []));

/** Партия, решённая «на первом устройстве»: одно неверное обвинение, поимка на 10-й постановке. */
function solvedElsewhere(): PlayState {
  let s = createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
  const honest = s.mission.findIndex((g, i) => g !== 0 && i !== P.liarCell);
  s = accuseCell(s, honest, 400)!.play;
  const cells = empties(s);
  cells.slice(0, 10).forEach((c, k) => (s = enterDigit(s, c, s.solution[c]!, 1000 + k * 700)));
  s = accuseCell(s, P.liarCell, 9000)!.play;
  cells.slice(10).forEach((c, k) => (s = enterDigit(s, c, s.solution[c]!, 10_000 + k * 500)));
  return s;
}

/** Запись снапшота первого устройства → локальная запись второго (как `SyncManager.applyLocally`). `withLog: false` — лог урезан. */
function remoteSaved(withLog = true) {
  const play = solvedElsewhere();
  const rec = liarRecordFromSaved(
    { v: 1, mode: "liar", difficulty: "medium", startedOn: "2026-10-05T08:00:00.000Z", play, elapsedMs: play.log.at(-1)!.t, selected: null, notesMode: false, daily: DATE, solvedAt: "2026-10-05T09:00:00.000Z" },
    new Date(),
  )!;
  if (!withLog) delete rec.moveLog;
  return savedFromLiarRecord(DATE, rec)!;
}

function setup() {
  const repo = new InMemoryProgressRepository();
  let listener: ((info: RemoteApplied) => void) | null = null;
  const s = new PlayStore({
    storage: repo,
    subscribeRemote: (fn) => {
      listener = fn;
      return () => (listener = null);
    },
  });
  /** Сервер прислал решённого Лжеца дня: запись в хранилище, затем уведомление (порядок `applyLocally`). */
  const applyRemote = async (withLog = true) => {
    await repo.setMeta(liarDayKey(DATE), remoteSaved(withLog));
    listener?.({ dates: [], gridChanged: false, liarDates: [DATE] });
  };
  return { repo, s, applyRemote, hasListener: () => listener !== null };
}

describe("PD-217: Лжец дня и onRemoteApplied", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        postMessage() {}
        terminate() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("открытая незаконченная партия той же даты: локальные сохранения не перезаписывают решённую удалённую запись", async () => {
    const { repo, s, applyRemote, hasListener } = setup();
    await s.restore();
    expect(hasListener()).toBe(true);
    s.startDaily(DATE);
    deliver(s);
    const c = empties(s.getSnapshot().play!)[0]!;
    s.select(c);
    s.input(s.getSnapshot().play!.solution[c]!);
    await s.flushed();

    await applyRemote();
    // Игрок продолжает ходить в открытой партии / уходит на хаб / страница скрывается.
    const play = s.getSnapshot().play!;
    const next = empties(play).find((k) => play.values[k] === 0)!;
    s.select(next);
    s.input(play.solution[next]!);
    s.toHub();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(async () => {
      await s.flushed();
      expect(s.getSnapshot().play?.solved).toBe(true);
    });
    await s.flushed();
    const stored = parseSavedLiarDay(await repo.getMeta(liarDayKey(DATE)), DATE)!;
    expect(stored.play.solved).toBe(true);
    expect(stored.solvedAt).toBe("2026-10-05T09:00:00.000Z");
    expect(liarInfoOf(stored)).toMatchObject({ caught: true, catchPlacement: 10, wrongAccusations: 1 });
    // Живая партия этой даты — победитель: решена, «Продолжить» нет, Year видит пойманного.
    expect(s.getSnapshot()).toMatchObject({ daily: DATE, phase: "solved" });
    // PD-255: экран узнаёт, что партию решили не здесь (карточка без финала); новая партия пометку снимает.
    expect(s.getSnapshot().remoteSolved).toBe(true);
    expect(s.liarDay(DATE).kind).toBe("solved");
    expect(s.liarDayContinue(DATE)).toBeNull();
    expect(liarInfoMap(await repo.listMeta("liar:")).get(DATE)).toMatchObject({ caught: true, catchPlacement: 10 });
    s.startNew("classic", "easy");
    expect(s.getSnapshot().remoteSolved).toBe(false);
  });

  it("незаконченный Лжец дня не на доске (строка «Продолжить»): решённый с сервера убирает строку", async () => {
    const { s, applyRemote } = setup();
    await s.restore();
    s.startDaily(DATE);
    deliver(s);
    const c = empties(s.getSnapshot().play!)[0]!;
    s.select(c);
    s.input(s.getSnapshot().play!.solution[c]!);
    s.startNew("classic", "easy"); // Лжец дня припаркован в свою запись, на доске — другая партия
    await s.flushed();
    expect(s.liarDayContinue(DATE)).toMatchObject({ date: DATE });
    await applyRemote();
    await vi.waitFor(() => expect(s.liarDay(DATE).kind).toBe("solved"));
    expect(s.liarDayContinue(DATE)).toBeNull();
    expect(s.getSnapshot().mode).toBe("classic");
  });

  it("решённая запись с урезанным логом: открыть карточку и уйти — метрики Лжеца в записи сохраняются", async () => {
    const { repo, s, applyRemote } = setup();
    await s.restore();
    await applyRemote(false);
    s.refreshDaily(DATE); // так же, как при открытии шита Лжеца: проверка не зависит от подписки
    await vi.waitFor(() => expect(s.liarDay(DATE).kind).toBe("solved"));
    s.startDaily(DATE);
    expect(s.getSnapshot()).toMatchObject({ phase: "solved", daily: DATE });
    s.toHub();
    document.dispatchEvent(new Event("visibilitychange"));
    await s.flushed();
    const stored = parseSavedLiarDay(await repo.getMeta(liarDayKey(DATE)), DATE)!;
    expect(stored.solvedAt).toBe("2026-10-05T09:00:00.000Z");
    expect(liarInfoOf(stored)).toMatchObject({ caught: true, catchPlacement: 10, wrongAccusations: 1, firstTry: false });
  });
});
