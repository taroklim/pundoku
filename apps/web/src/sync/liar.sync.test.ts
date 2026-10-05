// @vitest-environment jsdom
/**
 * PD-171: раздел `liar` снапшота (план режимов §1.3). Обратная совместимость (снапшот без Лжеца — байт-в-байт как раньше, схему
 * не версионируем), санитайзер недоверенных записей, запись из локальной партии и восстановление партии из записи (секрет
 * выводится из `mission`), атомарное слияние, синхронизация: локальный Лжец дня уходит в PUT, решённый с сервера — в хранилище.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { dailyLiarPuzzle } from "@pundoku/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { accuseCell, createLiarPlay, liarSummaryOf } from "../play/liar";
import type { PlayState } from "../play/logic";
import { enterDigit } from "../play/logic";
import type { SavedPlay } from "../play/savedPlay";
import { liarDayKey, liarInfoOf, parseSavedLiarDay } from "../play/savedPlay";
import { InMemoryProgressRepository } from "../today/repository";
import { progressOf } from "./fixtures";
import type { LiarDayRecord } from "./liarSchema";
import { liarRecordFromSaved, pickLiarRecord, sanitizeLiar, sanitizeLiarRecord, savedFromLiarRecord } from "./liarSchema";
import type { RemoteApplied } from "./manager";
import { SyncManager } from "./manager";
import { mergeSnapshots, sameSnapshotData } from "./merge";
import { buildSnapshotData, dayRecordFromProgress, migrateSnapshot } from "./schema";
import type { SnapshotData } from "./schema";
import type { SyncApi } from "./syncApi";

const DATE = "2026-10-05";
const NOW = new Date("2026-10-05T20:00:00.000Z");
let P: LiarPuzzle;
beforeAll(() => {
  P = dailyLiarPuzzle(DATE, "medium");
});

const empties = (s: PlayState) => s.mission.flatMap((g, i) => (g === 0 ? [i] : []));
const honest = (s: PlayState) => s.mission.findIndex((g, i) => g !== 0 && i !== P.liarCell);
function solvedLiar(): PlayState {
  let s = createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
  s = accuseCell(s, honest(s), 400)!.play;
  const cells = empties(s);
  cells.slice(0, 10).forEach((c, k) => (s = enterDigit(s, c, s.solution[c]!, 1000 + k * 700)));
  s = accuseCell(s, P.liarCell, 9000)!.play;
  cells.slice(10).forEach((c, k) => (s = enterDigit(s, c, s.solution[c]!, 10_000 + k * 500)));
  return s;
}
const savedOf = (play: PlayState, solvedAt: string | null = play.solved ? "2026-10-05T09:00:00.000Z" : null): SavedPlay & { daily: string } => ({
  v: 1,
  mode: "liar",
  difficulty: "medium",
  startedOn: "2026-10-05T08:30:00.000Z",
  play,
  elapsedMs: play.log.at(-1)?.t ?? 0,
  selected: null,
  notesMode: false,
  daily: DATE,
  solvedAt,
});

describe("снапшот: раздел liar", () => {
  it("без Лжеца дня раздела нет: данные байт-в-байт как до PD-171; старый снапшот читается без раздела", () => {
    const days = { "2026-10-01": dayRecordFromProgress(progressOf("2026-10-01"), NOW)! };
    const built = buildSnapshotData({ grid: null, days });
    expect("liar" in built).toBe(false);
    expect(JSON.stringify(built)).toBe(JSON.stringify({ schemaVersion: 1, grid: null, days }));
    const parsed = migrateSnapshot({ schemaVersion: 1, grid: null, days });
    expect(parsed.ok && "liar" in parsed.data).toBe(false);
    expect(buildSnapshotData({ grid: null, days, liar: {} })).toEqual(built);
  });

  it("запись из партии: mission с ложью, итоги поимки, обвинения, лог; читается санитайзером обратно", () => {
    const play = solvedLiar();
    const rec = liarRecordFromSaved(savedOf(play), NOW)!;
    const sum = liarSummaryOf(play)!;
    expect(rec).toMatchObject({
      status: "solved",
      solvedAt: "2026-10-05T09:00:00.000Z",
      mission: P.mission,
      difficulty: "medium",
      caught: true,
      firstTry: false,
      wrongAccusations: 1,
      catchPlacement: 10,
      catchT: 9000,
    });
    expect(sum.catchPlacement).toBe(10);
    expect(rec.accusations).toEqual([
      [400, honest(play), 0],
      [9000, P.liarCell, 10],
    ]);
    expect(rec.moveLog).toMatch(/^1:/);
    // Секрета в записи нет: ни решения, ни клетки лжеца, ни истинной цифры.
    expect(Object.keys(rec).sort()).toEqual(["accusations", "catchPlacement", "catchT", "caught", "difficulty", "firstTry", "mission", "moveLog", "solvedAt", "status", "timeMs", "wrongAccusations"]);
    expect(sanitizeLiarRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
    // Без прогресса — в снапшот не идёт; начатый — `unfinished`.
    const fresh = createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
    expect(liarRecordFromSaved(savedOf(fresh), NOW)).toBeNull();
    expect(liarRecordFromSaved(savedOf(accuseCell(fresh, honest(fresh), 5)!.play), NOW)).toMatchObject({ status: "unfinished", caught: false, wrongAccusations: 1 });
  });

  it("санитайзер: мусор отбрасывается, «решён без поимки» — порча; даты и обвинения проверяются", () => {
    const ok = liarRecordFromSaved(savedOf(solvedLiar()), NOW)!;
    const raw = JSON.parse(JSON.stringify(ok)) as Record<string, unknown>;
    expect(sanitizeLiarRecord({ ...raw, caught: false })).toBeNull();
    expect(sanitizeLiarRecord({ ...raw, mission: "123" })).toBeNull();
    expect(sanitizeLiarRecord({ ...raw, difficulty: "insane" })).toBeNull();
    expect(sanitizeLiarRecord({ ...raw, solvedAt: "yesterday" })).toBeNull();
    expect(sanitizeLiarRecord({ ...raw, accusations: [[1, 99, 0]] })!.accusations).toBeUndefined();
    expect(Object.keys(sanitizeLiar({ [DATE]: raw, "not-a-date": raw, "2026-10-06": 5 }))).toEqual([DATE]);
  });

  it("восстановление: секрет выводится из mission, партия решена, метрики те же, таймлапс-обвинения на месте", () => {
    const rec = liarRecordFromSaved(savedOf(solvedLiar()), NOW)!;
    const saved = savedFromLiarRecord(DATE, rec)!;
    expect(saved.play.liar).toEqual({ liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit, honestMission: P.honestMission });
    expect(saved.play.solved).toBe(true);
    expect(saved.play.mission[P.liarCell]).toBe(P.trueDigit);
    expect(liarInfoOf(saved)).toEqual({ caught: true, wrongAccusations: 1, firstTry: false, catchT: 9000, catchPlacement: 10 });
    expect(saved.play.accusations).toHaveLength(2);
    expect(parseSavedLiarDay(JSON.parse(JSON.stringify(saved)), DATE)).not.toBeNull();
    // Без лога (урезан бюджетом): метрики — из записи, верное обвинение подставлено (партия «поймана»).
    const noLog = savedFromLiarRecord(DATE, { ...rec, moveLog: undefined } as LiarDayRecord)!;
    expect(noLog.play.log).toHaveLength(0);
    expect(liarInfoOf(noLog)).toEqual({ caught: true, wrongAccusations: 1, firstTry: false, catchT: 9000, catchPlacement: 10 });
    expect(savedFromLiarRecord(DATE, { ...rec, status: "unfinished" })).toBeNull();
  });

  it("слияние: объединение по датам; решённый сильнее начатого; оба решены — раньше; без раздела у обеих — без раздела", () => {
    const solved = liarRecordFromSaved(savedOf(solvedLiar()), NOW)!;
    const later = { ...solved, solvedAt: "2026-10-05T10:00:00.000Z" };
    const unfinished: LiarDayRecord = { status: "unfinished", difficulty: "medium", mission: P.mission, caught: false, wrongAccusations: 0, firstTry: false, timeMs: 5000 };
    expect(pickLiarRecord(unfinished, solved)).toBe(solved);
    expect(pickLiarRecord(later, solved)).toBe(solved);
    expect(pickLiarRecord(solved, later)).toBe(solved);
    const base: SnapshotData = { schemaVersion: 1, grid: null, days: {} };
    const a: SnapshotData = { ...base, liar: { [DATE]: unfinished } };
    const b: SnapshotData = { ...base, liar: { [DATE]: later, "2026-10-04": solved } };
    const m = mergeSnapshots(a, b, { serverNewer: true });
    expect(Object.keys(m.liar!).sort()).toEqual(["2026-10-04", DATE]);
    expect(m.liar![DATE]).toBe(later);
    expect(mergeSnapshots(m, m, { serverNewer: true })).toEqual(m);
    expect("liar" in mergeSnapshots(base, base, { serverNewer: false })).toBe(false);
    expect(sameSnapshotData(a, base)).toBe(false);
    expect(sameSnapshotData(a, { ...base, liar: { [DATE]: { ...unfinished } } })).toBe(true);
  });
});

describe("синхронизация Лжеца дня", () => {
  const api = () => {
    const snaps: { version: number; data: unknown }[] = [];
    const a: SyncApi = {
      register: async () => ({ kind: "ok", token: "t1" }),
      pull: async () => (snaps.length ? { kind: "ok", snapshot: { version: snaps.at(-1)!.version, updatedAt: "", data: structuredClone(snaps.at(-1)!.data) } } : { kind: "none" }),
      push: async (_t, body) => {
        snaps.push({ version: body.version, data: structuredClone(body.data) });
        return { kind: "ok", version: body.version };
      },
    };
    return { a, snaps };
  };
  const manager = (storage: InMemoryProgressRepository, a: SyncApi, applied: RemoteApplied[] = []) =>
    new SyncManager({ storage, api: a, now: () => NOW, isOnline: () => true, debounceMs: 10, retryBaseMs: 10, retryMaxMs: 10, onRemoteApplied: (i) => applied.push(i) });

  it("локальный Лжец дня уходит в PUT разделом liar; на чистом устройстве с тем же аккаунтом возвращается решённым", async () => {
    const { a, snaps } = api();
    const one = new InMemoryProgressRepository();
    await one.setMeta(liarDayKey(DATE), savedOf(solvedLiar()));
    await manager(one, a).syncNow(true);
    const sent = snaps.at(-1)!.data as SnapshotData;
    expect(sent.liar![DATE]).toMatchObject({ status: "solved", caught: true, catchPlacement: 10, mission: P.mission });

    const two = new InMemoryProgressRepository();
    await two.setMeta("deviceToken", "t1");
    const applied: RemoteApplied[] = [];
    const m2 = manager(two, a, applied);
    await m2.start();
    await m2.syncNow(true);
    const restored = parseSavedLiarDay(await two.getMeta(liarDayKey(DATE)), DATE)!;
    expect(restored.play.solved).toBe(true);
    expect(liarInfoOf(restored)).toMatchObject({ caught: true, catchPlacement: 10, firstTry: false });
    expect(applied.at(-1)).toMatchObject({ liarDates: [DATE] });
    // Повторная синхронизация не переписывает уже решённого (нет «вечной» перезаписи).
    const before = applied.length;
    await m2.syncNow(true);
    expect(applied.length).toBe(before);
    m2.dispose();
  });
});
