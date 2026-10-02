// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progressOf } from "./fixtures";
import type { RemoteApplied, SyncDeps } from "./manager";
import { META_SYNC_STATE, META_TOKEN, SyncManager } from "./manager";
import type { DayRecord, SnapshotData } from "./schema";
import { MOVE_LOG_BUDGET_CHARS, SNAPSHOT_SCHEMA_VERSION, buildSnapshotData, dayRecordFromProgress } from "./schema";
import type { PullResult, PushResult, RegisterResult, SyncApi } from "./syncApi";
import { InMemoryProgressRepository } from "../today/repository";
import type { PermanentGridState } from "../today/permanent";

const NOW = new Date("2026-09-29T12:00:00.000Z");

/** Крошечный сервер с семантикой настоящего API: токены, version строго растёт (409), лимит размера (413). */
class FakeServer {
  devices = new Set<string>();
  snaps = new Map<string, { version: number; updatedAt: string; data: unknown }>();
  calls = { register: 0, pull: 0, push: 0 };
  pushed: { token: string; version: number; data: SnapshotData }[] = [];
  down = false;
  maxBytes = Infinity;
  registerError: RegisterResult | null = null;
  private seq = 0;

  api: SyncApi = {
    register: async () => {
      this.calls.register++;
      if (this.down) return { kind: "error", retryAfterMs: null };
      if (this.registerError) return this.registerError;
      const token = `token-${++this.seq}`;
      this.devices.add(token);
      return { kind: "ok", token };
    },
    pull: async (token): Promise<PullResult> => {
      this.calls.pull++;
      if (this.down) return { kind: "error", retryAfterMs: null };
      if (!this.devices.has(token)) return { kind: "unauthorized" };
      const s = this.snaps.get(token);
      return s ? { kind: "ok", snapshot: structuredClone(s) } : { kind: "none" };
    },
    push: async (token, body): Promise<PushResult> => {
      this.calls.push++;
      if (this.down) return { kind: "error", retryAfterMs: null };
      if (!this.devices.has(token)) return { kind: "unauthorized" };
      if (JSON.stringify(body.data).length > this.maxBytes) return { kind: "too_large" };
      const cur = this.snaps.get(token);
      if (cur && body.version <= cur.version) return { kind: "conflict", snapshot: structuredClone(cur) };
      this.snaps.set(token, { version: body.version, updatedAt: body.updatedAt, data: structuredClone(body.data) });
      this.pushed.push({ token, version: body.version, data: structuredClone(body.data) as SnapshotData });
      return { kind: "ok", version: body.version };
    },
  };

  data(token: string): SnapshotData | undefined {
    return this.snaps.get(token)?.data as SnapshotData | undefined;
  }
}

const grid = (n: number): PermanentGridState => ({ installSeed: "inf-test", index: 0, cells: Array.from({ length: n }, (_, i) => ({ cell: i, date: `2026-08-${String(i + 1).padStart(2, "0")}` })) });

let server: FakeServer;
let online: boolean;
const managers: SyncManager[] = [];

function make(storage = new InMemoryProgressRepository(), over: Partial<SyncDeps> = {}) {
  const applied: RemoteApplied[] = [];
  const m = new SyncManager({
    storage,
    api: server.api,
    now: () => NOW,
    isOnline: () => online,
    debounceMs: 100,
    retryBaseMs: 1000,
    retryMaxMs: 8000,
    onRemoteApplied: (i) => applied.push(i),
    ...over,
  });
  managers.push(m);
  return { m, storage, applied };
}

/** Запуск и полный цикл (в т.ч. отправка), без таймеров. */
async function run(m: SyncManager, pull = false) {
  await m.start();
  await m.syncNow(pull);
}

beforeEach(() => {
  server = new FakeServer();
  online = true;
});
afterEach(() => {
  managers.splice(0).forEach((m) => m.dispose());
  vi.useRealTimers();
});

describe("нечитаемые записи хранилища (PD-146)", () => {
  it("undefined среди дней из listDays не роняет сборку локальных данных: цикл завершается, годные дни уходят на сервер", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = new InMemoryProgressRepository();
    await storage.saveDay(progressOf("2026-09-28"));
    const real = storage.listDays.bind(storage);
    storage.listDays = async () => [undefined, undefined, ...(await real())] as never;
    const { m } = make(storage);
    await run(m);
    expect(m.getSnapshot()).toMatchObject({ device: "registered", phase: "idle" });
    expect(Object.keys(server.pushed.at(-1)!.data.days)).toEqual(["2026-09-28"]);
    vi.restoreAllMocks();
  });
});

