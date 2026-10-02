// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryApi, RecoveryResult, RecoveryStatus } from "./api";
import { httpRecoveryApi } from "./api";
import type { RecoverySync } from "./store";
import { COPIED_MS, RecoveryStore } from "./store";

const KEY = "K7QP-M2XZ-9D4T-VB6N-H3RW-8YCJ-5FGA-E0S1";
const COMPACT = KEY.replace(/-/g, "");
const KEY2 = "ZQ8W-4NMD-7T2X-H9RB-C5VK-1JYF-3GPE-6A0S";
const COMPACT2 = KEY2.replace(/-/g, "");
const PENDING = "6f0c1d9e-1b7a-4c52-9f1a-3e5d8b2a7c10";
const EXPIRES = "2026-10-03T10:00:00.000Z";
const CREATED = { hasKey: true, devices: 2, keyCreatedAt: null, pendingRotation: null } as const;

const ok = <T,>(value: T): RecoveryResult<T> => ({ kind: "ok", value });

function setup(over: Partial<{ [K in keyof RecoveryApi]: RecoveryApi[K] }> = {}) {
  const calls: string[] = [];
  const api: RecoveryApi = {
    status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: false })),
    create: vi.fn(async () => ok({ key: KEY, devices: 1 })),
    rotate: vi.fn(async () => ok({ key: KEY2, pendingId: PENDING, expiresAt: EXPIRES })),
    confirmRotation: vi.fn(async () => ok(true as const)),
    cancelRotation: vi.fn(async () => ok(true as const)),
    redeem: vi.fn(async () => ok({ devices: 2 })),
    unlink: vi.fn(async () => ok(true as const)),
    remove: vi.fn(async () => ok(true as const)),
    ...over,
  };
  const sync: RecoverySync & { adoptToken: ReturnType<typeof vi.fn> } = {
    ensureToken: vi.fn(async () => "tok"),
    resetAfterLinkChange: vi.fn(async () => {
      calls.push("reset");
      return true;
    }),
    adoptToken: vi.fn(),
  };
  const writeClipboard = vi.fn(async () => {});
  const store = new RecoveryStore({ api, sync, now: () => Date.parse("2026-09-30T10:00:00Z"), writeClipboard });
  made.push(store);
  return { store, api, sync, calls, writeClipboard };
}
const snap = (s: RecoveryStore) => s.getSnapshot();
const made: RecoveryStore[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  made.splice(0).forEach((st) => st.reset()); // снимает beforeunload-охрану, оставшуюся от тестов с показанным ключом
  vi.useRealTimers();
});

