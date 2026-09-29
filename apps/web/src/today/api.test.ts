import { describe, expect, it, vi } from "vitest";
import { apiUrl, fetchDaily, verifyDaily } from "./api";

const M =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("apiUrl", () => {
  it("пустая база — тот же origin (dev-прокси)", () => {
    expect(apiUrl("/api/daily/2026-09-29", "")).toBe("/api/daily/2026-09-29");
  });
  it("база без завершающего слэша", () => {
    expect(apiUrl("/api/x", "https://api.example.com/")).toBe("https://api.example.com/api/x");
  });
});

describe("fetchDaily", () => {
  it("успех", async () => {
    const fetchFn = vi.fn(async (..._a: unknown[]) => json({ date: "2026-09-29", mission: M, difficulty: "hard", winRate: 61, source: "sudoku.com" }));
    const r = await fetchDaily("2026-09-29", { fetchFn: fetchFn as unknown as typeof fetch, base: "" });
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/daily/2026-09-29");
    // Всегда сверяемся с сервером: фолбэк-сетка кэшируется на минуту и заменяется на сетку Sudoku.com.
    expect((fetchFn.mock.calls[0]![1] as RequestInit).cache).toBe("no-cache");
    expect(r.ok && r.puzzle.source).toBe("sudoku.com");
  });
  it("сеть упала — network", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchDaily("2026-09-29", { fetchFn: fetchFn as unknown as typeof fetch })).toEqual({ ok: false, reason: "network" });
  });
  it("HTTP-ошибка (503/404) — http", async () => {
    const fetchFn = async () => json({ error: { code: "daily_unavailable" } }, 503);
    expect(await fetchDaily("2026-09-29", { fetchFn: fetchFn as unknown as typeof fetch })).toEqual({ ok: false, reason: "http" });
  });
  it("не JSON — invalid", async () => {
    const fetchFn = async () => new Response("<html>", { status: 200 });
    expect(await fetchDaily("2026-09-29", { fetchFn: fetchFn as unknown as typeof fetch })).toEqual({ ok: false, reason: "invalid" });
  });
  it("таймаут прерывает запрос", async () => {
    const fetchFn = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const r = await fetchDaily("2026-09-29", { fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 20 });
    expect(r).toEqual({ ok: false, reason: "network" });
  });
});

describe("verifyDaily", () => {
  it("шлёт grid и возвращает correct", async () => {
    const fetchFn = vi.fn(async (..._a: unknown[]) => json({ correct: true }));
    expect(await verifyDaily("2026-09-29", "1".repeat(81), { fetchFn: fetchFn as unknown as typeof fetch, base: "" })).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/daily/2026-09-29/verify");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ grid: "1".repeat(81) });
  });
  it("нет ответа / ошибка — null (не false)", async () => {
    const down = async () => {
      throw new TypeError("x");
    };
    expect(await verifyDaily("2026-09-29", "1", { fetchFn: down as unknown as typeof fetch })).toBeNull();
    const bad = async () => json({}, 400);
    expect(await verifyDaily("2026-09-29", "1", { fetchFn: bad as unknown as typeof fetch })).toBeNull();
  });
});