describe("устройство", () => {
  it("первый запуск без токена: POST /api/devices, токен в хранилище; пустое состояние на сервер не шлётся", async () => {
    const { m, storage } = make();
    await run(m);
    expect(server.calls.register).toBe(1);
    const token = await storage.getMeta(META_TOKEN);
    expect(token).toBe("token-1");
    expect(m.getSnapshot()).toMatchObject({ device: "registered", phase: "idle", unsynced: false });
    expect(server.calls.push).toBe(0);
  });

  it("регистрация не блокирует игру: сервер молчит — whenReady/start возвращаются сразу, состояние отражает повтор", async () => {
    server.api.register = () => new Promise(() => {}); // сервер завис
    const { m } = make();
    const t0 = Date.now();
    await m.start();
    await m.whenReady(1500);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(m.getSnapshot().device).toBe("none");
  });

  it("сервер недоступен: повторы с экспоненциальной паузой, затем регистрация проходит", async () => {
    vi.useFakeTimers();
    server.down = true;
    const { m, storage } = make();
    await m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.register).toBe(1);
    expect(m.getSnapshot().phase).toBe("retrying");
    await vi.advanceTimersByTimeAsync(999);
    expect(server.calls.register).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // 1 с
    expect(server.calls.register).toBe(2);
    await vi.advanceTimersByTimeAsync(2000); // 2 с
    expect(server.calls.register).toBe(3);
    await vi.advanceTimersByTimeAsync(4000); // 4 с
    expect(server.calls.register).toBe(4);
    server.down = false;
    await vi.advanceTimersByTimeAsync(8000); // потолок 8 с
    expect(server.calls.register).toBe(5);
    expect(await storage.getMeta(META_TOKEN)).toBe("token-1");
    expect(m.getSnapshot()).toMatchObject({ device: "registered", phase: "idle" });
  });

  it("429 с Retry-After: пауза не короче, чем просит сервер", async () => {
    vi.useFakeTimers();
    server.registerError = { kind: "error", retryAfterMs: 30_000 };
    const { m } = make();
    await m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.register).toBe(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(server.calls.register).toBe(1);
    server.registerError = null;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.calls.register).toBe(2);
  });

  it("офлайн на старте: запросов нет, ждём событие online и регистрируемся", async () => {
    online = false;
    const { m } = make();
    await m.start();
    await m.syncNow();
    expect(server.calls.register).toBe(0);
    expect(m.getSnapshot().phase).toBe("offline");
    online = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(m.getSnapshot()).toMatchObject({ device: "registered", phase: "idle" }));
    expect(server.calls.register).toBe(1);
  });

  it("токен уже в хранилище: повторной регистрации нет", async () => {
    const storage = new InMemoryProgressRepository();
    await storage.setMeta(META_TOKEN, "token-x");
    server.devices.add("token-x");
    const { m } = make(storage);
    await run(m);
    expect(server.calls.register).toBe(0);
    expect(server.calls.pull).toBe(1);
  });
});

