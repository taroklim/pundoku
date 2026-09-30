// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryApi, RecoveryResult, RecoveryStatus } from "./api";
import type { RecoverySync } from "./store";
import { COPIED_MS, RecoveryStore } from "./store";

const KEY = "K7QP-M2XZ-9D4T-VB6N-H3RW-8YCJ-5FGA-E0S1";
const COMPACT = KEY.replace(/-/g, "");

const ok = <T,>(value: T): RecoveryResult<T> => ({ kind: "ok", value });

function setup(over: Partial<{ [K in keyof RecoveryApi]: RecoveryApi[K] }> = {}) {
  const calls: string[] = [];
  const api: RecoveryApi = {
    status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: false })),
    create: vi.fn(async () => ok({ key: KEY, devices: 1 })),
    rotate: vi.fn(async () => ok({ key: KEY })),
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

    const b = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 3, keyCreatedAt: "2026-09-01T00:00:00.000Z" })) });
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
      status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: null })),
    });
    await store.create();
    await vi.waitFor(() => expect(snap(store).phase).toBe("created"));
    expect(snap(store).error).toBeNull();
  });

  it("перевыпуск: шит → новый ключ показывается заново", async () => {
    const { store, api } = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: null })) });
    store.open();
    await vi.waitFor(() => expect(snap(store).phase).toBe("created"));
    store.openSheet("reissue");
    expect(snap(store).sheet).toBe("reissue");
    await store.confirmSheet();
    expect(api.rotate).toHaveBeenCalledWith("tok");
    expect(snap(store)).toMatchObject({ phase: "shown", shownKey: KEY, sheet: null });
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
    const { store, api, sync, calls } = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: "2026-09-01T00:00:00.000Z" })) });
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
      const { store, api, sync } = setup({ status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: null })) });
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
      status: vi.fn(async () => ok<RecoveryStatus>({ hasKey: true, devices: 2, keyCreatedAt: null })),
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
