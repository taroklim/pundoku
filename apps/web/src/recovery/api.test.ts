import { describe, expect, it, vi } from "vitest";
import { httpRecoveryApi } from "./api";

const KEY = "K7QPM2XZ9D4TVB6NH3RW8YCJ5FGAE0S1";
const PENDING = "6f0c1d9e-1b7a-4c52-9f1a-3e5d8b2a7c10";

function api(res: Response | null) {
  const fetchFn = vi.fn(async () => {
    if (res === null) throw new TypeError("network");
    return res;
  });
  return { fetchFn, api: httpRecoveryApi({ fetchFn: fetchFn as unknown as typeof fetch, base: "http://api.test" }) };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const callOf = (f: ReturnType<typeof vi.fn>) => f.mock.calls[0] as unknown as [string, RequestInit];

describe("клиент /api/recovery/*", () => {
  it("адреса, методы и Bearer токен устройства", async () => {
    const cases: [string, string, (a: ReturnType<typeof httpRecoveryApi>) => Promise<unknown>][] = [
      ["GET", "/api/recovery", (a) => a.status("tok")],
      ["POST", "/api/recovery/key", (a) => a.create("tok")],
      ["POST", "/api/recovery/key/rotate", (a) => a.rotate("tok")],
      ["POST", "/api/recovery/key/rotate/confirm", (a) => a.confirmRotation("tok", PENDING)],
      ["DELETE", "/api/recovery/key/rotate", (a) => a.cancelRotation("tok")],
      ["POST", "/api/recovery/redeem", (a) => a.redeem("tok", KEY)],
      ["DELETE", "/api/recovery/link", (a) => a.unlink("tok")],
      ["DELETE", "/api/recovery", (a) => a.remove("tok")],
    ];
    for (const [method, path, fn] of cases) {
      const { fetchFn, api: a } = api(json(200, { hasKey: false }));
      await fn(a);
      const [url, init] = callOf(fetchFn);
      expect(url).toBe(`http://api.test${path}`);
      expect(init.method ?? "GET").toBe(method);
      expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
      expect(init.cache).toBe("no-store");
    }
  });

  it("ключ уходит только в теле redeem: не в адресе и не в заголовках", async () => {
    const { fetchFn, api: a } = api(json(200, { linked: true, devices: 2 }));
    const r = await a.redeem("tok", KEY);
    const [url, init] = callOf(fetchFn);
    expect(r).toEqual({ kind: "ok", value: { devices: 2 } });
    expect(url).not.toContain(KEY);
    expect(JSON.stringify(init.headers)).not.toContain(KEY);
    expect(JSON.parse(init.body as string)).toEqual({ key: KEY });
  });

  it("не пишет в консоль (ключ не попадает в логи)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { api: a } = api(json(201, { key: KEY, devices: 1 }));
    await a.create("tok");
    await api(json(400, { error: { code: "invalid_key" } })).api.redeem("tok", KEY);
    await api(null).api.redeem("tok", KEY);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("status: без ключа и с ключом", async () => {
    expect(await api(json(200, { hasKey: false })).api.status("t")).toEqual({ kind: "ok", value: { hasKey: false } });
    expect(await api(json(200, { hasKey: true, devices: 3, keyCreatedAt: "2026-09-30T10:00:00.000Z" })).api.status("t")).toEqual({
      kind: "ok",
      value: { hasKey: true, devices: 3, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: null },
    });
    // неподтверждённая замена (PD-126)
    const withPending = { hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: { expiresAt: "2026-10-03T10:00:00.000Z" } };
    expect(await api(json(200, withPending)).api.status("t")).toEqual({ kind: "ok", value: withPending });
    expect(await api(json(200, { ...withPending, pendingRotation: { expiresAt: 5 } })).api.status("t")).toMatchObject({ value: { pendingRotation: null } });
  });

  it("create/rotate возвращают ключ", async () => {
    expect(await api(json(201, { key: KEY, devices: 1 })).api.create("t")).toEqual({ kind: "ok", value: { key: KEY, devices: 1 } });
    const started = { key: KEY, pendingId: PENDING, expiresAt: "2026-10-03T10:00:00.000Z" };
    expect(await api(json(200, started)).api.rotate("t")).toEqual({ kind: "ok", value: started });
    expect((await api(json(200, { key: KEY })).api.rotate("t")).kind).toBe("error"); // без метки подтвердить нечем
  });

  it("confirm: метка уходит только в теле; успех/устаревшая замена/ошибки", async () => {
    const { fetchFn, api: a } = api(json(200, { confirmed: true }));
    expect(await a.confirmRotation("tok", PENDING)).toEqual({ kind: "ok", value: true });
    const [url, init] = callOf(fetchFn);
    expect(url).not.toContain(PENDING);
    expect(JSON.parse(init.body as string)).toEqual({ pendingId: PENDING });
    for (const code of ["no_pending", "pending_replaced", "pending_expired"]) {
      expect((await api(json(409, { error: { code } })).api.confirmRotation("t", PENDING)).kind, code).toBe("stale_rotation");
    }
    expect((await api(json(404, { error: { code: "no_key" } })).api.confirmRotation("t", PENDING)).kind).toBe("no_key");
    expect((await api(json(429, {}, { "retry-after": "60" })).api.confirmRotation("t", PENDING))).toEqual({ kind: "rate_limited", retryAfterSec: 60 });
    expect((await api(null).api.confirmRotation("t", PENDING)).kind).toBe("network");
    expect((await api(json(200, {})).api.confirmRotation("t", PENDING)).kind).toBe("error");
  });

  it("коды ошибок → значения результата", async () => {
    expect((await api(json(401, {})).api.status("t")).kind).toBe("unauthorized");
    expect((await api(json(400, { error: { code: "invalid_key" } })).api.redeem("t", KEY)).kind).toBe("invalid_key");
    expect((await api(json(409, { error: { code: "key_exists" } })).api.create("t")).kind).toBe("key_exists");
    expect((await api(json(404, { error: { code: "no_key" } })).api.rotate("t")).kind).toBe("no_key");
    expect((await api(json(500, {})).api.status("t")).kind).toBe("error");
    expect((await api(null).api.status("t")).kind).toBe("network");
    expect((await api(json(200, { weird: true })).api.status("t")).kind).toBe("error");
  });

  it("429: Retry-After в секундах (с потолком в час)", async () => {
    expect(await api(json(429, {}, { "retry-after": "540" })).api.redeem("t", KEY)).toEqual({ kind: "rate_limited", retryAfterSec: 540 });
    expect(await api(json(429, {}, { "retry-after": "99999" })).api.redeem("t", KEY)).toEqual({ kind: "rate_limited", retryAfterSec: 3600 });
    expect(await api(json(429, {})).api.redeem("t", KEY)).toEqual({ kind: "rate_limited", retryAfterSec: null });
  });

  it("unlink и delete: 204 без тела — успех", async () => {
    expect(await api(new Response(null, { status: 204 })).api.unlink("t")).toEqual({ kind: "ok", value: true });
    expect(await api(new Response(null, { status: 204 })).api.remove("t")).toEqual({ kind: "ok", value: true });
  });
});
