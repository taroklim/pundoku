// @vitest-environment jsdom
/**
 * PD-171: Лжец в web — логика партии и стор. Обвинение (верное/неверное/повтор/не подсказка), закрытые до поимки каналы
 * ответа (подсказки, волны M3/M8, Ink), «решено» только после поимки, метрики карточки, слой таймлапса, слоты/Лжец дня/
 * история поимок, заготовки тяжёлых классов, Worker.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { LIAR_VERSION, dailyLiarPuzzle, timelapseFrames } from "@pundoku/engine";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProgressRepository } from "../today/repository";
import { buildPuzzle } from "./generate.worker";
import type { GeneratedPuzzle } from "./generate.worker";
import {
  accuseCell,
  acquittedCells,
  canAccuse,
  caughtLie,
  createLiarPlay,
  liarCaught,
  liarHidden,
  liarMission,
  liarSummaryOf,
  liarTimelapseLayer,
} from "./liar";
import type { WorkerLike } from "./liarPool";
import { LiarPool, poolKey } from "./liarPool";
import type { PlayState } from "./logic";
import { enterDigit, setInkMode } from "./logic";
import { liarDayKey, parseSavedPlay } from "./savedPlay";
import { PlayStore, LIAR_HISTORY_KEY, slotKey } from "./store";

const DATE = "2026-10-05";
let P: LiarPuzzle;
beforeAll(() => {
  P = dailyLiarPuzzle(DATE, "medium");
});
afterEach(() => {
  vi.useRealTimers();
});

const data = (p: LiarPuzzle) => ({
  mission: p.mission,
  solution: p.solution,
  honestMission: p.honestMission,
  liarCell: p.liarCell,
  liarDigit: p.liarDigit,
  trueDigit: p.trueDigit,
});
const fresh = (): PlayState => createLiarPlay(data(P));
const generated = (p: LiarPuzzle): GeneratedPuzzle => ({
  mission: p.mission,
  solution: p.solution,
  difficulty: p.difficulty,
  seed: p.seed,
  liar: { liarCell: p.liarCell, liarDigit: p.liarDigit, trueDigit: p.trueDigit, honestMission: p.honestMission, version: LIAR_VERSION },
});
/** Подсказки, кроме лжеца. */
const honestGivens = (s: PlayState): number[] => s.mission.flatMap((g, i) => (g !== 0 && i !== P.liarCell ? [i] : []));
const empties = (s: PlayState): number[] => s.mission.flatMap((g, i) => (g === 0 ? [i] : []));
/** Заполнить все пустые клетки верными цифрами. */
const fillAll = (s: PlayState): PlayState => empties(s).reduce((acc, c, k) => enterDigit(acc, c, acc.solution[c]!, 1000 + k), s);

