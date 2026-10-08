// @vitest-environment jsdom
/**
 * PD-217 (бэклог QA PD-178): незаконченный Лжец дня после полуночи. Строка «Продолжить» хаба держит его до завершения (в том
 * числе после перезапуска на следующий день), открывается именно он, а результат пишется в запись (и Year) ИСХОДНОЙ даты
 * партии, не текущей.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { LIAR_VERSION, dailyLiarPuzzle } from "@pundoku/engine";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProgressRepository } from "../today/repository";
import { liarInfoMap } from "../year/YearTab";
import type { GeneratedPuzzle } from "./generate.worker";
import { liarDayKey } from "./savedPlay";
import { PlayStore } from "./store";

const D1 = "2026-10-05";
const D2 = "2026-10-06";
let P1: LiarPuzzle;
let P2: LiarPuzzle;
beforeAll(() => {
  P1 = dailyLiarPuzzle(D1, "medium");
  P2 = dailyLiarPuzzle(D2, "medium");
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
const deliver = (s: PlayStore, p: LiarPuzzle) => {
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: generated(p) });
};
/** Локальный полдень даты (localDate считает по часовому поясу устройства). */
const noon = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const at = (date: string) => vi.setSystemTime(noon(date));

/** Один верный ход в открытой партии (прогресс — партия попадает в «Продолжить»). */
function oneMove(s: PlayStore): void {
  const play = s.getSnapshot().play!;
  const c = play.mission.findIndex((g, i) => g === 0 && play.values[i] === 0);
  s.select(c);
  s.input(play.solution[c]!);
}
/** Довести открытую партию Лжеца до решения: все пустые клетки + верное обвинение. */
function finish(s: PlayStore, liarCell: number): void {
  for (let c = 0; c < 81; c++) {
    const play = s.getSnapshot().play!;
    if (play.mission[c] !== 0 || play.values[c] !== 0) continue;
    s.select(c);
    s.input(play.solution[c]!);
  }
  s.accuse(liarCell);
}

/** Лжец дня D1 начат (один ход) и оставлен на хабе; запись в хранилище. */
async function startedYesterday(repo = new InMemoryProgressRepository()) {
  at(D1);
  const s = new PlayStore({ storage: repo });
  await s.restore();
  s.startDaily(D1);
  deliver(s, P1);
  oneMove(s);
  s.toHub();
  await s.flushed();
  return { s, repo };
}

describe("PD-217: Лжец дня после полуночи", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("перезапуск на следующий день: «Продолжить» — вчерашний Лжец дня; он и открывается; решение — в запись и Year его даты", async () => {
    const { repo } = await startedYesterday();
    at(D2);
    const s = new PlayStore({ storage: repo });
    await s.restore();
    // PD-262: сводка несёт день головоломки — строка «Продолжить» подписывает им вчерашнего Лжеца.
    expect(s.liarDayContinue()).toMatchObject({ date: D1, summary: { difficulty: "medium", date: D1 } });
    s.startDaily(s.liarDayContinue()!.date);
    expect(s.getSnapshot()).toMatchObject({ daily: D1, phase: "playing", hub: false });
    finish(s, P1.liarCell);
    expect(s.getSnapshot().phase).toBe("solved");
    s.toHub();
    await s.flushed();
    expect(s.liarDayContinue()).toBeNull();
    expect(await repo.getMeta(liarDayKey(D1))).toMatchObject({ daily: D1, play: { solved: true } });
    expect(await repo.getMeta(liarDayKey(D2))).toBeNull();
    const year = liarInfoMap(await repo.listMeta("liar:"));
    expect([...year.keys()]).toEqual([D1]);
    expect(year.get(D1)).toMatchObject({ caught: true });
  });

  it("полночь посреди сессии: живой незаконченный Лжец дня остаётся в «Продолжить» и решается на свою дату", async () => {
    const { s, repo } = await startedYesterday();
    at(D2);
    expect(s.liarDayContinue()).toMatchObject({ date: D1, summary: { date: D1 } });
    s.startDaily(s.liarDayContinue()!.date);
    expect(s.getSnapshot()).toMatchObject({ daily: D1, hub: false });
    finish(s, P1.liarCell);
    await s.flushed();
    expect(await repo.getMeta(liarDayKey(D1))).toMatchObject({ daily: D1, play: { solved: true } });
    expect(await repo.getMeta(liarDayKey(D2))).toBeNull();
  });

  it("сегодняшний с прогрессом — первым; после его решения в «Продолжить» возвращается вчерашний", async () => {
    const { repo } = await startedYesterday();
    at(D2);
    const s = new PlayStore({ storage: repo });
    await s.restore();
    s.startDaily(D2);
    deliver(s, P2);
    oneMove(s);
    s.toHub();
    expect(s.liarDayContinue()).toMatchObject({ date: D2 });
    s.startDaily(D2);
    finish(s, P2.liarCell);
    s.toHub();
    expect(s.liarDayContinue()).toMatchObject({ date: D1 });
  });

  it("вчерашний решённый и вчерашний без прогресса в «Продолжить» не попадают", async () => {
    const repo = new InMemoryProgressRepository();
    at(D1);
    const a = new PlayStore({ storage: repo });
    await a.restore();
    a.startDaily(D1);
    deliver(a, P1);
    finish(a, P1.liarCell);
    a.toHub();
    await a.flushed();
    // Без прогресса: открыт и брошен без хода (запись есть, строки «Продолжить» у такого нет и сегодня).
    await repo.setMeta(liarDayKey("2026-10-04"), { ...((await repo.getMeta(liarDayKey(D1))) as object), daily: "2026-10-04", solvedAt: null, play: { ...(((await repo.getMeta(liarDayKey(D1))) as { play: object }).play), solved: false, log: [], accusations: [] } });
    at(D2);
    const b = new PlayStore({ storage: repo });
    await b.restore();
    expect(b.liarDayContinue()).toBeNull();
  });
});
