// @vitest-environment jsdom
/**
 * PD-49: `SyncManager.resetAfterLinkChange()` — что происходит на устройстве после redeem / unlink / удаления ключа.
 * Токен устройства не меняется; меняется лишь то, ЧЕЙ снапшот отдаёт сервер этому токену (снапшот группы).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { progressOf } from "./fixtures";
import type { RemoteApplied } from "./manager";
import { META_SYNC_STATE, META_TOKEN, SyncManager } from "./manager";
import type { SnapshotData } from "./schema";
import type { PullResult, PushResult, SyncApi } from "./syncApi";
import { InMemoryProgressRepository } from "../today/repository";

const NOW = new Date("2026-09-30T12:00:00.000Z");

/** Сервер с семантикой групп PD-47: токен → «владелец снапшота»; связь меняет только владельца, токены остаются. */
class GroupServer {
  owner = new Map<string, string>();
  snaps = new Map<string, { version: number; updatedAt: string; data: unknown }>();
  down = false;
  pulls = 0;

  register(token: string): void {
    this.owner.set(token, token);
  }
  link(token: string, groupOwner: string): void {
    this.owner.set(token, groupOwner);
  }
  /** unlink: устройство получает КОПИЮ снапшота группы как собственный. */
  unlink(token: string): void {
    const cur = this.snaps.get(this.owner.get(token)!);
    this.owner.set(token, token);
    if (cur) this.snaps.set(token, structuredClone(cur));
  }
  data(token: string): SnapshotData | undefined {
    return this.snaps.get(this.owner.get(token)!)?.data as SnapshotData | undefined;
  }

  api: SyncApi = {
    register: async () => ({ kind: "error", retryAfterMs: null }),
    pull: async (token): Promise<PullResult> => {
      this.pulls++;
      if (this.down) return { kind: "error", retryAfterMs: null };
      const o = this.owner.get(token);
      if (!o) return { kind: "unauthorized" };
      const s = this.snaps.get(o);
      return s ? { kind: "ok", snapshot: structuredClone(s) } : { kind: "none" };
    },
    push: async (token, body): Promise<PushResult> => {
      if (this.down) return { kind: "error", retryAfterMs: null };
      const o = this.owner.get(token);
      if (!o) return { kind: "unauthorized" };
      const cur = this.snaps.get(o);
      if (cur && body.version <= cur.version) return { kind: "conflict", snapshot: structuredClone(cur) };
      this.snaps.set(o, { version: body.version, updatedAt: body.updatedAt, data: structuredClone(body.data) });
      return { kind: "ok", version: body.version };
    },
  };
}

let server: GroupServer;
const managers: SyncManager[] = [];

async function device(token: string, days: string[] = []) {
  const storage = new InMemoryProgressRepository();
  await storage.setMeta(META_TOKEN, token);
  server.register(token);
  for (const d of days) await storage.saveDay(progressOf(d));
  const applied: RemoteApplied[] = [];
  const m = new SyncManager({
    storage,
    api: server.api,
    now: () => NOW,
    isOnline: () => true,
    debounceMs: 100,
    retryBaseMs: 1000,
    retryMaxMs: 8000,
    onRemoteApplied: (i) => applied.push(i),
  });
  managers.push(m);
  await m.start();
  await m.syncNow(true);
  return { m, storage, applied, token };
}
const dates = async (s: InMemoryProgressRepository) => (await s.listDays()).map((d) => d.date).sort();

beforeEach(() => {
  server = new GroupServer();
});
afterEach(() => managers.splice(0).forEach((m) => m.dispose()));