describe("логика Лжеца", () => {
  it("новая партия: ложь на поле, каналы ответа закрыты, обвинять можно только подсказки", () => {
    const s = fresh();
    expect(s.mission[P.liarCell]).toBe(P.liarDigit);
    expect(liarHidden(s)).toBe(true);
    expect(liarCaught(s)).toBe(false);
    expect(caughtLie(s)).toBeNull();
    expect(canAccuse(s, honestGivens(s)[0]!)).toBe(true);
    expect(canAccuse(s, P.liarCell)).toBe(true);
    expect(canAccuse(s, empties(s)[0]!)).toBe(false);
    expect(accuseCell(s, empties(s)[0]!, 0)).toBeNull();
  });

  it("неверное обвинение: подсказка оправдана, счётчик растёт, повторно обвинить нельзя; лог ходов не трогается", () => {
    const [a, b] = honestGivens(fresh());
    const r1 = accuseCell(fresh(), a!, 1500)!;
    expect(r1.result).toEqual({ kind: "honest", cell: a });
    expect(r1.play.log).toHaveLength(0);
    expect(r1.play.undoStack).toHaveLength(0);
    expect([...acquittedCells(r1.play)]).toEqual([a]);
    expect(liarHidden(r1.play)).toBe(true);
    expect(canAccuse(r1.play, a!)).toBe(false);
    expect(accuseCell(r1.play, a!, 2000)).toBeNull(); // повтор не пускается и в логике
    const r2 = accuseCell(r1.play, b!, 2500)!;
    expect(r2.play.accusations).toHaveLength(2);
    expect(liarSummaryOf(r2.play)!.wrongAccusations).toBe(2);
  });

  it("верное обвинение: клетка лжеца получает истинную цифру, каналы открываются, дальше обвинять нельзя", () => {
    const s = enterDigit(fresh(), empties(fresh())[0]!, 1, 700); // любая постановка до поимки
    const r = accuseCell(s, P.liarCell, 3000)!;
    expect(r.result.kind).toBe("liar");
    expect(r.play.mission[P.liarCell]).toBe(P.trueDigit);
    expect(liarCaught(r.play)).toBe(true);
    expect(liarHidden(r.play)).toBe(false);
    expect(caughtLie(r.play)).toEqual({ cell: P.liarCell, lie: P.liarDigit });
    expect(canAccuse(r.play, honestGivens(r.play)[0]!)).toBe(false);
    expect(r.play.accusations![0]).toEqual({ t: 3000, cell: P.liarCell, moveIndex: 1 });
    expect(liarMission(r.play)).toBe(P.mission); // исходная сетка восстанавливается из секрета
  });

  it("без поимки решить нельзя: все клетки верны, но партия не решена; поимка её заканчивает", () => {
    const full = fillAll(fresh());
    expect(full.solved).toBe(false);
    const r = accuseCell(full, P.liarCell, 99_000)!;
    expect(r.play.solved).toBe(true);
    const sum = liarSummaryOf(r.play)!;
    expect(sum).toMatchObject({ caught: true, firstTry: true, wrongAccusations: 0, catchT: 99_000, catchPlacement: empties(fresh()).length });
  });

  it("Move.correct считается против истинного решения (для карточки/таймлапса), хотя на экран не выводится", () => {
    const c = empties(fresh())[0]!;
    const wrong = (P.solution.charCodeAt(c) - 48) % 9 + 1;
    const s = enterDigit(fresh(), c, wrong, 10);
    expect(s.log[0]).toMatchObject({ kind: "place", correct: false });
  });

  it("Лжец × Чернила: ink не включается ни логикой, ни на свежей партии", () => {
    expect(setInkMode(fresh(), true)).toEqual(fresh());
    expect(setInkMode(fresh(), true).ink).toBeUndefined();
  });

  it("слой таймлапса: ложь до кадра поимки, печати оправданных — с кадра перед обвинением", () => {
    const cells = empties(fresh());
    let s = fresh();
    s = enterDigit(s, cells[0]!, s.solution[cells[0]!]!, 100);
    s = accuseCell(s, honestGivens(s)[0]!, 150)!.play; // после хода 0 → видно с кадра хода 0 (кадр 1)
    s = enterDigit(s, cells[1]!, s.solution[cells[1]!]!, 200);
    s = enterDigit(s, cells[2]!, s.solution[cells[2]!]!, 300);
    s = accuseCell(s, P.liarCell, 350)!.play; // после хода 2 → с кадра 3
    const frames = timelapseFrames(s.log, { mission: s.mission.join(""), solution: s.solution.join("") }).frames;
    const layer = liarTimelapseLayer(s, frames)!;
    expect(layer).toMatchObject({ cell: P.liarCell, lie: P.liarDigit, truth: P.trueDigit, catchFrame: 3 });
    expect(layer.acquitted.get(honestGivens(s)[0]!)).toBe(1);
    // Обвинение до первого хода — с начального кадра.
    const early = accuseCell(fresh(), P.liarCell, 5)!.play;
    expect(liarTimelapseLayer(early, [{ move: -1 }])!.catchFrame).toBe(0);
  });
});

interface Inner {
  requestId: number;
  onGenerated(id: number, r: unknown): void;
}
const deliver = (s: PlayStore, puzzle: GeneratedPuzzle) => {
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle });
};

