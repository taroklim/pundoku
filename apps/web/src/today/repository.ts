/**
 * Хранилище личного прогресса Today (PD-12, PD-14): состояние постоянной сетки и прогресс дня.
 *
 * Интерфейс асинхронный: `DayStore` и экран о хранилище ничего не знают. Реализации:
 * - `IndexedDbProgressRepository` (`sync/idbRepository.ts`) — боевая, переживает перезагрузку;
 * - `InMemoryProgressRepository` (ниже) — для тестов и как деградация, если IndexedDB недоступна
 *   (приватный режим старых браузеров): игра работает, но данные живут до закрытия вкладки.
 * Поверх хранилища работает синхронизация снапшота с сервером (`sync/manager.ts`).
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES, TECHNIQUE_ORDER } from "@pundoku/engine";
import type { DaySource } from "./dayResolver";
import type { PermanentGridState } from "./permanent";
import type { PlayState } from "../play/logic";

/** Прогресс одного дня: играемая сетка, ходы, итог. Структура клонируема (structuredClone/IndexedDB). */
export interface DayProgress {
  readonly date: string;
  readonly mission: string;
  readonly difficulty: Difficulty | null;
  readonly source: DaySource;
  readonly winRate: number | null;
  readonly play: PlayState;
  /** Накопленное «тихое» время партии, мс. */
  readonly elapsedMs: number;
  readonly solved: boolean;
  /** Ответ сервера на verify: `true/false`; `null` — не проверялось/нет ответа. */
  readonly serverVerified: boolean | null;
  /** Кто проверяет решение этой сетки (см. `verifyMode`): «local» — сетка отличается от серверной. */
  readonly verification: "server" | "local";
  /** Момент решения (ISO 8601 UTC); `null` — не решён. Для Year: первое решение дня. */
  readonly solvedAt: string | null;
  /** День решён после своей даты (дата дня < даты на момент решения). */
  readonly late: boolean;
  /**
   * Решено с подсказкой (PD-139): партия помечена первой РЕЗУЛЬТАТИВНОЙ подсказкой (техника или ошибка; «ничего не нашёл»
   * не помечает). Хранится отдельно от `hints` и не выводится из него.
   */
  readonly assisted: boolean;
  /** Сколько результативных подсказок взято (PD-139). Опционально: старые записи — 0; схему снапшота не версионируем. */
  readonly hints?: number;
}

/**
 * Момент решения дня для упорядочивания (PD-197): `solvedAt`, а у решённой записи без него (старые записи до появления поля) —
 * начало даты дня `YYYY-MM-DDT00:00:00.000Z`. Стабильно (не зависит от «сейчас») и не позже любого настоящего решения
 * других дней, сделанного после него: день нельзя решить раньше его даты. Так же заполняется `solvedAt` при выгрузке в
 * снапшот — порядок дней одинаков на всех устройствах.
 */
export const solvedAtOrDayStart = (p: Pick<DayProgress, "date" | "solvedAt">): string => p.solvedAt ?? `${p.date}T00:00:00.000Z`;

const CELL_COUNT = 81;
const MOVE_KINDS: readonly unknown[] = ["place", "erase", "note_add", "note_remove", "undo"];
const TECHNIQUES: readonly unknown[] = [...TECHNIQUE_ORDER, "beyond"];
const DAY_SOURCES: readonly unknown[] = ["sudoku.com", "generator", "client"];
/** Маска заметок: биты 1..9 (бит 0 не используется). */
const NOTES_MAX = 0x3fe;

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isIntArray81 = (v: unknown, min: number, max: number): boolean =>
  Array.isArray(v) && v.length === CELL_COUNT && v.every((n) => isInt(n, min, max));
/** Маска заметок: целое, только биты 1..9. */
const isNotesMask = (n: unknown): boolean => isInt(n, 0, NOTES_MAX) && (n & 1) === 0;
const isBoolOrUndef = (v: unknown): boolean => v === undefined || typeof v === "boolean";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Ход лога по схеме `Move` движка (`types.ts`): все поля, которые читают `heatmap`/`summary`/Таймлапс. */
function isMove(m: unknown): boolean {
  if (!isObj(m)) return false;
  if (typeof m["t"] !== "number" || !Number.isFinite(m["t"]) || m["t"] < 0) return false;
  if (!isInt(m["cell"], 0, CELL_COUNT - 1)) return false;
  if (!MOVE_KINDS.includes(m["kind"])) return false;
  if (m["digit"] !== undefined && !isInt(m["digit"], 1, 9)) return false;
  if (!isBoolOrUndef(m["correct"]) || !isBoolOrUndef(m["blot"])) return false;
  return m["technique"] === undefined || TECHNIQUES.includes(m["technique"]);
}