describe("снапшот: отправка", () => {
  it("решённый день + Grid ∞ уходят на сервер: версия 1, schemaVersion, поля Year", async () => {
    const { m, storage } = make();
    await run(m);
    await storage.saveDay(progressOf("2026-09-29", { withFix: true }));
    await storage.savePermanent(grid(3));
    m.notify("solved");
    await m.syncNow();
    const data = server.data("token-1")!;
    expect(server.snaps.get("token-1")!.version).toBe(1);
    expect(server.snaps.get("token-1")!.updatedAt).toBe("2026-09-29T12:00:00.000Z");
    expect(data.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(data.grid!.cells).toHaveLength(3);
    expect(data.days["2026-09-29"]).toMatchObject({
      status: "solved",
      hadCorrections: true,
      assisted: false,
      late: false,
      source: "sudoku.com",
      difficulty: "easy",
    });
    expect(data.days["2026-09-29"]!.moveLog).toBeTypeOf("string");
    expect(m.getSnapshot()).toMatchObject({ unsynced: false, version: 1, lastSyncedAt: "2026-09-29T12:00:00.000Z" });
  });

  it("debounce: подряд идущие решения — один PUT", async () => {
    vi.useFakeTimers();
    const { m, storage } = make();
    await m.start();
    await vi.advanceTimersByTimeAsync(0);
    await storage.saveDay(progressOf("2026-09-28"));
    m.notify("solved");
    await vi.advanceTimersByTimeAsync(60);
    await storage.saveDay(progressOf("2026-09-29"));
    m.notify("solved");
    await vi.advanceTimersByTimeAsync(99);
    expect(server.calls.push).toBe(0);
    expect(m.getSnapshot().unsynced).toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect(server.calls.push).toBe(1);
    expect(Object.keys(server.data("token-1")!.days)).toHaveLength(2);
    expect(m.getSnapshot().unsynced).toBe(false);
  });

  it("идемпотентность: без изменений повторная синхронизация ничего не шлёт", async () => {
    const { m, storage } = make();
    await run(m);
    await storage.saveDay(progressOf("2026-09-29"));
    await m.syncNow();
    expect(server.calls.push).toBe(1);
    await m.syncNow();
    await m.syncNow(true);
    expect(server.calls.push).toBe(1);
  });

  it("начатый (не решённый) день попадает в снапшот как unfinished, без heat/moveLog", async () => {
    const { m, storage } = make();
    await run(m);
    await storage.saveDay(progressOf("2026-09-29", { solved: false, moves: 8 }));
    await m.syncNow();
    const rec = server.data("token-1")!.days["2026-09-29"]!;
    expect(rec).toMatchObject({ status: "unfinished" });
    expect(rec.heat).toBeUndefined();
    expect(rec.moveLog).toBeUndefined();
  });

  it("офлайн-решение: ничего не шлётся, при возврате в сеть синхронизируется", async () => {
    const { m, storage } = make();
    await run(m);
    online = false;
    await storage.saveDay(progressOf("2026-09-29"));
    m.notify("solved");
    await m.syncNow();
    expect(server.calls.push).toBe(0);
    expect(m.getSnapshot()).toMatchObject({ phase: "offline", unsynced: true });
    online = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(server.calls.push).toBe(1));
    await vi.waitFor(() => expect(m.getSnapshot().unsynced).toBe(false));
    expect(server.data("token-1")!.days["2026-09-29"]).toBeDefined();
  });

  it("возврат видимости вкладки: цикл сразу (с GET — если давно не сверялись)", async () => {
    const { m } = make();
    await run(m);
    const pulls = server.calls.pull;
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await m.syncNow();
    expect(server.calls.pull).toBe(pulls); // throttle: только что сверялись
    spy.mockRestore();
  });

  it("уход из приложения с несинхронизированным: отправка без ожидания debounce", async () => {
    const { m, storage } = make(undefined, { debounceMs: 60_000 });
    await run(m);
    await storage.saveDay(progressOf("2026-09-29"));
    m.notify("solved");
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await m.syncNow();
    expect(server.calls.push).toBe(1);
    spy.mockRestore();
  });

  it("сетевая ошибка при отправке: повтор с паузой, данные не теряются", async () => {
    vi.useFakeTimers();
    const { m, storage } = make();
    await m.start();
    await vi.advanceTimersByTimeAsync(0);
    await storage.saveDay(progressOf("2026-09-29"));
    server.down = true;
    m.notify("solved");
    await vi.advanceTimersByTimeAsync(100);
    expect(m.getSnapshot()).toMatchObject({ phase: "retrying", unsynced: true });
    server.down = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.data("token-1")!.days["2026-09-29"]).toBeDefined();
    expect(m.getSnapshot()).toMatchObject({ phase: "idle", unsynced: false });
  });

  it("состояние синхронизации переживает перезапуск: после успеха новый менеджер ничего не шлёт", async () => {
    const storage = new InMemoryProgressRepository();
    const a = make(storage);
    await run(a.m);
    await storage.saveDay(progressOf("2026-09-29"));
    await a.m.syncNow();
    expect(await storage.getMeta(META_SYNC_STATE)).toMatchObject({ version: 1 });
    a.m.dispose();
    const pushes = server.calls.push;
    const b = make(storage);
    await run(b.m);
    expect(server.calls.push).toBe(pushes);
    expect(b.m.getSnapshot().version).toBe(1);
  });
});