describe("стор: партия Лжеца", () => {
  const begin = async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    s.startNew("liar", "medium");
    deliver(s, generated(P));
    return { s, repo };
  };

  it("старт режима Лжец даёт партию с секретом; подсказок нет до поимки и есть после; Ink не включается", async () => {
    const { s } = await begin();
    const play = s.getSnapshot().play!;
    expect(play.liar).toEqual({ liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit, honestMission: P.honestMission });
    expect(s.hintAllowed()).toBe(false);
    expect(s.setInk(true)).toBe(false);
    expect(s.inkChoosable()).toBe(false);
    expect(s.accuse(P.liarCell)).toBe("liar");
    expect(s.hintAllowed()).toBe(true);
    expect(s.getSnapshot().accusation).toMatchObject({ kind: "liar", cell: P.liarCell });
    expect(s.getSnapshot().hint).toMatchObject({ kind: "liarCaught" });
  });

  it("неверное обвинение — отклик со счётчиком; повторное в сторе не проходит", async () => {
    const { s } = await begin();
    const g = honestGivens(s.getSnapshot().play!)[0]!;
    expect(s.canAccuse(g)).toBe(true);
    expect(s.accuse(g)).toBe("honest");
    expect(s.getSnapshot().hint).toMatchObject({ kind: "liarHonest", count: 1 });
    expect(s.canAccuse(g)).toBe(false);
    expect(s.accuse(g)).toBeNull();
    expect(s.getSnapshot().play!.accusations).toHaveLength(1);
  });

  it("до поимки собранный верно юнит не даёт волны M3 и ответа M8 (выдали бы ложь); после поимки — даёт", async () => {
    const { s } = await begin();
    const play = s.getSnapshot().play!;
    // Строка без клетки лжеца с наименьшим числом пустых — собираем её целиком.
    const rows = Array.from({ length: 9 }, (_, r) => r).filter((r) => Math.floor(P.liarCell / 9) !== r);
    const rowCells = (r: number) => Array.from({ length: 9 }, (_, k) => r * 9 + k).filter((c) => play.mission[c] === 0);
    const [r1, r2] = rows.sort((a, b) => rowCells(a).length - rowCells(b).length);
    for (const c of rowCells(r1!)) {
      s.select(c);
      s.input(play.solution[c]!);
      expect(s.getSnapshot().wave).toBeNull();
      expect(s.getSnapshot().echo ?? null).toBeNull();
    }
    s.accuse(P.liarCell);
    let waved = false;
    for (const c of rowCells(r2!)) {
      s.select(c);
      s.input(play.solution[c]!);
      if (s.getSnapshot().wave) waved = true;
    }
    expect(waved).toBe(true);
  });

  it("слот `playGame:liar` хранит секрет и обвинения; читается обратно; испорченный секрет — запись отбрасывается", async () => {
    const { s, repo } = await begin();
    s.accuse(honestGivens(s.getSnapshot().play!)[0]!);
    await s.flushed();
    const raw = (await repo.getMeta(slotKey("liar"))) as Record<string, unknown>;
    const parsed = parseSavedPlay(raw, "liar")!;
    expect(parsed.mode).toBe("liar");
    expect(parsed.play.accusations).toHaveLength(1);
    expect(parsed.play.liar!.liarCell).toBe(P.liarCell);
    const play = raw["play"] as Record<string, unknown>;
    expect(parseSavedPlay({ ...raw, play: { ...play, liar: { ...(play["liar"] as object), liarCell: 99 } } }, "liar")).toBeNull();
    expect(parseSavedPlay({ ...raw, play: { ...play, accusations: [{ t: 0, cell: 1, moveIndex: 5 }] } }, "liar")).toBeNull();
    expect(parseSavedPlay(raw, "classic")).toBeNull(); // партия Лжеца в чужом слоте
    // Перезапуск: слот режима — строка хаба, открывается с теми же обвинениями.
    const again = new PlayStore({ storage: repo });
    await again.restore();
    expect(again.slots().liar).toBeDefined();
    expect(again.open("liar")).toBe(true);
    expect(again.getSnapshot().play!.accusations).toHaveLength(1);
  });

  it("история поимок: средний ход обвинения по ДРУГИМ партиям; первая — сравнивать не с чем", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.setMeta(LIAR_HISTORY_KEY, [
      { id: "2026-01-01T00:00:00.000Z", catchPlacement: 10 },
      { id: "2026-01-02T00:00:00.000Z", catchPlacement: 21 },
      { bogus: true },
    ]);
    const s = new PlayStore({ storage: repo });
    await s.restore();
    s.startNew("liar", "medium");
    deliver(s, generated(P));
    expect(s.liarAverage()).toEqual({ avg: 16, games: 2 });
    const empty = new PlayStore({ storage: new InMemoryProgressRepository() });
    await empty.restore();
    expect(empty.liarAverage()).toBeNull();
  });
});