describe("RecoveryStore: состояние блока", () => {
  it("открытие читает статус: нет ключа → none, есть → created с датой и числом устройств", async () => {
    const a = setup();
    a.store.open();
    expect(snap(a.store).phase).toBe("loading");
    await vi.waitFor(() => expect(snap(a.store).phase).toBe("none"));

    const b = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 3, keyCreatedAt: "2026-09-01T00:00:00.000Z", pendingRotation: null })) });
    b.store.open();
    await vi.waitFor(() => expect(snap(b.store).phase).toBe("created"));
    expect(snap(b.store)).toMatchObject({ devices: 3, createdAt: "2026-09-01T00:00:00.000Z" });
  });

  it("статус недоступен: unavailable, «Повторить» перечитывает", async () => {
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValueOnce({ kind: "network" }).mockResolvedValue(ok<RecoveryStatus>({ hasKey: false }));
    const { store } = setup({ status });
    store.open();
    await vi.waitFor(() => expect(snap(store).phase).toBe("unavailable"));
    store.retryStatus();
    expect(snap(store).phase).toBe("loading");
    await vi.waitFor(() => expect(snap(store).phase).toBe("none"));
  });

  it("PD-121d: ввод ключа открывается и из unavailable; «Отмена» возвращает в unavailable и перепроверяет статус", async () => {
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValueOnce({ kind: "network" }).mockResolvedValue({ kind: "network" });
    const { store } = setup({ status });
    store.open();
    await vi.waitFor(() => expect(snap(store).phase).toBe("unavailable"));
    store.startEntry();
    expect(snap(store).phase).toBe("enter");
    store.cancelEntry();
    expect(snap(store).phase).toBe("loading");
    await vi.waitFor(() => expect(snap(store).phase).toBe("unavailable"));
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("создание: ключ показан один раз; «Ключ сохранён» стирает его из памяти", async () => {
    const { store } = setup();
    store.open();
    await vi.waitFor(() => expect(snap(store).phase).toBe("none"));
    await store.create();
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY, devices: 1 });
    store.confirmSaved();
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null });
    expect(JSON.stringify(snap(store))).not.toContain(COMPACT);
  });

  it("копирование: «Скопировано» на 2.2 с, потом возврат; отказ буфера — без обещания", async () => {
    const { store, writeClipboard } = setup();
    await store.create();
    await store.copy();
    expect(writeClipboard).toHaveBeenCalledWith(KEY);
    expect(snap(store).copied).toBe(true);
    await vi.advanceTimersByTimeAsync(COPIED_MS);
    expect(snap(store).copied).toBe(false);

    const bad = setup();
    await bad.store.create();
    (bad.writeClipboard as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("denied"));
    await bad.store.copy();
    expect(snap(bad.store).copied).toBe(false);
  });

  it("ключ уже существует (409): показываем карточку существующего ключа, а не ошибку", async () => {
    const { store } = setup({
      create: vi.fn(async () => ({ kind: "key_exists" }) as const),
      status: vi.fn(async () => ok<RecoveryStatus>({ ...CREATED })),
    });
    await store.create();
    await vi.waitFor(() => expect(snap(store).phase).toBe("created"));
    expect(snap(store).error).toBeNull();
  });

  it("перевыпуск: шит → новый ключ показан как ЗАМЕНА (ожидающая), старый на сервере жив", async () => {
    const { store, api } = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ ...CREATED })) });
    store.open();
    await vi.waitFor(() => expect(snap(store).phase).toBe("created"));
    store.openSheet("reissue");
    expect(snap(store).sheet).toBe("reissue");
    await store.confirmSheet();
    expect(api.rotate).toHaveBeenCalledWith("tok");
    expect(snap(store)).toMatchObject({
      phase: "shown",
      shownKey: KEY2,
      shownMode: "replace",
      pendingId: PENDING,
      pending: { expiresAt: EXPIRES },
      sheet: null,
    });
    expect(api.confirmRotation).not.toHaveBeenCalled(); // само по себе показание ничего не подтверждает
  });
});

