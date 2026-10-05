/**
 * Схема снапшота прогресса (PD-14): то, что уходит в `PUT /api/snapshot` как `data`.
 *
 * Сервер `data` не валидирует (jsonb, «объект» и лимит 1 МиБ) — схема живёт здесь, на клиенте.
 * Поля под экран Year заложены сразу (решения владельца 2026-09-29, STATUS «Решения владельца по Year»),
 * чтобы не мигрировать: `hadCorrections`, `assisted`, `late`, `status`.
 *
 * ```
 * data = {
 *   schemaVersion: 1,
 *   grid: { installSeed, index, cells: [{ cell, date }] } | null,   // Grid ∞: счётчики — производные от cells
 *   days: { "YYYY-MM-DD": DayRecord },
 *   liar?: { "YYYY-MM-DD": LiarDayRecord }   // PD-171, только если есть (`liarSchema.ts`)
 * }
 * ```
 */
import type { Difficulty, Digit, Move, MoveLog, TechniqueOrBeyond } from "@pundoku/engine";
import { DIFFICULTIES, blotsOf, heatmap, solve, summary } from "@pundoku/engine";
import type { PlayState } from "../play/logic";
import { CELLS } from "../play/logic";
import type { DaySource } from "../today/dayResolver";
import type { PermanentGridState } from "../today/permanent";
import type { DayProgress } from "../today/repository";
import { solvedAtOrDayStart } from "../today/repository";
import { decodeHeat, decodeMoveLog, encodeHeat, encodeMoveLog } from "./codec";
import type { LiarDayRecord } from "./liarSchema";
import { sanitizeLiar } from "./liarSchema";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Источник сетки в записи дня: `device` = сетка построена на устройстве без ответа API (`DaySource` «client»). */
export type RecordSource = "sudoku.com" | "generator" | "device";

export interface DayRecord {
  /** `solved` — решён; `unfinished` — начат (есть ходы), но не решён. Дни без ходов в снапшот не попадают. */
  status: "solved" | "unfinished";
  /** ISO 8601 UTC, момент решения. Только у `solved`. */
  solvedAt?: string;
  /** Время партии, мс: у `solved` — по последнему ходу лога, у `unfinished` — накопленное. */
  timeMs?: number;
  /** Самая дорогая техника (`summary.maxTechnique`); `null` — техники не размечены. Только у `solved`. */
  technique?: TechniqueOrBeyond | null;
  /** Были ли исправления или ошибки (`!summary.clean`) — булево для Year. */
  hadCorrections: boolean;
  /** Число правок (`summary.corrections`) — для строки «Corrections» на карточке дня; в Year не используется. */
  corrections?: number;
  /** «Решено с подсказкой» (PD-139): первая РЕЗУЛЬТАТИВНАЯ подсказка (техника/ошибка) ставит пометку; «ничего не нашёл» — нет. */
  assisted: boolean;
  /**
   * Сколько результативных подсказок взято (PD-139) — для подписи «N подсказок» на отпечатке и в шите дня. Только `> 0`
   * (у дня без подсказок поля нет: старые записи равны побайтно, схему не версионируем — как `ink`). Не выводится в `assisted`.
   */
  hints?: number;
  /** День сыгран после своей даты (архив); в Year остаётся «пропуском». */
  late: boolean;
  source: RecordSource;
  difficulty: Difficulty | null;
  /** 81 цифра (0 — пусто) — для сверки сетки. */
  mission: string;
  winRate?: number | null;
  /** Тепловая карта пути (`codec.encodeHeat`, 162 символа) — переживает бюджет `moveLog`. Только у `solved`. */
  heat?: string;
  /** Сжатый лог ходов (`codec.encodeMoveLog`); опционален, идёт с бюджетом размера (см. `applyMoveLogBudget`). */
  moveLog?: string;
  /**
   * Чернильный режим (PD-71): день сыгран без отмены/ластика. Только `true` (у обычного дня поля нет — старые записи
   * и записи без ink равны побайтно). Запись слияния атомарна: `ink`/`blots`/`moveLog` победителя не смешиваются с
   * проигравшим (`merge.ts`).
   */
  ink?: boolean;
  /** Число клякс (только при `ink`) — для сводки; переживает бюджет `moveLog`. Каждая клякса уже входит в `corrections`. */
  blots?: number;
}