describe("снапшот: восстановление", () => {
  async function seedServer() {
    const a = make();
    await run(a.m);
    await a.storage.saveDay(progressOf("2026-09-28", { withFix: true }));
    await a.storage.saveDay(progressOf("2026-09-29"));
    await a.storage.savePermanent(grid(4));
    await a.m.syncNow();
    a.m.dispose();
    return a.storage;
  }

  it("чистка IndexedDB кроме токена: решённые дни и Grid ∞ возвращаются с сервера", async () => {
    const old = await seedServer();
    const token = await old.getMeta(META_TOKEN);
    const wiped = new InMemoryProgressRepository();
    await wiped.setMeta(META_TOKEN, token);
    const { m, applied } = make(wiped);
    await m.start(); // whenReady = первичная сверка
    const days = await wiped.listDays();
    expect(days.map((d) => d.date).sort()).toEqual(["2026-09-28", "2026-09-29"]);
    expect(days.every((d) => d.solved && d.play.solved)).toBe(true);
    expect((await wiped.getPermanent())!.cells).toHaveLength(4);
    expect((await wiped.getPermanent())!.installSeed).toBe("inf-test");
    expect(applied).toEqual([{ dates: ["2026-09-28", "2026-09-29"], gridChanged: true }]);
    await m.syncNow();
    expect(server.calls.push).toBe(1); // восстановление не порождает лишний PUT
  });

  it("восстановленный день даёт ту же карточку, что и оригинал (лог из moveLog)", async () => {
    const old = await seedServer();
    const original = (await old.getDay("2026-09-28"))!;
    const wiped = new InMemoryProgressRepository();
    await wiped.setMeta(META_TOKEN, await old.getMeta(META_TOKEN));
    await run(make(wiped).m);
    const back = (await wiped.getDay("2026-09-28"))!;
    expect(back.play.log).toEqual(original.play.log);
    expect(back.solvedAt).toBe(original.solvedAt);
  });

  it("чистка всего IndexedDB (токен тоже): новое устройство, старые данные недоступны (ожидаемо до PD-27)", async () => {
    const old = await seedServer();
    const oldToken = (await old.getMeta(META_TOKEN)) as string;
    const { m, storage } = make(new InMemoryProgressRepository());
    await run(m);
    const newToken = (await storage.getMeta(META_TOKEN)) as string;
    expect(newToken).not.toBe(oldToken);
    expect(await storage.listDays()).toEqual([]);
    expect(server.snaps.has(newToken)).toBe(false);
    // старый снапшот на сервере жив, но без токена до него не добраться
    expect(server.snaps.has(oldToken)).toBe(true);
  });

  it("сервер не знает токен (401, например БД сервера пересоздана): новое устройство, локальные данные уходят целиком", async () => {
    const storage = new InMemoryProgressRepository();
    await storage.setMeta(META_TOKEN, "ghost");
    await storage.saveDay(progressOf("2026-09-29"));
    const { m } = make(storage);
    await run(m);
    expect(server.calls.register).toBe(1);
    expect(await storage.getMeta(META_TOKEN)).toBe("token-1");
    expect(server.data("token-1")!.days["2026-09-29"]).toBeDefined();
  });

  it("сервер отвечает 401 даже на свежий токен — без бесконечного цикла, только повтор по таймеру", async () => {
    vi.useFakeTimers();
    server.api.pull = async () => ({ kind: "unauthorized" });
    const { m } = make();
    await m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.register).toBeLessThanOrEqual(2);
    expect(m.getSnapshot().phase).toBe("retrying");
  });
});