describe("resetAfterLinkChange", () => {
  it("redeem: локальные дни новой точки не теряются, дни группы приходят, слияние уходит на сервер, токен прежний", async () => {
    const a = await device("token-A", ["2026-09-01", "2026-09-02"]);
    expect(Object.keys(server.data("token-A")!.days).sort()).toEqual(["2026-09-01", "2026-09-02"]);

    const b = await device("token-B", ["2026-09-10"]); // у B свой снапшот и свой день
    b.applied.length = 0;

    server.link("token-B", "token-A"); // сервер выполнил redeem: B теперь читает снапшот группы (A)
    const ok = await b.m.resetAfterLinkChange();

    expect(ok).toBe(true);
    expect(await dates(b.storage)).toEqual(["2026-09-01", "2026-09-02", "2026-09-10"]);
    expect(Object.keys(server.data("token-B")!.days).sort()).toEqual(["2026-09-01", "2026-09-02", "2026-09-10"]);
    expect(await b.storage.getMeta(META_TOKEN)).toBe("token-B"); // токен устройства не менялся
    // Открытые экраны узнают о пришедших днях.
    expect(b.applied.flatMap((i) => i.dates).sort()).toEqual(["2026-09-01", "2026-09-02"]);
    expect(b.m.getSnapshot()).toMatchObject({ phase: "idle", unsynced: false });
    // A при следующей синхронизации видит день B.
    await a.m.syncNow(true);
    expect(await dates(a.storage)).toEqual(["2026-09-01", "2026-09-02", "2026-09-10"]);
  });

  it("сбрасывает META_SYNC_STATE и запоминает новый снапшот после слияния (а не старое серверное состояние)", async () => {
    const b = await device("token-B", ["2026-09-10"]);
    const before = await b.storage.getMeta(META_SYNC_STATE);
    expect(before).toBeTruthy();
    server.link("token-B", "token-A");
    server.register("token-A");
    server.snaps.set("token-A", { version: 7, updatedAt: "2026-09-29T00:00:00.000Z", data: { schemaVersion: 1, grid: null, days: {} } });
    await b.m.resetAfterLinkChange();
    const after = (await b.storage.getMeta(META_SYNC_STATE)) as { version?: number } | null;
    expect(after).toBeTruthy();
    expect(after).not.toEqual(before);
    expect(b.m.getSnapshot().version).toBeGreaterThanOrEqual(8); // push поверх версии группы, а не по старой версии 1
  });

  it("очищает сохранённый META_SYNC_STATE, даже если новый цикл не дошёл до сервера (старое состояние не переживёт перезапуск)", async () => {
    const b = await device("token-B", ["2026-09-10"]);
    expect(await b.storage.getMeta(META_SYNC_STATE)).toBeTruthy(); // после первой синхронизации состояние сохранено
    server.down = true; // цикл после сброса ничего не запишет — виден только сам сброс
    expect(await b.m.resetAfterLinkChange()).toBe(false);
    expect(await b.storage.getMeta(META_SYNC_STATE)).toBeNull();
  });

  it("unlink: устройство остаётся с локальными днями и получает копию снапшота группы на своё имя", async () => {
    const a = await device("token-A", ["2026-09-01"]);
    const b = await device("token-B", ["2026-09-10"]);
    server.link("token-B", "token-A");
    await b.m.resetAfterLinkChange();
    await a.m.syncNow(true);

    server.unlink("token-B");
    const ok = await b.m.resetAfterLinkChange();
    expect(ok).toBe(true);
    expect(await dates(b.storage)).toEqual(["2026-09-01", "2026-09-10"]);
    expect(Object.keys(server.data("token-B")!.days).sort()).toEqual(["2026-09-01", "2026-09-10"]);
    // Дальше устройства расходятся: день, решённый на B, до A не доходит.
    await b.storage.saveDay(progressOf("2026-09-20"));
    b.m.notify("solved");
    await b.m.syncNow();
    await a.m.syncNow(true);
    expect(await dates(a.storage)).toEqual(["2026-09-01", "2026-09-10"]);
  });

  it("снимает блокировку, выставленную старым снапшотом, и возвращает false без сети (данные целы, цикл повторится)", async () => {
    const b = await device("token-B", ["2026-09-10"]);
    server.down = true;
    const ok = await b.m.resetAfterLinkChange();
    expect(ok).toBe(false);
    expect(await dates(b.storage)).toEqual(["2026-09-10"]);
    expect(b.m.getSnapshot().phase).not.toBe("blocked");
  });

  it("не затирается идущим циклом: ждёт его окончания", async () => {
    const b = await device("token-B", ["2026-09-10"]);
    server.link("token-B", "token-B");
    const running = b.m.syncNow(true);
    const reset = b.m.resetAfterLinkChange();
    await Promise.all([running, reset]);
    expect(b.m.getSnapshot().phase).toBe("idle");
  });
});

describe("ensureToken", () => {
  it("возвращает токен из хранилища без запросов; при revalidate делает цикл", async () => {
    const b = await device("token-B");
    const pulls = server.pulls;
    expect(await b.m.ensureToken()).toBe("token-B");
    expect(server.pulls).toBe(pulls);
    expect(await b.m.ensureToken(true)).toBe("token-B");
    expect(server.pulls).toBeGreaterThan(pulls);
  });
});