export interface SnapshotData {
  schemaVersion: number;
  grid: PermanentGridState | null;
  days: Record<string, DayRecord>;
  /** PD-171: Лжец дня по датам. Нет раздела — нет Лжеца дня (старые снапшоты равны побайтно, схему не версионируем). */
  liar?: Record<string, LiarDayRecord>;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const emptySnapshotData = (): SnapshotData => ({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, grid: null, days: {} });

// ---- миграции «старее → новее» ---------------------------------------------------------------

/**
 * Каркас миграций: `MIGRATIONS[n]` переводит данные схемы `n` в схему `n + 1`. Схема 0 — то, что было
 * до PD-14 (пример из README api `{ grid: {}, year: {} }` и любые данные без `schemaVersion`): осмысленного
 * прогресса в ней не было, поэтому 0 → 1 даёт пустой снапшот. Новая схема = константа + функция здесь + тест.
 */
export const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  0: () => ({ schemaVersion: 1, grid: null, days: {} }),
};

export type ParsedSnapshot =
  | { ok: true; data: SnapshotData }
  /** Снапшот записан более новой версией приложения: читать нельзя, а перезаписывать — тем более. */
  | { ok: false; reason: "newer_schema"; schemaVersion: number }
  | { ok: false; reason: "invalid" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function migrateSnapshot(
  raw: unknown,
  target: number = SNAPSHOT_SCHEMA_VERSION,
  migrations: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = MIGRATIONS,
): ParsedSnapshot {
  if (!isObject(raw)) return { ok: false, reason: "invalid" };
  let cur: Record<string, unknown> = raw;
  const declared = cur["schemaVersion"];
  let version = typeof declared === "number" && Number.isInteger(declared) ? declared : 0;
  if (version > target) return { ok: false, reason: "newer_schema", schemaVersion: version };
  if (version < 0) return { ok: false, reason: "invalid" };
  while (version < target) {
    const step = migrations[version];
    if (!step) return { ok: false, reason: "invalid" };
    cur = step(cur);
    version++;
  }
  return { ok: true, data: sanitize(cur, target) };
}

// ---- проверка формы (данные с сервера считаем недоверенными) --------------------------------

export function sanitizeGrid(raw: unknown): PermanentGridState | null {
  if (!isObject(raw)) return null;
  const { installSeed, index, cells } = raw;
  if (typeof installSeed !== "string" || installSeed === "" || typeof index !== "number" || !Number.isInteger(index) || index < 0 || !Array.isArray(cells)) {
    return null;
  }
  const dates = new Set<string>();
  const usedCells = new Set<number>();
  const out: { cell: number; date: string }[] = [];
  for (const c of cells as unknown[]) {
    if (!isObject(c)) continue;
    const { cell, date } = c;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell >= CELLS) continue;
    if (typeof date !== "string" || !DATE_RE.test(date) || dates.has(date) || usedCells.has(cell)) continue;
    dates.add(date);
    usedCells.add(cell);
    out.push({ cell, date });
  }
  return { installSeed, index, cells: out };
}