describe("стор: Лжец дня", () => {
  // Worker «молчит»: ответ генерации тесты доставляют сами (`deliver`), а фаза остаётся «загрузка», как в браузере.
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
  it("строится по дате (medium), пишется в `meta:liar:<дата>`, переживает решение и уход на хаб, не трогает свободный слот", async () => {
    const repo = new InMemoryProgressRepository();
    const notify = vi.fn();
    const s = new PlayStore({ storage: repo, notify });
    await s.restore();
    // Свободная партия Лжеца в слоте.
    s.startNew("liar", "easy");
    deliver(s, generated(P));
    s.accuse(honestGivens(s.getSnapshot().play!)[0]!);
    s.toHub();
    expect(s.liarDay(DATE)).toEqual({ kind: "none" });

    s.startDaily(DATE);
    expect(s.getSnapshot()).toMatchObject({ daily: DATE, mode: "liar", difficulty: "medium", phase: "loading" });
    deliver(s, generated(P));
    const play = s.getSnapshot().play!;
    s.select(empties(play)[0]!);
    s.input(play.solution[empties(play)[0]!]!);
    expect(notify).toHaveBeenCalledWith("progress");
    expect(s.liarDay(DATE).kind).toBe("playing");
    expect(s.liarDaySlot(DATE)).toMatchObject({ difficulty: "medium" });
    // Свободный слот Лжеца цел, живой Лжец дня в слоты не попадает.
    expect(s.slots().liar).toMatchObject({ difficulty: "easy" });
    s.toHub();
    await s.flushed();
    expect(await repo.getMeta(liarDayKey(DATE))).toMatchObject({ daily: DATE, mode: "liar", solvedAt: null });

    // Открыть свободного: Лжец дня паркуется в свою запись.
    expect(s.open("liar")).toBe(true);
    expect(s.getSnapshot().daily ?? null).toBeNull();
    expect(s.getSnapshot().difficulty).toBe("easy");
    s.toHub();

    // Вернуться к Лжецу дня, решить: запись остаётся, `solved` уходит в синхронизацию.
    s.startDaily(DATE);
    expect(s.getSnapshot().daily).toBe(DATE);
    for (const c of empties(s.getSnapshot().play!)) {
      if ((s.getSnapshot().play!.values[c] ?? 0) !== 0) continue;
      s.select(c);
      s.input(s.getSnapshot().play!.solution[c]!);
    }
    expect(s.getSnapshot().phase).toBe("playing");
    s.accuse(P.liarCell);
    expect(s.getSnapshot().phase).toBe("solved");
    await s.flushed();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("solved"));
    const rec = (await repo.getMeta(liarDayKey(DATE))) as { solvedAt: string; play: PlayState };
    expect(Date.parse(rec.solvedAt)).not.toBeNaN();
    expect(rec.play.solved).toBe(true);
    s.toHub();
    await s.flushed();
    expect(await repo.getMeta(liarDayKey(DATE))).not.toBeNull(); // решённый Лжец дня не удаляется
    expect(await repo.getMeta(slotKey("liar"))).not.toBeNull(); // и свободный слот не тронут
    expect(s.liarDay(DATE).kind).toBe("solved");
    expect(s.liarDaySlot(DATE)).toBeNull();
    // Новый запуск: запись читается, Лжец дня открывается сразу карточкой.
    const again = new PlayStore({ storage: repo });
    await again.restore();
    again.refreshDaily(DATE);
    await vi.waitFor(() => expect(again.liarDay(DATE).kind).toBe("solved"));
    again.startDaily(DATE);
    expect(again.getSnapshot()).toMatchObject({ phase: "solved", daily: DATE, hub: false });
    // История поимок пополнилась (сравнение с собой).
    expect(await repo.getMeta(LIAR_HISTORY_KEY)).toHaveLength(1);
  });

  it("повтор после сбоя генерации Лжеца дня — снова Лжец дня, не свободная партия", async () => {
    const s = new PlayStore({ storage: new InMemoryProgressRepository() });
    await s.restore();
    s.startDaily(DATE);
    const i = s as unknown as Inner;
    i.onGenerated(i.requestId, { id: i.requestId, ok: false, error: "timeout" });
    expect(s.getSnapshot().phase).toBe("error");
    s.retry();
    expect(s.getSnapshot()).toMatchObject({ phase: "loading", daily: DATE, mode: "liar" });
  });
});

