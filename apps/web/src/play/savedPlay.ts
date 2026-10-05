/**
 * Формат записи партии Play в хранилище (PD-116 → PD-167 → PD-171) — отдельно от `store.ts`, чтобы его читали и синхронизация
 * (Лжец дня, `sync/`), и Year без импорта боевого стора (тот тянет за собой IndexedDB-рантайм).
 *
 * PD-171: партия Лжеца — та же запись, `play` дополнительно несёт `liar` (секрет) и `accusations`. Лжец дня — та же запись
 * под ключом `meta:liar:YYYY-MM-DD` (`liarDayKey`) с полями `daily` и `solvedAt`; она не удаляется после решения (Year,
 * снапшот). Свободная партия Лжеца — слот режима `playGame:liar`, как у остальных режимов.
 */
import type { Accusation, Difficulty, LiarSummary } from "@pundoku/engine";
import { DIFFICULTIES } from "@pundoku/engine";
import type { SlotSummary } from "./daySlot";
import { liarSummaryOf } from "./liar";
import type { PlayState } from "./logic";
import { CELLS, cellsLeft } from "./logic";
import type { ModeId } from "./modes";
import { isModeId, legacyModeOf } from "./modes";

/** Запись партии Play. Структура клонируема (IndexedDB/structuredClone); `v` — версия формата. */
export interface SavedPlay {
  readonly v: 1;
  /** PD-167: режим партии. Записи до PD-167 его не имеют — режим выводится из партии (`legacyModeOf`). */
  readonly mode?: ModeId;
  readonly difficulty: Difficulty;
  /** ISO-момент старта (подпись дня на экране Play). */
  readonly startedOn: string;
  readonly play: PlayState;
  /** Накопленное «тихое» время партии, мс (у решённой — время последнего хода). */
  readonly elapsedMs: number;
  readonly selected: number | null;
  readonly notesMode: boolean;
  /** PD-139: результативных подсказок в партии и пометка «с помощью» (опционально: записи без них читаются как 0/false). */
  readonly hints?: number;
  readonly assisted?: boolean;
  /** PD-171: Лжец дня — дата `YYYY-MM-DD` (запись под `liarDayKey(date)`); у свободных партий поля нет. */
  readonly daily?: string;
  /** PD-171: Лжец дня — момент решения (ISO UTC); `null`/нет — не решён. */
  readonly solvedAt?: string | null;
  /**
   * PD-171: метрики Лжеца, восстановленные из снапшота (`sync/schema.ts`), когда у записи нет настоящего лога ходов. Есть лог —
   * метрики считаются из партии (`liarSummaryOf`), это поле не нужно.
   */
  readonly liarInfo?: LiarInfo;
}

/** Метрики Лжеца дня для карточки/Year (подмножество `LiarSummary`, переживает потерю лога). */
export type LiarInfo = Pick<LiarSummary, "caught" | "wrongAccusations" | "firstTry" | "catchT" | "catchPlacement">;

/** Ключ записи Лжеца дня в `meta`. */
export const liarDayKey = (date: string): string => `liar:${date}`;
export const LIAR_DAY_PREFIX = "liar:";

const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.length === CELLS && v.every((n) => Number.isInteger(n));
const isDigit = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 9;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Секрет Лжеца и обвинения в порядке (`null` — годится). Мусор = запись не восстанавливается, а не роняет экран. */
function liarProblem(p: Partial<PlayState>): string | null {
  const liar = p.liar as unknown;
  if (liar === undefined) return p.accusations === undefined ? null : "accusations without liar";
  if (typeof liar !== "object" || liar === null) return "liar";
  const l = liar as Record<string, unknown>;
  const cell = l["liarCell"];
  if (!Number.isInteger(cell) || (cell as number) < 0 || (cell as number) >= CELLS) return "liar.liarCell";
  if (!isDigit(l["liarDigit"]) || !isDigit(l["trueDigit"]) || l["liarDigit"] === l["trueDigit"]) return "liar.digits";
  if (typeof l["honestMission"] !== "string" || !/^[0-9]{81}$/.test(l["honestMission"])) return "liar.honestMission";
  const shown = (p.mission as number[])[cell as number];
  if (shown !== l["liarDigit"] && shown !== l["trueDigit"]) return "liar.mission";
  const acc = p.accusations as unknown;
  if (!Array.isArray(acc)) return "accusations";
  const logLen = (p.log as unknown[]).length;
  for (const a of acc as unknown[]) {
    if (typeof a !== "object" || a === null) return "accusations[]";
    const r = a as Record<string, unknown>;
    if (typeof r["t"] !== "number" || !Number.isFinite(r["t"]) || r["t"] < 0) return "accusations[].t";
    if (!Number.isInteger(r["cell"]) || (r["cell"] as number) < 0 || (r["cell"] as number) >= CELLS) return "accusations[].cell";
    if (!Number.isInteger(r["moveIndex"]) || (r["moveIndex"] as number) < 0 || (r["moveIndex"] as number) > logLen) return "accusations[].moveIndex";
  }
  return null;
}