export function sanitizeDayRecord(raw: unknown): DayRecord | null {
  if (!isObject(raw)) return null;
  const status = raw["status"];
  if (status !== "solved" && status !== "unfinished") return null;
  const mission = raw["mission"];
  if (typeof mission !== "string" || !/^[0-9]{81}$/.test(mission)) return null;
  const source = raw["source"];
  if (source !== "sudoku.com" && source !== "generator" && source !== "device") return null;
  const difficulty = DIFFICULTIES.includes(raw["difficulty"] as Difficulty) ? (raw["difficulty"] as Difficulty) : null;
  const rec: DayRecord = {
    status,
    hadCorrections: raw["hadCorrections"] === true,
    assisted: raw["assisted"] === true,
    late: raw["late"] === true,
    source,
    difficulty,
    mission,
  };
  const timeMs = raw["timeMs"];
  if (typeof timeMs === "number" && Number.isFinite(timeMs) && timeMs >= 0) rec.timeMs = timeMs;
  const corrections = raw["corrections"];
  if (typeof corrections === "number" && Number.isInteger(corrections) && corrections >= 0) rec.corrections = corrections;
  const winRate = raw["winRate"];
  if (typeof winRate === "number" && winRate >= 0 && winRate <= 100) rec.winRate = winRate;
  const hints = raw["hints"];
  if (typeof hints === "number" && Number.isInteger(hints) && hints > 0 && hints <= 999) rec.hints = hints;
  if (raw["ink"] === true) {
    rec.ink = true;
    const blots = raw["blots"];
    if (typeof blots === "number" && Number.isInteger(blots) && blots >= 0 && blots <= 81) rec.blots = blots;
  }
  if (status === "solved") {
    const solvedAt = raw["solvedAt"];
    if (typeof solvedAt !== "string" || !ISO_RE.test(solvedAt) || Number.isNaN(Date.parse(solvedAt))) return null;
    rec.solvedAt = solvedAt;
    const tech = raw["technique"];
    rec.technique = typeof tech === "string" ? (tech as TechniqueOrBeyond) : null;
    if (decodeHeat(raw["heat"])) rec.heat = raw["heat"] as string;
    if (decodeMoveLog(raw["moveLog"]) !== null) rec.moveLog = raw["moveLog"] as string;
  }
  return rec;
}

function sanitize(raw: Record<string, unknown>, schemaVersion: number): SnapshotData {
  const days: Record<string, DayRecord> = {};
  const rawDays = raw["days"];
  if (isObject(rawDays)) {
    for (const [date, rec] of Object.entries(rawDays)) {
      if (!DATE_RE.test(date)) continue;
      const r = sanitizeDayRecord(rec);
      if (r) days[date] = r;
    }
  }
  const liar = sanitizeLiar(raw["liar"]);
  return { schemaVersion, grid: sanitizeGrid(raw["grid"]), days, ...(Object.keys(liar).length > 0 ? { liar } : {}) };
}

// ---- DayProgress ⇄ DayRecord -----------------------------------------------------------------

const toRecordSource = (s: DaySource): RecordSource => (s === "client" ? "device" : s);
const fromRecordSource = (s: RecordSource): DaySource => (s === "device" ? "client" : s);

/**
 * Запись дня по локальному прогрессу. `null` — день без ходов (в снапшот не попадает).
 * `hadCorrections`/`corrections`/`technique`/`heat` считаются из `MoveLog` (`summary`, `heatmap` движка).
 * PD-197: решённый день без `solvedAt` (старая запись) выгружается с началом даты дня (`solvedAtOrDayStart`), а не с «сейчас»:
 * значение стабильно между циклами и устройствами, а схема (обязательный `solvedAt` у `solved`) не меняется — старые клиенты
 * такую запись принимают. `_now` оставлен ради совместимости сигнатуры.
 */
export function dayRecordFromProgress(p: DayProgress, _now: Date): DayRecord | null {
  const log = p.play.log;
  if (!p.solved && log.length === 0 && (p.hints ?? 0) === 0) return null; // подсказка без ходов — уже след дня (assisted)
  const sum = summary(log);
  const base = {
    hadCorrections: !sum.clean,
    corrections: sum.corrections,
    assisted: p.assisted,
    ...((p.hints ?? 0) > 0 ? { hints: p.hints } : {}),
    source: toRecordSource(p.source),
    difficulty: p.difficulty,
    mission: p.mission,
    ...(p.play.ink === true ? { ink: true, blots: blotsOf(log).length } : {}),
  };
  if (!p.solved) {
    return { status: "unfinished", timeMs: Math.round(p.elapsedMs), late: false, ...base };
  }
  const rec: DayRecord = {
    status: "solved",
    solvedAt: solvedAtOrDayStart(p),
    timeMs: sum.durationMs,
    technique: sum.maxTechnique,
    late: p.late,
    ...base,
    heat: encodeHeat(heatmap(log, { mission: p.mission, solution: p.play.solution.join("") })),
  };
  // Синтетический лог (восстановлен из `heat`, PD-70) за настоящий не выдаём: иначе после restore он ушёл бы
  // в снапшот как `moveLog` и вытеснил бы урезанную бюджетом запись.
  if (p.play.logSynthetic !== true) rec.moveLog = encodeMoveLog(log);
  if (p.winRate !== null) rec.winRate = p.winRate;
  return rec;
}

