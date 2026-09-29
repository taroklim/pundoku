import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { DayPuzzle } from "./dayResolver";
import {
  DAILY_FALLBACK_DIFFICULTY,
  fallbackDay,
  localDate,
  parseDaily,
  planDay,
  reconcileDay,
  shouldRefetch,
  verifyMode,
} from "./dayResolver";

const M1 = "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const M2 = "002000000" + "085703020" + "000000000" + "000000000" + "000000000" + "000000000" + "000000000" + "000000000" + "000000830";

const day = (over: Partial<DayPuzzle> = {}): DayPuzzle => ({
  date: "2026-09-29",
  mission: M1,
  difficulty: "hard",
  source: "sudoku.com",
  winRate: 52.1,
  ...over,
});

describe("localDate", () => {
  it("локальные компоненты, а не UTC", () => {
    expect(localDate(new Date(2026, 8, 29, 0, 5))).toBe("2026-09-29");
    expect(localDate(new Date(2026, 0, 3, 23, 59))).toBe("2026-01-03");
  });
});

describe("parseDaily", () => {
  it("корректный ответ sudoku.com с winRate", () => {
    const r = parseDaily("2026-09-29", { date: "2026-09-29", mission: M1, difficulty: "hard", winRate: 52.1, source: "sudoku.com" });
    expect(r).toEqual({ ok: true, puzzle: day() });
  });

  it("фолбэк сервера: winRate отсутствует", () => {
    const r = parseDaily("2026-09-29", { mission: M1, difficulty: "medium", source: "generator" });
    expect(r.ok && r.puzzle.winRate).toBeNull();
    expect(r.ok && r.puzzle.source).toBe("generator");
  });

  it("неизвестная сложность не ломает сетку, но подпись без сложности", () => {
    const r = parseDaily("2026-09-29", { mission: M1, difficulty: "evil", source: "sudoku.com" });
    expect(r.ok && r.puzzle.difficulty).toBeNull();
  });

  it("winRate вне 0..100 или не число отбрасывается", () => {
    for (const winRate of [-1, 101, "61", NaN]) {
      const r = parseDaily("2026-09-29", { mission: M1, difficulty: "hard", source: "sudoku.com", winRate });
      expect(r.ok && r.puzzle.winRate).toBeNull();
    }
  });

  it.each([
    ["не объект", "oops"],
    ["null", null],
    ["короткая mission", { mission: "123", difficulty: "hard", source: "sudoku.com" }],
    ["буквы в mission", { mission: "x".repeat(81), difficulty: "hard", source: "sudoku.com" }],
    ["неизвестный source", { mission: M1, difficulty: "hard", source: "elsewhere" }],
  ])("невалидный ответ: %s", (_n, body) => {
    const r = parseDaily("2026-09-29", body);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("invalid");
  });

  it("невалидная mission, но известная сложность — сложность сохраняется для фолбэка", () => {
    const r = parseDaily("2026-09-29", { mission: "1", difficulty: "expert", source: "generator" });
    expect(!r.ok && r.difficulty).toBe("expert");
  });

  it("невалидная mission у sudoku.com: метка сложности не сохраняется (чужая шкала)", () => {
    const r = parseDaily("2026-09-29", { mission: "1", difficulty: "hard", source: "sudoku.com" });
    expect(!r.ok && r.difficulty).toBeNull();
  });
});

describe("planDay: что играть", () => {
  it("ответ API — играем серверную сетку", () => {
    const plan = planDay("2026-09-29", { ok: true, puzzle: day() });
    expect(plan).toEqual({ kind: "server", puzzle: day() });
  });

  it("нет сети и ничего не известно — DAILY_FALLBACK_DIFFICULTY", () => {
    const plan = planDay("2026-09-29", { ok: false, reason: "network" });
    expect(plan).toEqual({ kind: "fallback", date: "2026-09-29", difficulty: DAILY_FALLBACK_DIFFICULTY });
  });

  it("сложность из (негодного) ответа API важнее последней известной", () => {
    const plan = planDay("2026-09-29", { ok: false, reason: "invalid", difficulty: "expert" }, "easy");
    expect(plan).toMatchObject({ kind: "fallback", difficulty: "expert" });
  });

  it("последняя известная сложность — когда ответа не было", () => {
    const plan = planDay("2026-09-29", { ok: false, reason: "http" }, "hard");
    expect(plan).toMatchObject({ kind: "fallback", difficulty: "hard" });
  });

  it("ответ был, но сложность неизвестна (null) — падаем на последнюю известную, затем на умолчание", () => {
    expect(planDay("2026-09-29", { ok: false, reason: "invalid", difficulty: null }, "hard")).toMatchObject({ difficulty: "hard" });
    expect(planDay("2026-09-29", { ok: false, reason: "invalid", difficulty: null })).toMatchObject({
      difficulty: DAILY_FALLBACK_DIFFICULTY,
    });
  });
});

