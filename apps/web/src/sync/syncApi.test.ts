import { describe, expect, it, vi } from "vitest";
import { httpSyncApi } from "./syncApi";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const api = (fetchFn: typeof fetch) => httpSyncApi({ fetchFn, base: "https://api.test" });
const snap = { version: 3, updatedAt: "2026-09-29T12:00:00.000Z", data: { schemaVersion: 1, days: {} } };

describe("httpSyncApi", () => {
  it("register: POST /api/devices → токен", async () => {
    const f = vi.fn(async () => json(201, { deviceToken: "abc" }));
    expect(await api(f as unknown as typeof fetch).register()).toEqual({ kind: "ok", token: "abc" });
    expect(f).toHaveBeenCalledWith("https://api.test/api/devices", expect.objectContaining({ method: "POST" }));
  });

  it("register: 429 с Retry-After → пауза в мс; сеть → error без паузы; мусор в теле → error", async () => {
    expect(await api((async () => json(429, {}, { "retry-after": "30" })) as unknown as typeof fetch).register()).toEqual({ kind: "error", retryAfterMs: 30_000 });
    expect(await api((async () => { throw new Error("offline"); }) as unknown as typeof fetch).register()).toEqual({ kind: "error", retryAfterMs: null });
    expect(await api((async () => json(201, { nope: 1 })) as unknown as typeof fetch).register()).toEqual({ kind: "error", retryAfterMs: null });
  });

  it("pull: 200 / 404 / 401 / 5xx / формат не тот", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(json(200, snap));
    expect(await api(f as unknown as typeof fetch).pull("tok")).toEqual({ kind: "ok", snapshot: snap });
    expect(f).toHaveBeenCalledWith("https://api.test/api/snapshot", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer tok" }) }));
    f.mockResolvedValueOnce(json(404, { error: "snapshot_not_found" }));
    expect(await api(f as unknown as typeof fetch).pull("tok")).toEqual({ kind: "none" });
    f.mockResolvedValueOnce(json(401, {}));
    expect(await api(f as unknown as typeof fetch).pull("tok")).toEqual({ kind: "unauthorized" });
    f.mockResolvedValueOnce(json(503, {}));
    expect(await api(f as unknown as typeof fetch).pull("tok")).toEqual({ kind: "error", retryAfterMs: null });
    f.mockResolvedValueOnce(json(200, { version: "x" }));
    expect(await api(f as unknown as typeof fetch).pull("tok")).toEqual({ kind: "error", retryAfterMs: null });
  });

  it("push: PUT с Bearer и телом; 200 / 409 (снапшот из тела) / 413 / 401 / 5xx", async () => {
    const f = vi.fn();
    const body = { version: 4, updatedAt: snap.updatedAt, data: { schemaVersion: 1, days: {} } };
    f.mockResolvedValueOnce(json(200, { version: 4, updatedAt: snap.updatedAt }));
    expect(await api(f as unknown as typeof fetch).push("tok", body)).toEqual({ kind: "ok", version: 4 });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(body);
    f.mockResolvedValueOnce(json(409, { error: "snapshot_conflict", snapshot: snap }));
    expect(await api(f as unknown as typeof fetch).push("tok", body)).toEqual({ kind: "conflict", snapshot: snap });
    f.mockResolvedValueOnce(json(409, {}));
    expect(await api(f as unknown as typeof fetch).push("tok", body)).toEqual({ kind: "conflict", snapshot: null });
    f.mockResolvedValueOnce(json(413, { error: "snapshot_too_large" }));
    expect(await api(f as unknown as typeof fetch).push("tok", body)).toEqual({ kind: "too_large" });
    f.mockResolvedValueOnce(json(401, {}));
    expect(await api(f as unknown as typeof fetch).push("tok", body)).toEqual({ kind: "unauthorized" });
    f.mockResolvedValueOnce(json(500, {}));
    expect(await api(f as unknown as typeof fetch).push("tok", body)).toEqual({ kind: "error", retryAfterMs: null });
  });
});