/**
 * Синтетический лог для решённого дня, у которого нет `moveLog` (не влез в бюджет снапшота): по `heat`
 * восстанавливает порядок и относительное время постановок, по `corrections` — число правок
 * (пары «поставил/стёр» в t = 0), по `technique` — самую дорогую технику. Карточка дня
 * (`heatmap`/`summary` движка) на нём показывает то же, что и по настоящему логу.
 */
export function logFromHeat(rec: DayRecord, solution: readonly number[]): MoveLog {
  const heat = decodeHeat(rec.heat);
  const timeMs = rec.timeMs ?? 0;
  const mission = [...rec.mission].map(Number);
  const placed = (heat ?? [])
    .map((h, cell) => ({ h, cell }))
    .filter((x): x is { h: number; cell: number } => x.h !== null && mission[x.cell] === 0)
    .sort((a, b) => a.h - b.h || a.cell - b.cell);
  const log: Move[] = [];
  // Ink (PD-71): кляксы — настоящие пары blot (неверная + авто-замена) на первых по времени клетках: правка и ошибка
  // считаются движком так же, как у настоящего лога; обычных «поставил/стёр» в ink-логе быть не должно.
  // PD-78: при ink и негодном/отсутствующем `blots` (санитайзер его выкидывает) число клякс берём из `corrections`
  // (либо 1 при hadCorrections), а не теряем правки; в любом случае не больше числа поставленных клеток.
  const validBlots = typeof rec.blots === "number" && Number.isInteger(rec.blots) && rec.blots >= 0 && rec.blots <= CELLS;
  const fallback = rec.corrections ?? (rec.hadCorrections ? 1 : 0);
  const blots = rec.ink === true ? Math.min(validBlots ? (rec.blots as number) : fallback, placed.length) : 0;
  const corrections = rec.ink === true ? 0 : fallback;
  const anyCell = placed[0]?.cell ?? mission.findIndex((g) => g === 0);
  if (anyCell >= 0) {
    for (let i = 0; i < corrections; i++) {
      log.push({ t: 0, cell: anyCell, kind: "place", digit: solution[anyCell] as Digit, correct: true });
      log.push({ t: 0, cell: anyCell, kind: "erase" });
    }
  }
  placed.forEach(({ h, cell }, i) => {
    if (i < blots) {
      const t = Math.round(h * timeMs);
      const right = solution[cell] as Digit;
      log.push({ t, cell, kind: "place", digit: ((right % 9) + 1) as Digit, correct: false, blot: true });
      log.push({ t, cell, kind: "place", digit: right, correct: true, blot: true });
      return;
    }
    log.push({
      t: Math.round(h * timeMs),
      cell,
      kind: "place",
      digit: solution[cell] as Digit,
      correct: true,
      ...(i === 0 && rec.technique ? { technique: rec.technique } : {}),
    });
  });
  return log;
}

/**
 * Локальный прогресс решённого дня из записи снапшота (восстановление после чистки IndexedDB и дни,
 * пришедшие с сервера). `null` — запись негодна (нет решения у `mission`) либо день не решён.
 */
