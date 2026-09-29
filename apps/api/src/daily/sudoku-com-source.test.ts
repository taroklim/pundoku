import { describe, expect, it } from "vitest";
import { SudokuComSource, parseRaw } from "./sudoku-com-source.js";
import { SAMPLE } from "../test/fakes.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function sourceWith(fetchFn: typeof fetch, timeoutMs = 50) {
  return new SudokuComSource({ baseUrl: "https://sudoku.example/api/v2/", timeoutMs, fetchFn });
}

describe("SudokuComSource", () => {
  it("200 → ok с полями Sudoku.com, шлёт X-Requested-With и правильный URL", async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const source = sourceWith(async (input, init) => {
      seen = { url: String(input), headers: init?.headers as Record<string, string> };
      return jsonResponse(SAMPLE);
    });
    const result = await source.fetch("2026-09-28");
    expect(seen?.url).toBe("https://sudoku.example/api/v2/dc/2026-09-28");
    expect(seen?.headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(result).toEqual({
      kind: "ok",
      puzzle: { id: SAMPLE.id, mission: SAMPLE.mission, solution: SAMPLE.solution, difficulty: "hard", winRate: 52.1 },
    });
  });

  it("204 (дата дальше завтра) → not_available", async () => {
    const source = sourceWith(async () => new Response(null, { status: 204 }));
    expect(await source.fetch("2027-01-01")).toEqual({ kind: "not_available" });
  });

  it("403 (без заголовка / заблокировали) → error", async () => {
    const source = sourceWith(async () => new Response("forbidden", { status: 403 }));
    expect(await source.fetch("2026-09-28")).toEqual({ kind: "error", reason: "HTTP 403" });
  });

  it("таймаут → error с timeout", async () => {
    const source = sourceWith(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
        }),
      20,
    );
    const result = await source.fetch("2026-09-28");
    expect(result.kind).toBe("error");
    expect((result as { reason: string }).reason).toMatch(/timeout after 20ms/);
  });

  it("сетевой сбой (fetch reject) → error", async () => {
    const source = sourceWith(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await source.fetch("2026-09-28")).kind).toBe("error");
  });

  it("невалидный JSON (HTML вместо JSON) → error", async () => {
    const source = sourceWith(async () => new Response("<!DOCTYPE html>", { status: 200 }));
    expect(await source.fetch("2026-09-28")).toEqual({ kind: "error", reason: "invalid JSON" });
  });

  it("JSON без нужных полей → error", async () => {
    const source = sourceWith(async () => jsonResponse({ id: "x" }));
    expect(await source.fetch("2026-09-28")).toEqual({ kind: "error", reason: "invalid mission" });
  });
});

describe("parseRaw", () => {
  it("отвергает mission, не согласованный с solution", () => {
    const mission = "1" + SAMPLE.mission.slice(1); // в решении на [0] стоит 9
    expect(parseRaw({ ...SAMPLE, mission })).toEqual({ kind: "error", reason: "mission does not match solution" });
  });

  it("отвергает solution с нулём или неверной длины", () => {
    expect(parseRaw({ ...SAMPLE, solution: "0" + SAMPLE.solution.slice(1) }).kind).toBe("error");
    expect(parseRaw({ ...SAMPLE, solution: SAMPLE.solution.slice(1) }).kind).toBe("error");
  });

  it("терпит отсутствие win_rate/difficulty/id", () => {
    const result = parseRaw({ mission: SAMPLE.mission, solution: SAMPLE.solution });
    expect(result).toEqual({
      kind: "ok",
      puzzle: { id: "", mission: SAMPLE.mission, solution: SAMPLE.solution, difficulty: "unknown", winRate: null },
    });
  });
});