describe("RecoveryStore: отложенная замена ключа (PD-126)", () => {
  async function replacing(over: Parameters<typeof setup>[0] = {}) {
    const t = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ ...CREATED })), ...over });
    t.store.open();
    await vi.waitFor(() => expect(snap(t.store).phase).toBe("created"));
    t.store.openSheet("reissue");
    await t.store.confirmSheet();
    expect(snap(t.store).phase).toBe("shown");
    return t;
  }

  it("«Ключ сохранён»: confirm с меткой → ключ стёрт из памяти, pending снят, «Новый ключ действует»", async () => {
    const { store, api } = await replacing();
    const p = store.confirmSaved();
    expect(snap(store).busy).toBe(true);
    await p;
    expect(api.confirmRotation).toHaveBeenCalledWith("tok", PENDING);
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null, pendingId: null, pending: null, replaced: true, busy: false, error: null });
    expect(JSON.stringify(snap(store))).not.toContain(COMPACT2);
    expect(JSON.stringify(snap(store))).not.toContain(PENDING);
  });

  it("ошибка сети/лимит при confirm: ключ остаётся на экране (повторить можно), старый ключ не тронут", async () => {
    const confirmRotation = vi
      .fn<RecoveryApi["confirmRotation"]>()
      .mockResolvedValueOnce({ kind: "network" })
      .mockResolvedValueOnce({ kind: "rate_limited", retryAfterSec: 120 })
      .mockResolvedValue(ok(true as const));
    const { store } = await replacing({ confirmRotation });
    await store.confirmSaved();
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY2, pendingId: PENDING, busy: false, error: { kind: "offline" } });
    await store.confirmSaved();
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY2, error: { kind: "limit", minutes: 2 } });
    await store.confirmSaved();
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null, replaced: true, error: null });
  });

  it("потерянный ответ confirm (F1): сервер переключил ключ, ответа нет → повтор получает 200 already confirmed → успех, не «замена устарела»", async () => {
    // Мини-сервер с настоящей семантикой confirm: первый вызов переключает ключ, но ответ «теряется» (обрыв сети);
    // повтор той же метки — 200 (идемпотентно), любая другая — 409 no_pending. Клиент — настоящий httpRecoveryApi.
    let confirmed: string | null = null;
    let serverCalls = 0;
    let dropNextResponse = true;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/recovery/key/rotate/confirm") {
        serverCalls++;
        const id = (JSON.parse(String(init?.body)) as { pendingId: string }).pendingId;
        const body = confirmed === id ? { confirmed: true, alreadyConfirmed: true } : { confirmed: true };
        const res = confirmed === id || (confirmed === null && id === PENDING) ? json(200, body) : json(409, { error: { code: "no_pending" } });
        if (res.ok) confirmed = id;
        if (dropNextResponse) {
          dropNextResponse = false;
          throw new TypeError("network"); // запрос дошёл и выполнился, ответ потерян
        }
        return res;
      }
      if (path === "/api/recovery") return json(200, { hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: confirmed ? null : { expiresAt: EXPIRES } });
      throw new Error(`unexpected ${path}`);
    });
    const api = httpRecoveryApi({ fetchFn: fetchFn as unknown as typeof fetch, base: "http://api.test" });
    const { store } = await replacing({ confirmRotation: api.confirmRotation, status: api.status });
    await store.confirmSaved();
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY2, error: { kind: "offline" } }); // «нет соединения»
    expect(confirmed).toBe(PENDING); // а на сервере ключ уже переключён
    await store.confirmSaved(); // повтор
    expect(serverCalls).toBe(2);
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null, pendingId: null, replaced: true, error: null });
    expect(JSON.stringify(snap(store))).not.toContain(COMPACT2);
  });

  it("после неопределённой ошибки confirm «Leave» перечитывает статус с сервера (confirm мог пройти), без неё — нет", async () => {
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValue(ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T11:00:00.000Z", pendingRotation: null }));
    const { store } = await replacing({ confirmRotation: vi.fn(async () => ({ kind: "network" }) as const), status });
    status.mockClear();
    await store.confirmSaved();
    store.requestLeave(() => {});
    await store.confirmSheet(); // sheet "leave" → осознанный уход
    await vi.waitFor(() => expect(snap(store)).toMatchObject({ phase: "created", pending: null, createdAt: "2026-09-30T11:00:00.000Z" }));
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("лимит (429) при confirm не считается неопределённым: после «Leave» статус заново не читается", async () => {
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValue(ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: null, pendingRotation: { expiresAt: EXPIRES } }));
    const { store } = await replacing({ confirmRotation: vi.fn(async () => ({ kind: "rate_limited", retryAfterSec: 60 }) as const), status });
    status.mockClear();
    await store.confirmSaved();
    store.requestLeave(() => {});
    await store.confirmSheet();
    await Promise.resolve();
    expect(status).not.toHaveBeenCalled();
  });

  it("замена уже недействительна (отменена/затёрта/истекла): ключ стёрт, объяснение, рабочий ключ не менялся", async () => {
    const { store } = await replacing({ confirmRotation: vi.fn(async () => ({ kind: "stale_rotation" }) as const) });
    await store.confirmSaved();
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null, pendingId: null, replaced: false, error: { kind: "stale" } });
    await vi.waitFor(() => expect(snap(store).pending).toBeNull());
  });

  it("двойной тап по «Ключ сохранён»: один запрос", async () => {
    const { store, api } = await replacing();
    const first = store.confirmSaved();
    void store.confirmSaved();
    await first;
    expect(api.confirmRotation).toHaveBeenCalledTimes(1);
  });

  it("уход без подтверждения: ключ стёрт, pending остаётся (статус «не подтверждён»), метка забыта, confirm не вызывался", async () => {
    const { store, api } = await replacing();
    const go = vi.fn();
    store.requestLeave(go);
    expect(snap(store).sheet).toBe("leave");
    await store.confirmSheet();
    expect(go).toHaveBeenCalledTimes(1);
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null, pendingId: null, pending: { expiresAt: EXPIRES }, replaced: false });
    expect(api.confirmRotation).not.toHaveBeenCalled();
    expect(JSON.stringify(snap(store))).not.toContain(COMPACT2);
  });

  it("после возврата на экран статус pending приходит с сервера; без него (истёк) — снимается", async () => {
    const status = vi
      .fn<RecoveryApi["status"]>()
      .mockResolvedValueOnce(ok<RecoveryStatus>({ ...CREATED, pendingRotation: { expiresAt: EXPIRES } }))
      .mockResolvedValue(ok<RecoveryStatus>({ ...CREATED }));
    const { store } = setup({ status });
    store.open();
    await vi.waitFor(() => expect(snap(store)).toMatchObject({ phase: "created", pending: { expiresAt: EXPIRES } }));
    store.close();
    store.open();
    await vi.waitFor(() => expect(snap(store).pending).toBeNull());
  });

  it("«Начать заново»: тот же шит, rotate затирает прежнюю замену; новый ключ и новая метка", async () => {
    const rotate = vi
      .fn<RecoveryApi["rotate"]>()
      .mockResolvedValueOnce(ok({ key: KEY2, pendingId: PENDING, expiresAt: EXPIRES }))
      .mockResolvedValueOnce(ok({ key: KEY, pendingId: "11111111-2222-4333-8444-555555555555", expiresAt: "2026-10-04T10:00:00.000Z" }));
    const { store } = await replacing({ rotate });
    store.requestLeave(() => {});
    await store.confirmSheet();
    store.openSheet("reissue");
    await store.confirmSheet();
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY, pendingId: "11111111-2222-4333-8444-555555555555", pending: { expiresAt: "2026-10-04T10:00:00.000Z" } });
  });

  it("«Отменить замену»: запрос → pending снят; ошибка сети — pending остаётся и показана ошибка", async () => {
    const status = vi.fn(async () => ok<RecoveryStatus>({ ...CREATED, pendingRotation: { expiresAt: EXPIRES } }));
    const cancelRotation = vi.fn<RecoveryApi["cancelRotation"]>().mockResolvedValueOnce({ kind: "network" }).mockResolvedValue(ok(true as const));
    const { store, api } = setup({ status, cancelRotation });
    store.open();
    await vi.waitFor(() => expect(snap(store).pending).not.toBeNull());
    await store.cancelPending();
    expect(snap(store)).toMatchObject({ pending: { expiresAt: EXPIRES }, error: { kind: "offline" }, busy: false });
    await store.cancelPending();
    expect(api.cancelRotation).toHaveBeenCalledWith("tok");
    expect(snap(store)).toMatchObject({ pending: null, error: null });
  });

  it("отвязка/удаление ключа сбрасывают pending", async () => {
    const status = vi.fn(async () => ok<RecoveryStatus>({ ...CREATED, pendingRotation: { expiresAt: EXPIRES } }));
    const { store } = setup({ status });
    store.open();
    await vi.waitFor(() => expect(snap(store).pending).not.toBeNull());
    store.openSheet("unlink");
    await store.confirmSheet();
    expect(snap(store)).toMatchObject({ phase: "none", pending: null });
  });

  it("beforeunload держит страницу и при замене, пока новый ключ на экране; отпускает после confirm", async () => {
    const { store } = await replacing();
    const held = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    await store.confirmSaved();
    const free = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
  });
});

