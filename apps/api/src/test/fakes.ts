/* In-memory реализации репозиториев и фейки для unit-тестов (без Postgres). */
import pino from "pino";
import type { DailyPuzzle, DailyPuzzleRepo, DailyPuzzleSource, NewDailyPuzzle, PuzzleGenerator, SourceResult } from "../daily/types.js";
import type { DeviceRepo } from "../devices/types.js";
import type { Snapshot, SnapshotRepo, SnapshotWrite, UpsertResult } from "../snapshot/types.js";
import { createApp, type AppDeps } from "../app.js";

// Реальная сетка Sudoku.com за 2026-09-28 (живой запрос 2026-09-29).
export const SAMPLE = {
  id: "1f13c7e4-096f-64fe-9710-577982589729",
  mission: "002000000085703020004920061030000084600001000000040610003080000210006740006007830",
  solution: "962415378185763429374928561531672984649831257827549613753284196218396745496157832",
  win_rate: 52.1,
  difficulty: "hard",
};

export class MemoryDailyPuzzleRepo implements DailyPuzzleRepo {
  readonly rows = new Map<string, DailyPuzzle>();
  async find(date: string): Promise<DailyPuzzle | null> {
    return this.rows.get(date) ?? null;
  }
  async insertIfAbsent(p: NewDailyPuzzle): Promise<DailyPuzzle> {
    const existing = this.rows.get(p.date);
    if (existing) return existing;
    const row = { ...p, fetchedAt: new Date() };
    this.rows.set(p.date, row);
    return row;
  }
}

export class MemoryDeviceRepo implements DeviceRepo {
  readonly byHash = new Map<string, { id: string; createdAt: Date; lastSeenAt: Date }>();
  private seq = 0;
  async create(tokenHash: string) {
    const row = { id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`, createdAt: new Date(), lastSeenAt: new Date() };
    this.byHash.set(tokenHash, row);
    return { id: row.id, createdAt: row.createdAt };
  }
  async touchByTokenHash(tokenHash: string) {
    const row = this.byHash.get(tokenHash);
    if (!row) return null;
    row.lastSeenAt = new Date();
    return { id: row.id };
  }
}

export class MemorySnapshotRepo implements SnapshotRepo {
  readonly rows = new Map<string, Snapshot>();
  async get(deviceId: string): Promise<Snapshot | null> {
    return this.rows.get(deviceId) ?? null;
  }
  async upsertIfNewer(w: SnapshotWrite): Promise<UpsertResult> {
    const current = this.rows.get(w.deviceId);
    if (current && current.version >= w.version) return { stored: false, current };
    const snapshot: Snapshot = { ...w, data: structuredClone(w.data) };
    this.rows.set(w.deviceId, snapshot);
    return { stored: true, snapshot };
  }
}

export class FakeSource implements DailyPuzzleSource {
  readonly calls: string[] = [];
  constructor(public result: SourceResult = { kind: "ok", puzzle: { ...SAMPLE, winRate: SAMPLE.win_rate } }) {}
  async fetch(date: string): Promise<SourceResult> {
    this.calls.push(date);
    return this.result;
  }
}

export class FakeGenerator implements PuzzleGenerator {
  readonly calls: Array<{ date: string; difficulty: string }> = [];
  constructor(public shouldFail = false) {}
  async generateDaily(date: string, difficulty: string) {
    this.calls.push({ date, difficulty });
    if (this.shouldFail) throw new Error("generator boom");
    // Детерминированно по дате, но валидно по формату: берём решение SAMPLE и «прячем» клетки по дате.
    const hide = Number(date.slice(-2)) % 9;
    const mission = SAMPLE.solution.split("").map((c, i) => (i % 9 === hide ? "0" : c)).join("");
    return { mission, solution: SAMPLE.solution };
  }
}

export const silentLogger = pino({ level: "silent" });

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const repos = { dailyPuzzles: new MemoryDailyPuzzleRepo(), devices: new MemoryDeviceRepo(), snapshots: new MemorySnapshotRepo() };
  const dailySource = new FakeSource();
  const generator = new FakeGenerator();
  const deps: AppDeps = {
    repos,
    dailySource,
    generator,
    logger: silentLogger,
    webOrigins: ["http://localhost:5173"],
    now: () => new Date("2026-09-29T12:00:00Z"),
    ...overrides,
  };
  return { app: createApp(deps), repos, dailySource, generator, deps };
}