describe("политика 409: два устройства с одним токеном", () => {
  async function pair() {
    const a = make();
    await run(a.m);
    const token = (await a.storage.getMeta(META_TOKEN)) as string;
    const bStorage = new InMemoryProgressRepository();
    await bStorage.setMeta(META_TOKEN, token);
    const b = make(bStorage);
    await run(b.m);
    return { a, b, token };
  }

  it("реальный 409: у B устаревшая версия; слияние по дням, затем PUT слитого", async () => {
    const { a, b, token } = await pair();
    // A решает 28-е и отправляет (версия 1)
    await a.storage.saveDay(progressOf("2026-09-28"));
    await a.m.syncNow();
    // B о версии 1 не знает (GET не делал) и решает 29-е → PUT версии 1 → 409
    await b.storage.saveDay(progressOf("2026-09-29"));
    b.m.notify("solved");
    await b.m.syncNow();
    expect(server.snaps.get(token)!.version).toBe(2);
    expect(Object.keys(server.data(token)!.days).sort()).toEqual(["2026-09-28", "2026-09-29"]);
    // B получил чужой день локально
    expect((await b.storage.getDay("2026-09-28"))!.solved).toBe(true);
    expect(b.applied.at(-1)!.dates).toEqual(["2026-09-28"]);
    // A при следующем GET получает 29-е
    await a.m.syncNow(true);
    expect((await a.storage.getDay("2026-09-29"))!.solved).toBe(true);
    expect(server.snaps.get(token)!.version).toBe(2); // ничего лишнего не шлётся
  });

  it("конфликт по одному дню: «решено» над «не решено»", async () => {
    const { a, b, token } = await pair();
    await a.storage.saveDay(progressOf("2026-09-29", { solved: false, moves: 10 }));
    await a.m.syncNow();
    await b.storage.saveDay(progressOf("2026-09-29"));
    b.m.notify("solved");
    await b.m.syncNow();
    expect(server.data(token)!.days["2026-09-29"]!.status).toBe("solved");
    await a.m.syncNow(true);
    expect((await a.storage.getDay("2026-09-29"))!.solved).toBe(true); // незавершённая партия A заменена решённой
  });

  it("оба решили один день: остаётся более раннее решение", async () => {
    const { a, b, token } = await pair();
    await a.storage.saveDay(progressOf("2026-09-29", { solvedAt: "2026-09-29T20:00:00.000Z" }));
    await a.m.syncNow();
    await b.storage.saveDay(progressOf("2026-09-29", { solvedAt: "2026-09-29T08:00:00.000Z" }));
    b.m.notify("solved");
    await b.m.syncNow();
    expect(server.data(token)!.days["2026-09-29"]!.solvedAt).toBe("2026-09-29T08:00:00.000Z");
    await a.m.syncNow(true);
    expect((await a.storage.getDay("2026-09-29"))!.solvedAt).toBe("2026-09-29T08:00:00.000Z");
  });

  it("сетка Sudoku.com побеждает клиентский фолбэк независимо от solvedAt; winRate/moveLog/heat не теряются", async () => {
    const { a, b, token } = await pair();
    // A: фолбэк на устройстве, решён РАНЬШЕ
    await a.storage.saveDay(progressOf("2026-09-29", { source: "client", solvedAt: "2026-09-29T08:00:00.000Z" }));
    await a.m.syncNow();
    expect(server.data(token)!.days["2026-09-29"]!.source).toBe("device");
    // B: настоящая сетка Sudoku.com, решён позже → на 409 побеждает B
    await b.storage.saveDay(progressOf("2026-09-29", { source: "sudoku.com", solvedAt: "2026-09-29T20:00:00.000Z" }));
    b.m.notify("solved");
    await b.m.syncNow();
    const rec = server.data(token)!.days["2026-09-29"]!;
    expect(rec).toMatchObject({ source: "sudoku.com", solvedAt: "2026-09-29T20:00:00.000Z" });
    expect(rec.moveLog).toBeDefined();
    expect(rec.heat).toBeDefined();
    // A при следующем GET получает настоящую сетку (с winRate) вместо своего фолбэка
    await a.m.syncNow(true);
    const mine = (await a.storage.getDay("2026-09-29"))!;
    expect(mine.source).toBe("sudoku.com");
    expect(mine.solvedAt).toBe("2026-09-29T20:00:00.000Z");
  });

  it("обратный порядок отправки (device приходит вторым и раньше по solvedAt) — сервер остаётся при sudoku.com", async () => {
    const { a, b, token } = await pair();
    await a.storage.saveDay(progressOf("2026-09-29", { source: "sudoku.com", solvedAt: "2026-09-29T20:00:00.000Z" }));
    await a.m.syncNow();
    await b.storage.saveDay(progressOf("2026-09-29", { source: "client", solvedAt: "2026-09-29T08:00:00.000Z" }));
    b.m.notify("solved");
    await b.m.syncNow();
    expect(server.data(token)!.days["2026-09-29"]).toMatchObject({ source: "sudoku.com", solvedAt: "2026-09-29T20:00:00.000Z" });
    expect((await b.storage.getDay("2026-09-29"))!.source).toBe("sudoku.com");
    const v = server.snaps.get(token)!.version;
    await a.m.syncNow(true);
    await b.m.syncNow(true);
    expect(server.snaps.get(token)!.version).toBe(v); // сошлись, лишних отправок нет
  });

  it("Grid ∞: installSeed берётся с сервера (он новее), улёты объединяются, один улёт на дату", async () => {
    const { a, b, token } = await pair();
    await a.storage.savePermanent({ installSeed: "seed-A", index: 0, cells: [{ cell: 10, date: "2026-09-01" }, { cell: 11, date: "2026-09-02" }] });
    await a.m.syncNow();
    await b.storage.savePermanent({ installSeed: "seed-B", index: 0, cells: [{ cell: 11, date: "2026-09-02" }, { cell: 12, date: "2026-09-03" }] });
    b.m.notify("solved");
    await b.m.syncNow();
    const g = server.data(token)!.grid!;
    expect(g.installSeed).toBe("seed-A");
    expect(g.cells.map((c) => c.date).sort()).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect((await b.storage.getPermanent())!.installSeed).toBe("seed-A");
    expect(b.applied.at(-1)!.gridChanged).toBe(true);
    // повторный обмен — no-op
    const v = server.snaps.get(token)!.version;
    await a.m.syncNow(true);
    await b.m.syncNow(true);
    expect(server.snaps.get(token)!.version).toBe(v);
  });

  it("409 без тела снапшота: клиент сам делает GET и сливает", async () => {
    const { a, b, token } = await pair();
    await a.storage.saveDay(progressOf("2026-09-28"));
    await a.m.syncNow();
    const push = server.api.push;
    server.api.push = async (t, body) => {
      const r = await push(t, body);
      return r.kind === "conflict" ? { kind: "conflict", snapshot: null } : r;
    };
    await b.storage.saveDay(progressOf("2026-09-29"));
    b.m.notify("solved");
    await b.m.syncNow();
    expect(Object.keys(server.data(token)!.days)).toHaveLength(2);
  });
});