/** Запись стека undo (`play/logic.ts › UndoEntry`). */
function isUndoEntry(e: unknown): boolean {
  if (!isObj(e)) return false;
  const also = e["also"];
  // PD-119: `also` — [клетка, заметки до хода][] (автоочистка соседей / «Fill candidates»); `fill` — только `true`. У старых записей их нет.
  const alsoOk =
    also === undefined ||
    (Array.isArray(also) && also.length <= CELL_COUNT && also.every((a) => Array.isArray(a) && a.length === 2 && isInt(a[0], 0, CELL_COUNT - 1) && isNotesMask(a[1])));
  return (
    isInt(e["cell"], 0, CELL_COUNT - 1) &&
    isInt(e["prevValue"], 0, 9) &&
    isNotesMask(e["prevNotes"]) &&
    (e["digit"] === undefined || isInt(e["digit"], 1, 9)) &&
    alsoOk &&
    (e["fill"] === undefined || e["fill"] === true)
  );
}

/** Запись журнала подсказок (`play/logic.ts › HintEvent`, PD-139). */
function isHintEvent(e: unknown): boolean {
  if (!isObj(e)) return false;
  return typeof e["t"] === "number" && Number.isFinite(e["t"]) && e["t"] >= 0 && (e["cell"] === null || isInt(e["cell"], 0, CELL_COUNT - 1));
}

/** Причина, по которой `play` нечитаем (`null` — годится). Структура — `PlayState` (`play/logic.ts`). */
function playProblem(play: unknown): string | null {
  if (!isObj(play)) return "play";
  if (!isIntArray81(play["mission"], 0, 9)) return "play.mission";
  if (!isIntArray81(play["solution"], 0, 9)) return "play.solution";
  if (!isIntArray81(play["values"], 0, 9)) return "play.values";
  if (!Array.isArray(play["notes"]) || play["notes"].length !== CELL_COUNT || !play["notes"].every(isNotesMask)) return "play.notes";
  const log = play["log"];
  if (!Array.isArray(log)) return "play.log";
  if (!log.every(isMove)) return "play.log[]";
  const stack = play["undoStack"];
  if (!Array.isArray(stack) || !stack.every(isUndoEntry)) return "play.undoStack";
  if (typeof play["solved"] !== "boolean") return "play.solved";
  if (!isBoolOrUndef(play["ink"])) return "play.ink";
  if (play["logSynthetic"] !== undefined && play["logSynthetic"] !== true) return "play.logSynthetic";
  const hintLog = play["hintLog"];
  if (hintLog !== undefined && (!Array.isArray(hintLog) || !hintLog.every(isHintEvent))) return "play.hintLog";
  return null;
}

/**
 * Почему запись дня нечитаема (`null` — годится). Граница хранилища (PD-146): запись, прочитанная из IndexedDB, — не
 * доверенный вход. WebKit (iOS Safari/WKWebView) умеет отдать из `getAll()` ключ без читаемого значения (`undefined`), а
 * порченая запись (напр. `log: [null]`) роняла потребителей (`summary`/`heatmap`/Year) на каждом открытии, и «Reload» не
 * помогал (PD-148). Поэтому проверяем всё, что потребители разыменовывают: поля `DayProgress`, массивы `PlayState`
 * фиксированной длины 81 с диапазонами значений, маски заметок, каждый ход лога по схеме `Move` и стек undo.
 */