describe("fallbackDay: только dailyPuzzle(date, difficulty)", () => {
  it("зовёт генератор с (date, difficulty) и помечает сетку как client", () => {
    const generate = vi.fn(() => ({ mission: M1, solution: "1".repeat(81) }));
    const r = fallbackDay("2026-09-29", "hard", generate);
    expect(generate).toHaveBeenCalledWith("2026-09-29", "hard");
    expect(r.puzzle).toEqual({ date: "2026-09-29", mission: M1, difficulty: "hard", source: "client", winRate: null });
  });

  it("по умолчанию — ровно dailyPuzzle движка (та же сетка, что у серверного фолбэка)", () => {
    const r = fallbackDay("2026-09-29", "easy");
    const engine = dailyPuzzle("2026-09-29", "easy");
    expect(r.puzzle.mission).toBe(engine.mission);
    expect(r.solution).toBe(engine.solution);
  });
});

describe("reconcileDay: возврат в сеть", () => {
  const own = (over = {}) => ({ mission: M1, source: "client" as const, hasMoves: false, ...over });

  it("сервер не ответил — ничего не меняем", () => {
    expect(reconcileDay(own(), null)).toEqual({ action: "none" });
    expect(reconcileDay(own({ hasMoves: true }), null)).toEqual({ action: "none" });
  });

  it("нет ходов, сетка сменилась (generator → sudoku.com) — молча берём актуальную", () => {
    const latest = day({ mission: M2 });
    expect(reconcileDay(own(), latest)).toEqual({ action: "replace", puzzle: latest });
  });

  it("есть ходы, сетка сменилась — доигрываем свою, проверка локальная", () => {
    expect(reconcileDay(own({ hasMoves: true }), day({ mission: M2 }))).toEqual({ action: "keep-own", verify: "local" });
  });

  it("та же сетка (клиентский фолбэк совпал с серверным generator) — оставляем, метаданные новые, verify на сервере", () => {
    const latest = day({ source: "generator", winRate: null });
    expect(reconcileDay(own({ hasMoves: true }), latest)).toEqual({ action: "keep", puzzle: latest, verify: "server" });
    expect(reconcileDay(own(), latest)).toEqual({ action: "keep", puzzle: latest, verify: "server" });
  });

  it("играем серверный generator, сервер заменил его на sudoku.com: без ходов — replace, с ходами — своя", () => {
    const current = { mission: M1, source: "generator" as const };
    const latest = day({ mission: M2, source: "sudoku.com" });
    expect(reconcileDay({ ...current, hasMoves: false }, latest).action).toBe("replace");
    expect(reconcileDay({ ...current, hasMoves: true }, latest).action).toBe("keep-own");
  });

  it("совпавшая mission с другим source (client → sudoku.com) обновляет источник", () => {
    const latest = day({ source: "sudoku.com" });
    const r = reconcileDay(own({ hasMoves: true }), latest);
    expect(r).toMatchObject({ action: "keep", puzzle: { source: "sudoku.com", winRate: 52.1 } });
  });
});

describe("verifyMode", () => {
  it("сервер — только при совпадении mission с серверной", () => {
    expect(verifyMode(M1, M1)).toBe("server");
    expect(verifyMode(M1, M2)).toBe("local");
    expect(verifyMode(M1, null)).toBe("local");
  });
});

describe("shouldRefetch", () => {
  it("сетка sudoku.com неизменна, остальное перезапрашиваем", () => {
    expect(shouldRefetch("sudoku.com")).toBe(false);
    expect(shouldRefetch("generator")).toBe(true);
    expect(shouldRefetch("client")).toBe(true);
    expect(shouldRefetch(null)).toBe(true);
  });
});