describe("RecoveryStore: ввод ключа", () => {
  it("живая нормализация; «Восстановить» доступна только при полном ключе", async () => {
    const { store } = setup();
    store.startEntry();
    store.setEntry("k7qp m2xz");
    expect(snap(store).entry).toBe("K7QP-M2XZ");
    await store.submit(); // неполный — запроса нет
    expect(snap(store).busy).toBe(false);
  });

  it("успех: redeem без дефисов → resetAfterLinkChange (а не adoptToken) → «Прогресс восстановлен», ввод стёрт", async () => {
    const { store, api, sync, calls } = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: "2026-09-01T00:00:00.000Z", pendingRotation: null })) });
    store.startEntry();
    store.setEntry(KEY.toLowerCase());
    const p = store.submit();
    expect(snap(store).busy).toBe(true);
    await p;
    expect(api.redeem).toHaveBeenCalledWith("tok", COMPACT);
    expect(sync.resetAfterLinkChange).toHaveBeenCalledTimes(1);
    expect(sync.adoptToken).not.toHaveBeenCalled();
    expect(calls).toEqual(["reset"]);
    expect(snap(store)).toMatchObject({ phase: "created", restored: true, busy: false, entry: "", devices: 2 });
  });

  it("неверный ключ: ошибка снимается правкой поля", async () => {
    const { store } = setup({ redeem: vi.fn(async () => ({ kind: "invalid_key" }) as const) });
    store.startEntry();
    store.setEntry(KEY);
    await store.submit();
    expect(snap(store).error).toEqual({ kind: "invalid" });
    expect(snap(store).entry).toBe(KEY);
    store.setEntry(KEY.slice(0, -1));
    expect(snap(store).error).toBeNull();
  });

  it("лимит 429: минуты округляются вверх, кнопка заблокирована, правка не снимает, время снимает", async () => {
    const { store, api } = setup({ redeem: vi.fn(async () => ({ kind: "rate_limited", retryAfterSec: 541 }) as const) });
    store.startEntry();
    store.setEntry(KEY);
    await store.submit();
    expect(snap(store).error).toEqual({ kind: "limit", minutes: 10 });
    expect(store.blocked).toBe(true);
    store.setEntry(KEY.slice(0, -2));
    store.setEntry(KEY);
    expect(snap(store).error?.kind).toBe("limit");
    await store.submit();
    expect(api.redeem).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(541_000);
    expect(snap(store).error).toBeNull();
    expect(store.blocked).toBe(false);
  });

  it("нет сети: offline, ключ остаётся в поле; повторная отправка проходит", async () => {
    const redeem = vi.fn<RecoveryApi["redeem"]>().mockResolvedValueOnce({ kind: "network" }).mockResolvedValue(ok({ devices: 2 }));
    const { store, sync } = setup({ redeem });
    store.startEntry();
    store.setEntry(KEY);
    await store.submit();
    expect(snap(store).error).toEqual({ kind: "offline" });
    expect(snap(store).entry).toBe(KEY);
    expect(sync.resetAfterLinkChange).not.toHaveBeenCalled();
    await store.submit();
    expect(snap(store)).toMatchObject({ phase: "created", restored: true });
  });

  it("401 (сервер не знает токен): перерегистрация и один повтор", async () => {
    const redeem = vi.fn<RecoveryApi["redeem"]>().mockResolvedValueOnce({ kind: "unauthorized" }).mockResolvedValue(ok({ devices: 2 }));
    const { store, sync } = setup({ redeem });
    (sync.ensureToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    store.startEntry();
    store.setEntry(KEY);
    await store.submit();
    expect(sync.ensureToken).toHaveBeenCalledWith(true);
    expect(redeem).toHaveBeenNthCalledWith(2, "new", COMPACT);
    expect(snap(store).phase).toBe("created");
  });

  it("отмена и закрытие экрана стирают введённый ключ", () => {
    const { store } = setup();
    store.startEntry();
    store.setEntry(KEY);
    store.cancelEntry();
    expect(snap(store)).toMatchObject({ phase: "none", entry: "" });
    store.startEntry();
    store.setEntry(KEY);
    store.close();
    expect(snap(store)).toMatchObject({ phase: "none", entry: "" });
  });
});

