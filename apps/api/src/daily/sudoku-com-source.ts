import type { DailyPuzzleSource, SourceResult } from "./types.js";
import { MISSION_RE, SOLUTION_RE } from "./types.js";

/**
 * Адаптер к неофициальному JSON Sudoku.com (Easybrain). Проверено живым запросом 2026-09-29:
 *
 *   GET https://sudoku.com/api/v2/dc/2026-09-28   (заголовок X-Requested-With: XMLHttpRequest обязателен)
 *   200 application/json
 *   {"id":"1f13c7e4-096f-64fe-9710-577982589729",
 *    "mission":"002000000085703020...830",   // string, 81 цифра, 0 = пустая клетка
 *    "solution":"962415378185763429...832",  // string, 81 цифра 1-9
 *    "win_rate":52.1,                         // number, процент решивших
 *    "difficulty":"hard"}                     // string (у daily challenge пока всегда "hard")
 *
 *   без заголовка            → 403
 *   дата > завтра (UTC)      → 204 без тела   (завтрашняя сетка уже доступна)
 *   невалидная дата          → 404 text/html
 *   CORS-заголовков нет      → только через этот прокси, никогда из браузера
 */
export interface SudokuComSourceOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface RawDaily {
  id?: unknown;
  mission?: unknown;
  solution?: unknown;
  win_rate?: unknown;
  difficulty?: unknown;
}

export class SudokuComSource implements DailyPuzzleSource {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: SudokuComSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetch(date: string): Promise<SourceResult> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/dc/${date}`, {
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = (error as Error)?.name;
      const reason = name === "TimeoutError" || name === "AbortError" ? `timeout after ${this.timeoutMs}ms` : String(error);
      return { kind: "error", reason };
    }

    if (response.status === 204) return { kind: "not_available" };
    if (!response.ok) return { kind: "error", reason: `HTTP ${response.status}` };

    let raw: RawDaily;
    try {
      raw = (await response.json()) as RawDaily;
    } catch {
      return { kind: "error", reason: "invalid JSON" };
    }
    return parseRaw(raw);
  }
}

export function parseRaw(raw: RawDaily): SourceResult {
  if (typeof raw !== "object" || raw === null) return { kind: "error", reason: "response is not an object" };
  const { mission, solution, difficulty, win_rate: winRate, id } = raw;
  if (typeof mission !== "string" || !MISSION_RE.test(mission)) return { kind: "error", reason: "invalid mission" };
  if (typeof solution !== "string" || !SOLUTION_RE.test(solution)) return { kind: "error", reason: "invalid solution" };
  if (!missionMatchesSolution(mission, solution)) return { kind: "error", reason: "mission does not match solution" };
  return {
    kind: "ok",
    puzzle: {
      id: typeof id === "string" ? id : "",
      mission,
      solution,
      difficulty: typeof difficulty === "string" && difficulty !== "" ? difficulty : "unknown",
      winRate: typeof winRate === "number" && Number.isFinite(winRate) ? winRate : null,
    },
  };
}

function missionMatchesSolution(mission: string, solution: string): boolean {
  for (let i = 0; i < 81; i++) {
    const m = mission.charCodeAt(i);
    if (m !== 48 && m !== solution.charCodeAt(i)) return false;
  }
  return true;
}
