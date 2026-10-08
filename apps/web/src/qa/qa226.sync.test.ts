// @vitest-environment jsdom
/**
 * QA PD-226 (независимая проверка PD-225 §A6): удалённая с хаба партия не воскресает после синка (pull + onRemoteApplied),
 * слоты `playGame:*` не уходят на сервер — даже если на сервере лежит мусор с такими ключами; «Отменить» синк не затирает.
 */
import { afterEach, describe, expect, it } from "vitest";
import { progressOf } from "../sync/fixtures";
import type { RemoteApplied } from "../sync/manager";
import { META_TOKEN, SyncManager } from "../sync/manager";
import type { PullResult, PushResult, SyncApi } from "../sync/syncApi";
import { InMemoryProgressRepository } from "../today/repository";
import { PlayStore, slotKey } from "../play/store";

const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const PUZZLE = { mission: MISSION, solution: SOLUTION, difficulty: "easy" as const, seed: "qa" };
const NOW = new Date("2026-09-29T12:00:00.000Z");

class Server {
  snaps = new Map<string, { version: number; updatedAt: string; data: unknown }>();
  bodies: string[] = [];
  private seq = 0;
  api: SyncApi = {
    register: async () => ({ kind: "ok", token: `t-${++this.seq}` }),
    pull: async (token): Promise<PullResult> => {
      const s = this.snaps.get(token);
      return s ? { kind: "ok", snapshot: structuredClone(s) } : { kind: "none" };
    },
    push: async (token, body): Promise<PushResult> => {
      this.bodies.push(JSON.stringify(body));
      const cur = this.snaps.get(token);
      if (cur && body.version <= cur.version) return { kind: "conflict", snapshot: structuredClone(cur) };
      this.snaps.set(token, { version: body.version, updatedAt: body.updatedAt, data: structuredClone(body.data) });
      return { kind: "ok", version: body.version };
    },
  };
}

interface Inner {
  requestId: number;
  onGenerated(id: number, r: unknown): void;
}
function begin(s: PlayStore, mode: "classic" | "ink"): void {
  s.startNew(mode, "medium");
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: PUZZLE });
  s.select(2);
  s.input(4);
}

const managers: SyncManager[] = [];
afterEach(() => managers.splice(0).forEach((m) => m.dispose()));
const mk = (server: Server, storage: InMemoryProgressRepository, applied: RemoteApplied[] = []) => {
  const m = new SyncManager({ storage, api: server.api, now: () => NOW, isOnline: () => true, debounceMs: 50, retryBaseMs: 1000, retryMaxMs: 8000, onRemoteApplied: (i) => applied.push(i) });
  managers.push(m);
  return m;
};

async function setup() {
  const server = new Server();
  // Другое устройство того же аккаунта кладёт на сервер решённые дни → у нас сработает onRemoteApplied.
  const other = new InMemoryProgressRepository();
  await other.saveDay(progressOf("2026-09-27"));
  await other.saveDay(progressOf("2026-09-28"));
  const a = mk(server, other);
  await a.start();
  await a.syncNow();
  a.dispose();
  const token = (await other.getMeta(META_TOKEN)) as string;
  // Наше устройство: две незаконченные свободные партии.
  const repo = new InMemoryProgressRepository();
  await repo.setMeta(META_TOKEN, token);
  const s = new PlayStore({ storage: repo });
  await s.restore();
  begin(s, "classic");
  s.toHub();
  begin(s, "ink");
  s.toHub(); // Чернила — живая запаркованная партия
  await s.flushed();
  return { server, token, repo, s };
}

describe("QA PD-226: синк и удаление слота", () => {
  it("удалённая (обычная и запаркованная) партия не воскресает после pull + onRemoteApplied; в PUT нет playGame", async () => {
    const { server, token, repo, s } = await setup();
    // Мусор на сервере: ключи слотов в снапшоте (как если бы старая/чужая версия их туда положила).
    const snap = server.snaps.get(token)!;
    const slotJunk = await repo.getMeta(slotKey("classic"));
    (snap.data as Record<string, unknown>)["playGame:classic"] = slotJunk;
    (snap.data as Record<string, unknown>)["slots"] = { classic: slotJunk };

    expect(s.discard("classic")).not.toBeNull();
    expect(s.discard("ink")).not.toBeNull();
    await s.flushed();
    expect(await repo.getMeta(slotKey("classic"))).toBeNull();
    expect(await repo.getMeta(slotKey("ink"))).toBeNull();

    const applied: RemoteApplied[] = [];
    const b = mk(server, repo, applied);
    await b.start();
    await b.syncNow(true);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0]!.dates.sort()).toEqual(["2026-09-27", "2026-09-28"]);
    expect(await repo.getMeta(slotKey("classic"))).toBeNull();
    expect(await repo.getMeta(slotKey("ink"))).toBeNull();
    expect(s.slots().classic).toBeUndefined();
    expect(s.slots().ink).toBeUndefined();
    // Перезапуск приложения поверх того же хранилища — слотов нет.
    const fresh = new PlayStore({ storage: repo });
    await fresh.restore();
    expect(Object.keys(fresh.slots())).toEqual([]);
    // Ни один PUT не содержит слотов.
    for (const body of server.bodies) {
      expect(body).not.toContain("playGame");
      expect(body).not.toContain(MISSION);
    }
  });

  it("«Отменить» после синка: слот байт в байт, повторный синк его не трогает и не отправляет", async () => {
    const { server, repo, s } = await setup();
    const before = JSON.stringify(await repo.getMeta(slotKey("classic")));
    const rec = s.discard("classic")!;
    await s.flushed();
    const b = mk(server, repo);
    await b.start();
    await b.syncNow(true);
    expect(s.restoreSlot(rec)).toBe(true);
    await s.flushed();
    expect(JSON.stringify(await repo.getMeta(slotKey("classic")))).toBe(before);
    await b.syncNow(true);
    expect(JSON.stringify(await repo.getMeta(slotKey("classic")))).toBe(before);
    const fresh = new PlayStore({ storage: repo });
    await fresh.restore();
    expect(fresh.slots().classic).toBeDefined();
    for (const body of server.bodies) expect(body).not.toContain("playGame");
  });
});