export function dayProgressProblem(x: unknown): string | null {
  if (!isObj(x)) return "not an object";
  if (typeof x["date"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x["date"])) return "date";
  if (typeof x["mission"] !== "string") return "mission";
  if (x["difficulty"] !== null && !DIFFICULTIES.includes(x["difficulty"] as Difficulty)) return "difficulty";
  if (!DAY_SOURCES.includes(x["source"])) return "source";
  if (x["winRate"] !== null && (typeof x["winRate"] !== "number" || !Number.isFinite(x["winRate"]))) return "winRate";
  const play = playProblem(x["play"]);
  if (play !== null) return play;
  if (typeof x["elapsedMs"] !== "number" || !Number.isFinite(x["elapsedMs"]) || x["elapsedMs"] < 0) return "elapsedMs";
  if (typeof x["solved"] !== "boolean") return "solved";
  if (x["serverVerified"] !== null && typeof x["serverVerified"] !== "boolean") return "serverVerified";
  if (x["verification"] !== "server" && x["verification"] !== "local") return "verification";
  if (x["solvedAt"] !== null && typeof x["solvedAt"] !== "string") return "solvedAt";
  if (typeof x["late"] !== "boolean") return "late";
  if (typeof x["assisted"] !== "boolean") return "assisted";
  if (x["hints"] !== undefined && !isInt(x["hints"], 0, 999)) return "hints";
  return null;
}

export const isDayProgress = (x: unknown): x is DayProgress => dayProgressProblem(x) === null;

/**
 * Не-null инвариант списка дней: остаются только записи, прошедшие `isDayProgress`; пропущенное — в `console.error`
 * с причиной (не молча: потеря записи видна в отладке, но не роняет экран). Если всё годно — возвращается тот же массив.
 */
export function sanitizeDays(list: readonly unknown[] | null | undefined, source = "days"): DayProgress[] {
  if (!Array.isArray(list)) return [];
  const bad: string[] = [];
  const good = list.filter((x) => {
    const why = dayProgressProblem(x);
    if (why !== null) bad.push(`${isObj(x) && typeof x["date"] === "string" ? x["date"] : "?"}: ${why}`);
    return why === null;
  });
  if (bad.length > 0) {
    console.error(`[pundoku] ${source}: пропущено нечитаемых записей дня — ${bad.length} из ${list.length} (${bad.slice(0, 5).join("; ")})`);
    return good;
  }
  return list as DayProgress[];
}

export interface ProgressRepository {
  getPermanent(): Promise<PermanentGridState | null>;
  savePermanent(state: PermanentGridState): Promise<void>;
  getDay(date: string): Promise<DayProgress | null>;
  saveDay(progress: DayProgress): Promise<void>;
}

/** Служебные данные синхронизации (`sync/`): токен устройства, версия снапшота, «грязный» флаг. */
export interface SyncStorage {
  /** Все дни с прогрессом (для сборки снапшота). */
  listDays(): Promise<DayProgress[]>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Записать, только если ключа ещё нет (защита от двух вкладок, регистрирующих устройство одновременно). Возвращает итоговое значение. */
  setMetaIfAbsent(key: string, value: unknown): Promise<unknown>;
  /**
   * PD-171: все записи `meta` с ключом, начинающимся с `prefix` (`[ключ без «meta:», значение]`): записи Лжеца дня
   * (`liar:YYYY-MM-DD`) для снапшота и Year. Необязательно: реализация без него — Лжеца дня в снапшоте/Year нет.
   */
  listMeta?(prefix: string): Promise<[string, unknown][]>;
}

export type PersistentStore = ProgressRepository & SyncStorage;

export class InMemoryProgressRepository implements PersistentStore {
  private permanent: PermanentGridState | null = null;
  private days = new Map<string, DayProgress>();
  private meta = new Map<string, unknown>();

  async listDays(): Promise<DayProgress[]> {
    return [...this.days.values()];
  }
  async getMeta(key: string): Promise<unknown> {
    return this.meta.has(key) ? structuredClone(this.meta.get(key)) : null;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, structuredClone(value));
  }
  async setMetaIfAbsent(key: string, value: unknown): Promise<unknown> {
    if (this.meta.get(key) == null) this.meta.set(key, structuredClone(value));
    return structuredClone(this.meta.get(key));
  }
  async listMeta(prefix: string): Promise<[string, unknown][]> {
    return [...this.meta.entries()].filter(([k, v]) => k.startsWith(prefix) && v != null).map(([k, v]): [string, unknown] => [k, structuredClone(v)]);
  }

  async getPermanent(): Promise<PermanentGridState | null> {
    return this.permanent;
  }
  async savePermanent(state: PermanentGridState): Promise<void> {
    this.permanent = state;
  }
  async getDay(date: string): Promise<DayProgress | null> {
    return this.days.get(date) ?? null;
  }
  async saveDay(progress: DayProgress): Promise<void> {
    this.days.set(progress.date, progress);
  }
}