export function progressFromRecord(date: string, rec: DayRecord): DayProgress | null {
  if (rec.status !== "solved") return null;
  const solved = solve(rec.mission);
  if (!solved) return null;
  const solution = solved.map(Number);
  const mission = [...rec.mission].map(Number);
  const values = mission.map((g, i) => (g ? 0 : (solution[i] as number)));
  const decoded = decodeMoveLog(rec.moveLog);
  const log = decoded ?? logFromHeat(rec, solution);
  const play: PlayState = {
    mission,
    solution,
    values,
    notes: new Array<number>(CELLS).fill(0),
    log,
    undoStack: [],
    solved: true,
    ...(rec.ink === true ? { ink: true } : {}),
    ...(decoded === null ? { logSynthetic: true as const } : {}),
  };
  return {
    date,
    mission: rec.mission,
    difficulty: rec.difficulty,
    source: fromRecordSource(rec.source),
    winRate: rec.winRate ?? null,
    play,
    elapsedMs: rec.timeMs ?? 0,
    solved: true,
    serverVerified: null,
    verification: "local",
    solvedAt: rec.solvedAt ?? null,
    late: rec.late,
    assisted: rec.assisted,
    ...(rec.hints !== undefined ? { hints: rec.hints } : {}),
  };
}

// ---- сборка данных снапшота ------------------------------------------------------------------

/** Бюджет на сжатые `moveLog` в снапшоте, символов (лимит сервера на весь `data` — 1 МиБ; остальное — заметно меньше). */
export const MOVE_LOG_BUDGET_CHARS = 600 * 1024;
/** Не меньше стольких последних решённых дней держат `moveLog` независимо от бюджета. */
export const MOVE_LOG_ALWAYS_LAST_DAYS = 7;
/** Лог одной партии длиннее этого (символов) в снапшот не идёт. */
export const MOVE_LOG_MAX_CHARS = 48 * 1024;

/**
 * Оставляет `moveLog` у решённых дней от новых к старым, пока суммарный размер ≤ бюджета (последние
 * `MOVE_LOG_ALWAYS_LAST_DAYS` — всегда). Остальным `moveLog` снимается: карточке дня достаточно `heat` + сводки,
 * полный лог нужен только будущему Таймлапсу и хранится локально.
 */
export function applyMoveLogBudget<R extends { status: string; moveLog?: string }>(
  days: Record<string, R>,
  budget: number = MOVE_LOG_BUDGET_CHARS,
  alwaysLast: number = MOVE_LOG_ALWAYS_LAST_DAYS,
): Record<string, R> {
  const solvedDesc = Object.keys(days)
    .filter((d) => days[d]!.status === "solved")
    .sort()
    .reverse();
  const keep = new Set<string>();
  let used = 0;
  solvedDesc.forEach((date, i) => {
    const len = days[date]!.moveLog?.length ?? 0;
    if (len === 0 || len > MOVE_LOG_MAX_CHARS) return;
    if (i < alwaysLast || used + len <= budget) {
      keep.add(date);
      used += len;
    }
  });
  const out: Record<string, R> = {};
  for (const [date, rec] of Object.entries(days)) {
    if (rec.moveLog !== undefined && !keep.has(date)) {
      const rest = { ...rec };
      delete rest.moveLog;
      out[date] = rest;
    } else out[date] = rec;
  }
  return out;
}

export function buildSnapshotData(
  local: { grid: PermanentGridState | null; days: Record<string, DayRecord>; liar?: Record<string, LiarDayRecord> },
  moveLogBudget: number = MOVE_LOG_BUDGET_CHARS,
  alwaysLast: number = MOVE_LOG_ALWAYS_LAST_DAYS,
): SnapshotData {
  // PD-171: логи Лжеца дня — свой бюджет (десятая часть общего): партия Лжеца бывает раз в день, а дни остаются главными.
  const liar = local.liar && Object.keys(local.liar).length > 0 ? applyMoveLogBudget(local.liar, Math.floor(moveLogBudget / 10), alwaysLast) : null;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    grid: local.grid,
    days: applyMoveLogBudget(local.days, moveLogBudget, alwaysLast),
    ...(liar ? { liar } : {}),
  };
}