describe("RecoveryStore: отвязка и удаление", () => {
  for (const [sheet, method] of [
    ["unlink", "unlink"],
    ["delete", "remove"],
  ] as const) {
    it(`${sheet}: запрос → resetAfterLinkChange (токен не меняется) → «ключа нет»`, async () => {
      const { store, api, sync } = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ ...CREATED })) });
      store.open();
      await vi.waitFor(() => expect(snap(store).phase).toBe("created"));
      store.openSheet(sheet);
      await store.confirmSheet();
      expect(api[method]).toHaveBeenCalledWith("tok");
      expect(sync.resetAfterLinkChange).toHaveBeenCalledTimes(1);
      expect(sync.adoptToken).not.toHaveBeenCalled();
      expect(snap(store)).toMatchObject({ phase: "none", sheet: null, busy: false });
    });
  }

  it("отказ сервера: ничего не сбрасываем, показываем ошибку", async () => {
    const { store, sync } = setup({
      status: vi.fn(async () => ok<RecoveryStatus>({ ...CREATED })),
      unlink: vi.fn(async () => ({ kind: "network" }) as const),
    });
    store.open();
    await vi.waitFor(() => expect(snap(store).phase).toBe("created"));
    store.openSheet("unlink");
    await store.confirmSheet();
    expect(sync.resetAfterLinkChange).not.toHaveBeenCalled();
    expect(snap(store)).toMatchObject({ phase: "created", error: { kind: "offline" } });
  });
});

