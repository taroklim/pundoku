/**
 * Чистая логика «какую сетку дня играть» (PD-12, из находки PD-8). Без DOM, сети и React —
 * тестируется в node (`dayResolver.test.ts`). Правила (см. README `apps/web`):
 *
 * 1. Сетка дня — ответ `GET /api/daily/:date`. Нет ответа (офлайн, 5xx, мусор в ответе) —
 *    клиентский фолбэк, и ТОЛЬКО через `dailyPuzzle(date, difficulty)` движка: `difficulty` из
 *    ответа API, если он был; иначе последняя известная; иначе `DAILY_FALLBACK_DIFFICULTY`.
 *    Seed вручную не собирается — сетка обязана совпасть с серверным фолбэком.
 * 2. Фолбэк (клиентский или серверный `generator`) временный: сервер может заменить его настоящей
 *    сеткой Sudoku.com. При возврате в сеть клиент перезапрашивает день и сверяет `mission`.
 *    - нет ходов → молча берём актуальную;
 *    - есть ходы → доигрываем свою (сетка под руками не меняется);
 *    - `verify` на сервер — только если наша mission совпадает с серверной, иначе локальная проверка.
 * 3. Сетка Sudoku.com неизменна (сервер хранит её навсегда): её не перезапрашиваем.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES, dailyPuzzle } from "@pundoku/engine";

/**
 * Сложность клиентского фолбэка по умолчанию. Значение обязано совпадать с
 * `DAILY_FALLBACK_DIFFICULTY` сервера (`apps/api`, по умолчанию `medium`); движок константу не
 * экспортирует (README движка: «сложность фолбэка на сервере — DAILY_FALLBACK_DIFFICULTY»).
 * Клиент берёт сложность из ответа API, это значение — только когда ответа не было вовсе.
 */
export const DAILY_FALLBACK_DIFFICULTY: Difficulty = "medium";

/** `sudoku.com` / `generator` — как отдаёт API; `client` — сетка построена на устройстве без ответа API. */
export type DaySource = "sudoku.com" | "generator" | "client";

export interface DayPuzzle {
  /** Локальная дата устройства, `YYYY-MM-DD`. */
  readonly date: string;
  /** 81 цифра, `0` — пустая клетка. */
  readonly mission: string;
  /** `null` — API прислал сложность, которой нет у движка (подпись без сложности). */
  readonly difficulty: Difficulty | null;
  readonly source: DaySource;
  /** Процент решивших сегодня; только у сетки Sudoku.com. */
  readonly winRate: number | null;
}

/** Результат запроса дня, уже разобранный и провалидированный слоем сети. */
export type FetchedDay =
  | { readonly ok: true; readonly puzzle: DayPuzzle }
  | {
      readonly ok: false;
      readonly reason: "network" | "http" | "invalid";
      /** Сложность из ответа, если он был, но mission оказалась негодной. */
      readonly difficulty?: Difficulty | null;
    };

export type DayPlan =
  | { readonly kind: "server"; readonly puzzle: DayPuzzle }
  | { readonly kind: "fallback"; readonly date: string; readonly difficulty: Difficulty };

const pad = (n: number): string => String(n).padStart(2, "0");

/** Локальная дата устройства как `YYYY-MM-DD` (не UTC: «сегодня» — по часам игрока). */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);

export const isMission = (value: unknown): value is string => typeof value === "string" && /^[0-9]{81}$/.test(value);

/** Ответ API → сетка дня или причина отказа. `date` — запрошенная локальная дата. */
export function parseDaily(date: string, body: unknown): FetchedDay {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "invalid" };
  const b = body as Record<string, unknown>;
  const difficulty = isDifficulty(b["difficulty"]) ? b["difficulty"] : null;
  const source = b["source"];
  if (!isMission(b["mission"]) || (source !== "sudoku.com" && source !== "generator")) {
    return { ok: false, reason: "invalid", difficulty };
  }
  const rate = b["winRate"];
  return {
    ok: true,
    puzzle: {
      date,
      mission: b["mission"],
      difficulty,
      source,
      winRate: typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null,
    },
  };
}

/** Что играть: серверную сетку или клиентский фолбэк (и какой сложности). */
export function planDay(date: string, fetched: FetchedDay, lastKnown: Difficulty | null = null): DayPlan {
  if (fetched.ok) return { kind: "server", puzzle: fetched.puzzle };
  return { kind: "fallback", date, difficulty: fetched.difficulty ?? lastKnown ?? DAILY_FALLBACK_DIFFICULTY };
}

/**
 * Клиентский фолбэк: единственный допустимый способ — `dailyPuzzle(date, difficulty)`.
 * `generate` подменяется в тестах; воркер зовёт с умолчанием.
 */
export function fallbackDay(
  date: string,
  difficulty: Difficulty,
  generate: (date: string, difficulty: Difficulty) => { mission: string; solution: string } = dailyPuzzle,
): { puzzle: DayPuzzle; solution: string } {
  const p = generate(date, difficulty);
  return { puzzle: { date, mission: p.mission, difficulty, source: "client", winRate: null }, solution: p.solution };
}

/** Что уже играется: сетка и есть ли ходы (постановки, стирание, заметки, undo — любая запись лога). */
export interface CurrentDay {
  readonly mission: string;
  readonly source: DaySource;
  readonly hasMoves: boolean;
}

export type Reconciliation =
  /** Сервер не ответил — остаёмся как есть. */
  | { readonly action: "none" }
  /** Та же сетка: только обновить метаданные (источник, win rate) и проверять на сервере. */
  | { readonly action: "keep"; readonly puzzle: DayPuzzle; readonly verify: "server" }
  /** Ходов нет — молча берём актуальную сетку. */
  | { readonly action: "replace"; readonly puzzle: DayPuzzle }
  /** Ходы есть, а сетка сервера другая — доигрываем свою, проверка локальная. */
  | { readonly action: "keep-own"; readonly verify: "local" };

/** Сверка играемой сетки с актуальным ответом сервера (при возврате в сеть / перезапуске). */
export function reconcileDay(current: CurrentDay, latest: DayPuzzle | null): Reconciliation {
  if (latest === null) return { action: "none" };
  if (latest.mission === current.mission) return { action: "keep", puzzle: latest, verify: "server" };
  if (!current.hasMoves) return { action: "replace", puzzle: latest };
  return { action: "keep-own", verify: "local" };
}

/** Кто проверяет решение: сервер (`POST verify`) — только для сетки, совпавшей с серверной. */
export function verifyMode(ownMission: string, serverMission: string | null): "server" | "local" {
  return serverMission !== null && serverMission === ownMission ? "server" : "local";
}

/** Перезапрашивать ли день при возврате в сеть: сетка Sudoku.com неизменна, остальное временно. */
export function shouldRefetch(source: DaySource | null): boolean {
  return source !== "sudoku.com";
}