describe("413 и версии схемы", () => {
  it("413: ступени сжатия — сначала moveLog только последних 7 дней, затем без moveLog; heat и сводка остаются", async () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-09-${String(10 + i).padStart(2, "0")}`);
    const days: Record<string, DayRecord> = {};
    for (const d of dates) days[d] = dayRecordFromProgress(progressOf(d), NOW)!;
    const size = (budget: number, last: number) => JSON.stringify(buildSnapshotData({ grid: null, days }, budget, last)).length;
    const full = size(MOVE_LOG_BUDGET_CHARS, 7);
    const last7 = size(0, 7);
    const none = size(0, 0);
    expect(none).toBeLessThan(last7);
    expect(last7).toBeLessThan(full);

    const seed = async (maxBytes: number) => {
      server = new FakeServer();
      server.devices.add("t");
      server.maxBytes = maxBytes;
      const storage = new InMemoryProgressRepository();
      await storage.setMeta(META_TOKEN, "t");
      for (const d of dates) await storage.saveDay(progressOf(d));
      const mm = make(storage).m;
      await run(mm);
      return server.data("t")!;
    };

    // Лимит между «последние 7» и «полный» → шаг 2 (бюджет 0, последние 7 дней с moveLog).
    const mid = await seed(last7 + 1);
    expect(server.calls.push).toBe(2);
    expect(Object.values(mid.days).filter((r) => r.moveLog).length).toBe(7);
    expect(mid.days[dates[19]!]!.moveLog).toBeDefined();
    expect(mid.days[dates[0]!]!.moveLog).toBeUndefined();

    // Лимит между «без moveLog» и «последние 7» → шаг 3.
    const low = await seed(none + 1);
    expect(server.calls.push).toBe(3);
    expect(Object.keys(low.days)).toHaveLength(20);
    expect(Object.values(low.days).every((r) => r.heat && r.status === "solved" && r.technique !== undefined)).toBe(true);
    expect(Object.values(low.days).some((r) => r.moveLog)).toBe(false);
    expect(JSON.stringify(low).length).toBeLessThanOrEqual(none + 1);
  });

  it("≥1500 дней, ступень сжатия сохранена: перезапуск не шлёт лишних PUT, version не растёт", async () => {
    const base = progressOf("2026-09-29");
    const dateOf = (i: number) => new Date(Date.UTC(2022, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const dates = Array.from({ length: 1500 }, (_, i) => dateOf(i));
    const days: Record<string, DayRecord> = {};
    const seedStorage = async (storage: InMemoryProgressRepository) => {
      for (const d of dates) await storage.saveDay({ ...base, date: d, solvedAt: `${d}T10:00:00.000Z` });
    };
    for (const d of dates) days[d] = dayRecordFromProgress({ ...base, date: d, solvedAt: `${d}T10:00:00.000Z` }, NOW)!;
    const size = (budget: number, last: number) => JSON.stringify(buildSnapshotData({ grid: null, days }, budget, last)).length;
    const none = size(0, 0);
    expect(none).toBeLessThan(size(0, 7)); // лимит режет и ступень 1, и ступень 0

    server.devices.add("t");
    server.maxBytes = none + 1;
    const storage = new InMemoryProgressRepository();
    await storage.setMeta(META_TOKEN, "t");
    await seedStorage(storage);
    const first = make(storage).m;
    await run(first);
    expect(server.calls.push).toBe(3); // 413 (полный) → 413 (7 дней) → 200 (без moveLog)
    expect(server.snaps.get("t")!.version).toBe(1);
    expect(await storage.getMeta(META_SYNC_STATE)).toMatchObject({ version: 1, compressStep: 2 });
    first.dispose();

    // «Перезапуск приложения»: новый менеджер поверх того же хранилища
    const pushes = server.calls.push;
    const second = make(storage).m;
    await run(second);
    await second.syncNow(true);
    expect(server.calls.push).toBe(pushes);
    expect(server.snaps.get("t")!.version).toBe(1);
    expect(second.getSnapshot()).toMatchObject({ phase: "idle", unsynced: false, version: 1 });

    // Новый решённый день после перезапуска уходит сразу на сохранённой ступени: один PUT, version + 1
    server.maxBytes = none + 2000; // место под ещё один день без moveLog, но не под логи
    await storage.saveDay({ ...base, date: dateOf(1500), solvedAt: `${dateOf(1500)}T10:00:00.000Z` });
    second.notify("solved");
    await second.syncNow();
    expect(server.calls.push).toBe(pushes + 1);
    expect(server.snaps.get("t")!.version).toBe(2);
    expect(Object.values(server.data("t")!.days).some((r) => r.moveLog)).toBe(false);
  }, 60_000);

  it("413 даже без moveLog: состояние blocked/too_large, игра не затронута", async () => {
    server.maxBytes = 10;
    const { m, storage } = make();
    await run(m);
    await storage.saveDay(progressOf("2026-09-29"));
    await m.syncNow();
    expect(m.getSnapshot()).toMatchObject({ phase: "blocked", error: "too_large" });
    expect((await storage.getDay("2026-09-29"))!.solved).toBe(true);
  });

  it("снапшот с более новой схемой: не читаем и не перезаписываем", async () => {
    const storage = new InMemoryProgressRepository();
    await storage.setMeta(META_TOKEN, "token-z");
    server.devices.add("token-z");
    server.snaps.set("token-z", { version: 7, updatedAt: "2026-09-29T00:00:00.000Z", data: { schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1, days: {} } });
    await storage.saveDay(progressOf("2026-09-29"));
    const { m } = make(storage);
    await run(m);
    expect(m.getSnapshot()).toMatchObject({ phase: "blocked", error: "newer_schema" });
    expect(server.calls.push).toBe(0);
    expect(server.snaps.get("token-z")!.version).toBe(7);
  });

  it("старая схема на сервере (0) мигрируется и перезаписывается текущей", async () => {
    const storage = new InMemoryProgressRepository();
    await storage.setMeta(META_TOKEN, "token-z");
    server.devices.add("token-z");
    server.snaps.set("token-z", { version: 3, updatedAt: "2026-09-29T00:00:00.000Z", data: { grid: {}, year: {} } });
    await storage.saveDay(progressOf("2026-09-29"));
    const { m } = make(storage);
    await run(m);
    expect(server.snaps.get("token-z")!.version).toBe(4);
    expect(server.data("token-z")!.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(server.data("token-z")!.days["2026-09-29"]).toBeDefined();
  });
});