function parseLiarInfo(raw: unknown): LiarInfo | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const nn = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  if (typeof r["caught"] !== "boolean") return undefined;
  const wrong = r["wrongAccusations"];
  return {
    caught: r["caught"],
    firstTry: r["firstTry"] === true,
    wrongAccusations: Number.isInteger(wrong) && (wrong as number) >= 0 ? (wrong as number) : 0,
    catchT: nn(r["catchT"]),
    catchPlacement: nn(r["catchPlacement"]),
  };
}

/**
 * Разобрать запись из хранилища; всё подозрительное — `null` (партия просто не восстановится, а не уронит экран).
 * `slot` — режим слота, из которого прочитана запись: он главнее поля `mode`. Запись неизвестного этой версии режима — `null`.
 * Партия Лжеца (`mode: liar`) обязана нести целый секрет; у других режимов его быть не может.
 */
export function parseSavedPlay(raw: unknown, slot?: ModeId): SavedPlay | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<Record<keyof SavedPlay, unknown>>;
  const p = r.play as Partial<PlayState> | undefined;
  if (r.v !== 1 || typeof p !== "object" || p === null) return null;
  if (!isNumArray(p.mission) || !isNumArray(p.solution) || !isNumArray(p.values) || !isNumArray(p.notes)) return null;
  if (!Array.isArray(p.log) || !Array.isArray(p.undoStack) || typeof p.solved !== "boolean") return null;
  if (!DIFFICULTIES.includes(r.difficulty as Difficulty)) return null;
  if (typeof r.elapsedMs !== "number" || !Number.isFinite(r.elapsedMs) || r.elapsedMs < 0) return null;
  if (typeof r.startedOn !== "string" || Number.isNaN(Date.parse(r.startedOn))) return null;
  if (r.mode !== undefined && !isModeId(r.mode)) return null;
  if (liarProblem(p) !== null) return null;
  const mode: ModeId = slot ?? (isModeId(r.mode) ? r.mode : p.liar ? "liar" : legacyModeOf(p as PlayState));
  if ((mode === "liar") !== (p.liar !== undefined)) return null;
  if (r.daily !== undefined && (typeof r.daily !== "string" || !DATE_RE.test(r.daily) || mode !== "liar")) return null;
  const selected = typeof r.selected === "number" && Number.isInteger(r.selected) && r.selected >= 0 && r.selected < CELLS ? r.selected : null;
  const hints = typeof r.hints === "number" && Number.isInteger(r.hints) && r.hints > 0 && r.hints <= 999 ? r.hints : 0;
  const assisted = r.assisted === true || hints > 0; // подсказки без пометки — порча записи: пометка важнее
  const solvedAt = typeof r.solvedAt === "string" && !Number.isNaN(Date.parse(r.solvedAt)) ? r.solvedAt : null;
  const liarInfo = parseLiarInfo(r.liarInfo);
  return {
    v: 1,
    mode,
    difficulty: r.difficulty as Difficulty,
    startedOn: r.startedOn,
    play: p as PlayState,
    elapsedMs: r.elapsedMs,
    selected,
    notesMode: r.notesMode === true,
    ...(hints > 0 ? { hints } : {}),
    ...(assisted ? { assisted: true } : {}),
    ...(typeof r.daily === "string" ? { daily: r.daily, solvedAt } : {}),
    ...(liarInfo ? { liarInfo } : {}),
  };
}

/** Запись Лжеца дня (`meta:liar:<date>`); не Лжец дня — `null`. */
export function parseSavedLiarDay(raw: unknown, date?: string): (SavedPlay & { daily: string }) | null {
  const rec = parseSavedPlay(raw, "liar");
  if (!rec || rec.daily === undefined || (date !== undefined && rec.daily !== date)) return null;
  return rec as SavedPlay & { daily: string };
}

/** Сводка слота для строки хаба. */
export function summaryOf(saved: SavedPlay): SlotSummary {
  return { difficulty: saved.difficulty, left: cellsLeft(saved.play), elapsedMs: saved.elapsedMs, ink: saved.play.ink === true };
}

/** Метрики Лжеца записи: из партии (есть настоящий лог), иначе восстановленные из снапшота. */
export function liarInfoOf(saved: SavedPlay): LiarInfo | null {
  if (saved.play.log.length > 0 || !saved.liarInfo) {
    const s = liarSummaryOf(saved.play);
    if (s) return { caught: s.caught, wrongAccusations: s.wrongAccusations, firstTry: s.firstTry, catchT: s.catchT, catchPlacement: s.catchPlacement };
  }
  return saved.liarInfo ?? null;
}

/** Обвинения записи (для снапшота) — компактно: `[t, cell, moveIndex]`. */
export const packAccusations = (a: readonly Accusation[]): [number, number, number][] => a.map((x) => [Math.round(x.t), x.cell, x.moveIndex]);