describe("RecoveryStore: уход с экрана при неподтверждённом ключе", () => {
  it("без показанного ключа уход свободен", () => {
    const { store } = setup();
    const go = vi.fn();
    store.requestLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("пока ключ показан: шит «не сохранён»; «Остаться» — ключ на месте; «Уйти» — ключ стёрт и уход выполнен", async () => {
    const { store } = setup();
    await store.create();
    const go = vi.fn();
    store.requestLeave(go);
    expect(go).not.toHaveBeenCalled();
    expect(snap(store).sheet).toBe("leave");
    store.closeSheet();
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY, sheet: null });
    store.requestLeave(go);
    await store.confirmSheet();
    expect(go).toHaveBeenCalledTimes(1);
    expect(snap(store)).toMatchObject({ phase: "created", shownKey: null });
  });

  it("guardLeave: false и ничего не делает без показанного ключа; true и шит «не сохранён», пока ключ показан (PD-57)", async () => {
    const { store } = setup();
    const go = vi.fn();
    expect(store.guardLeave(go)).toBe(false);
    expect(go).not.toHaveBeenCalled();
    expect(snap(store).sheet).toBeNull();
    await store.create();
    expect(store.guardLeave(go)).toBe(true);
    expect(go).not.toHaveBeenCalled();
    expect(snap(store)).toMatchObject({ sheet: "leave", phase: "shown", shownKey: KEY });
    await store.confirmSheet();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("beforeunload удерживает страницу, пока ключ показан, и отпускает после подтверждения", async () => {
    const { store } = setup();
    await store.create();
    const held = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    store.confirmSaved();
    const free = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
  });
});

describe("ключ не сохраняется в браузере", () => {
  it("ни localStorage, ни sessionStorage не содержат ключ после создания и ввода", async () => {
    const { store } = setup();
    await store.create();
    store.confirmSaved();
    store.startEntry();
    store.setEntry(KEY);
    for (const st of [localStorage, sessionStorage]) {
      expect(JSON.stringify({ ...st })).not.toContain(COMPACT.slice(0, 8));
    }
  });
});
