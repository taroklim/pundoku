/* In-memory реализации репозиториев и фейки для unit-тестов (без Postgres). */
import pino from "pino";
import type { DailyPuzzle, DailyPuzzleRepo, DailyPuzzleSource, NewDailyPuzzle, PuzzleGenerator, SourceResult } from "../daily/types.js";
import type { DeviceRepo } from "../devices/types.js";
import type { Snapshot, SnapshotRepo, SnapshotWrite, UpsertResult } from "../snapshot/types.js";
import type { GroupInfo, RecoveryRepo, RedeemResult } from "../recovery/types.js";
import { hmacEqual } from "../recovery/key.js";
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
    const row = { ...p, generatorVersion: p.generatorVersion ?? null, fetchedAt: new Date(), replacedAt: null };
    this.rows.set(p.date, row);
    return row;
  }
  async replaceGenerated(p: NewDailyPuzzle): Promise<DailyPuzzle> {
    const existing = this.rows.get(p.date);
    if (!existing) throw new Error(`нет строки за ${p.date}`);
    if (existing.source !== "generator") return existing;
    const row = { ...p, generatorVersion: null, fetchedAt: new Date(), replacedAt: new Date() };
    this.rows.set(p.date, row);
    return row;
  }
  async replaceStale(p: NewDailyPuzzle, currentVersion: number): Promise<DailyPuzzle> {
    const existing = this.rows.get(p.date);
    if (!existing) throw new Error(`нет строки за ${p.date}`);
    if (existing.source !== "generator" || existing.generatorVersion === currentVersion) return existing;
    const row = {
      ...p,
      generatorVersion: p.generatorVersion ?? null,
      fetchedAt: new Date(),
      replacedAt: p.source === "sudoku.com" ? new Date() : existing.replacedAt,
    };
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

interface MemGroup {
  id: string;
  keyHmac: Buffer;
  snapshotDeviceId: string;
  keyCreatedAt: Date;
}

/** In-memory зеркало PgRecoveryRepo (та же семантика redeem/unlink/deleteGroup) для unit-тестов без Postgres. */
export class MemoryRecoveryRepo implements RecoveryRepo {
  readonly groups = new Map<string, MemGroup>();
  readonly links = new Map<string, { groupId: string; seq: number }>();
  /** device_id снапшотов с меткой «сирота» (аналог snapshots.orphaned_at). */
  readonly orphans = new Set<string>();
  private seq = 0;
  constructor(private readonly snapshots: MemorySnapshotRepo) {}

  async snapshotOwnerOf(deviceId: string): Promise<string> {
    const link = this.links.get(deviceId);
    return (link && this.groups.get(link.groupId)?.snapshotDeviceId) || deviceId;
  }
  async find(deviceId: string): Promise<GroupInfo | null> {
    const link = this.links.get(deviceId);
    const group = link && this.groups.get(link.groupId);
    return group ? { devices: this.members(group.id).length, keyCreatedAt: group.keyCreatedAt } : null;
  }
  async createGroup(deviceId: string, keyHmac: Buffer, now: Date): Promise<{ groupId: string } | null> {
    if (this.links.has(deviceId)) return null;
    const group: MemGroup = { id: `90000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`, keyHmac, snapshotDeviceId: deviceId, keyCreatedAt: now };
    this.groups.set(group.id, group);
    this.links.set(deviceId, { groupId: group.id, seq: ++this.seq });
    this.orphans.delete(deviceId);
    return { groupId: group.id };
  }
  async rotateKey(deviceId: string, keyHmac: Buffer, now: Date): Promise<{ groupId: string } | null> {
    const group = this.groupOf(deviceId);
    if (!group) return null;
    group.keyHmac = keyHmac;
    group.keyCreatedAt = now;
    return { groupId: group.id };
  }
  async redeem(deviceId: string, keyHmac: Buffer, _now: Date): Promise<RedeemResult> {
    const group = [...this.groups.values()].find((g) => hmacEqual(g.keyHmac, keyHmac));
    if (!group) return { ok: false };
    const current = this.links.get(deviceId)?.groupId;
    if (current === group.id) return { ok: true, groupId: group.id, devices: this.members(group.id).length, alreadyLinked: true };
    if (current) this.leave(deviceId);
    this.links.set(deviceId, { groupId: group.id, seq: ++this.seq });
    if (this.snapshots.rows.has(deviceId)) this.orphans.add(deviceId);
    return { ok: true, groupId: group.id, devices: this.members(group.id).length, alreadyLinked: false };
  }
  async unlink(deviceId: string): Promise<void> {
    this.leave(deviceId);
  }
  async deleteGroup(deviceId: string): Promise<void> {
    const group = this.groupOf(deviceId);
    if (!group) return;
    const members = this.members(group.id);
    const owner = group.snapshotDeviceId;
    const moved = this.snapshots.rows.get(owner);
    if (owner !== deviceId && moved) {
      this.snapshots.rows.delete(owner);
      this.snapshots.rows.set(deviceId, { ...moved, deviceId });
    }
    for (const m of members) {
      this.links.delete(m);
      this.orphans.delete(m);
    }
    this.groups.delete(group.id);
  }
  private groupOf(deviceId: string): MemGroup | undefined {
    const link = this.links.get(deviceId);
    return link && this.groups.get(link.groupId);
  }
  private members(groupId: string): string[] {
    return [...this.links.entries()].filter(([, l]) => l.groupId === groupId).sort(([, a], [, b]) => a.seq - b.seq).map(([id]) => id);
  }
  private copy(from: string, to: string): void {
    const row = this.snapshots.rows.get(from);
    if (row) this.snapshots.rows.set(to, { ...row, deviceId: to, data: structuredClone(row.data) });
    this.orphans.delete(to);
  }
  private leave(deviceId: string): void {
    const group = this.groupOf(deviceId);
    if (!group) return;
    this.links.delete(deviceId);
    const next = this.members(group.id)[0];
    if (!next) {
      this.groups.delete(group.id);
      this.orphans.delete(deviceId);
      return;
    }
    if (group.snapshotDeviceId === deviceId) {
      this.copy(deviceId, next);
      group.snapshotDeviceId = next;
    } else {
      this.copy(group.snapshotDeviceId, deviceId);
    }
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
  constructor(public shouldFail = false, public engineVersion: number | null = 2) {}
  async version(): Promise<number> {
    if (this.engineVersion === null) throw new Error("no GENERATOR_VERSION");
    return this.engineVersion;
  }
  async generateDaily(date: string, difficulty: string) {
    this.calls.push({ date, difficulty });
    if (this.shouldFail) throw new Error("generator boom");
    // Детерминированно по дате, но валидно по формату: берём решение SAMPLE и «прячем» клетки по дате.
    const hide = Number(date.slice(-2)) % 9;
    const mission = SAMPLE.solution.split("").map((c, i) => (i % 9 === hide ? "0" : c)).join("");
    return { mission, solution: SAMPLE.solution };
  }
}

export const TEST_HMAC_SECRET = Buffer.from("test-only-hmac-secret-0123456789abcdef-0123456789", "utf8");

export const silentLogger = pino({ level: "silent" });

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const snapshots = new MemorySnapshotRepo();
  const repos = { dailyPuzzles: new MemoryDailyPuzzleRepo(), devices: new MemoryDeviceRepo(), snapshots, recovery: new MemoryRecoveryRepo(snapshots) };
  const dailySource = new FakeSource();
  const generator = new FakeGenerator();
  const deps: AppDeps = {
    repos,
    recovery: { hmacSecret: TEST_HMAC_SECRET },
    dailySource,
    generator,
    logger: silentLogger,
    webOrigins: ["http://localhost:5173"],
    now: () => new Date("2026-09-29T12:00:00Z"),
    ...overrides,
  };
  return { app: createApp(deps), repos, dailySource, generator, deps };
}