describe("Worker и заготовки", () => {
  it("buildPuzzle: Лжец дня — ровно dailyLiarPuzzle; секрет с версией генератора", () => {
    const g = buildPuzzle({ id: 1, difficulty: "medium", date: DATE, liar: true });
    expect(g.mission).toBe(P.mission);
    expect(g.liar).toEqual({ liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit, honestMission: P.honestMission, version: LIAR_VERSION });
    expect(buildPuzzle({ id: 2, difficulty: "easy", seed: "x" }).liar).toBeUndefined();
  });

  const fakeWorker = (reply: (req: { difficulty: string }) => GeneratedPuzzle | null) => {
    const spawned: WorkerLike[] = [];
    const spawn = () => {
      const w: WorkerLike & { terminated: boolean } = {
        onmessage: null,
        onerror: null,
        terminated: false,
        postMessage(req) {
          const p = reply(req);
          if (p) queueMicrotask(() => w.onmessage?.({ data: { id: 1, ok: true, puzzle: p } } as MessageEvent));
        },
        terminate() {
          w.terminated = true;
        },
      };
      spawned.push(w);
      return w;
    };
    return { spawn, spawned };
  };

  it("прогрев кладёт по одной сетке expert и master; take забирает и удаляет; чужая версия отбрасывается", async () => {
    const repo = new InMemoryProgressRepository();
    const { spawn, spawned } = fakeWorker((req) => ({ ...generated(P), difficulty: req.difficulty as never }));
    const pool = new LiarPool({ storage: repo, spawn, seed: () => "s" });
    await pool.warm();
    expect(spawned).toHaveLength(2);
    expect(await repo.getMeta(poolKey("expert"))).toMatchObject({ difficulty: "expert" });
    expect(await repo.getMeta(poolKey("master"))).toMatchObject({ difficulty: "master" });
    await pool.warm(); // уже всё есть — новых генераций нет
    expect(spawned).toHaveLength(2);
    expect(await pool.take("expert")).toMatchObject({ difficulty: "expert" });
    expect(await repo.getMeta(poolKey("expert"))).toBeNull();
    expect(await pool.take("medium")).toBeNull(); // лёгкие классы не заготавливаются
    await repo.setMeta(poolKey("master"), { ...generated(P), difficulty: "master", liar: { ...generated(P).liar!, version: LIAR_VERSION - 1 } });
    expect(await pool.take("master")).toBeNull();
  });

  it("таймаут фоновой генерации: Worker обрывается, заготовки нет, игра не ждёт", async () => {
    vi.useFakeTimers();
    const repo = new InMemoryProgressRepository();
    const { spawn, spawned } = fakeWorker(() => null);
    const pool = new LiarPool({ storage: repo, spawn, seed: () => "s", timeoutMs: 1000 });
    const run = pool.warm();
    await vi.advanceTimersByTimeAsync(1001);
    await run;
    expect((spawned[0] as unknown as { terminated: boolean }).terminated).toBe(true);
    expect(await repo.getMeta(poolKey("expert"))).toBeNull();
  });

  it("старт тяжёлого класса берёт заготовку, если она есть (без ожидания генерации)", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.setMeta(poolKey("expert"), { ...generated(P), difficulty: "expert" });
    const pool = new LiarPool({ storage: repo, spawn: fakeWorker(() => null).spawn, seed: () => "s" });
    const s = new PlayStore({ storage: repo, pool });
    await s.restore();
    s.startNew("liar", "expert");
    await vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"));
    expect(s.getSnapshot().play!.liar!.liarCell).toBe(P.liarCell);
    pool.stop();
  });
});
