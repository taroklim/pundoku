/**
 * Раздел `liar` снапшота (PD-171, план режимов §1.3): Лжец дня по датам. Схему НЕ версионируем (прецедент `ink`/`hints`):
 * у снапшота без Лжеца дня раздела нет вовсе — старые снапшоты равны побайтно, старый клиент поле просто не читает.
 *
 * ```
 * data.liar = { "YYYY-MM-DD": LiarDayRecord }   // только дни с прогрессом (ход или обвинение)
 * ```
 *
 * В записи — `mission` С ЛОЖЬЮ (как её видел игрок: при дрейфе версии генератора история не ломается) и итоги поимки; секрет
 * (клетка лжеца, решение) не хранится — он выводится из `mission` (`validateLiar`) при восстановлении. Лог ходов — с бюджетом,
 * как у дней (`moveLog`). Слияние — атомарная запись (`pickLiarRecord`), как у ink.
 */
import type { Difficulty, Digit } from "@pundoku/engine";
import { DIFFICULTIES, validateLiar } from "@pundoku/engine";
import { liarInfoOf, packAccusations, parseSavedLiarDay } from "../play/savedPlay";
import type { SavedPlay } from "../play/savedPlay";
import { CELLS } from "../play/logic";
import { solvedAtOrDayStart } from "../today/repository";
import { decodeMoveLog, encodeMoveLog } from "./codec";

export interface LiarDayRecord {
  status: "solved" | "unfinished";
  /** ISO 8601 UTC, момент решения. Только у `solved`. */
  solvedAt?: string;
  /** Время партии, мс. */
  timeMs?: number;
  difficulty: Difficulty;
  /** 81 цифра сетки С ЛОЖЬЮ (0 — пусто). */
  mission: string;
  caught: boolean;
  /** «Ход обвинения»: сколько цифр поставлено до поимки. Только у пойманного. */
  catchPlacement?: number;
  /** Время поимки, мс. Только у пойманного. */
  catchT?: number;
  wrongAccusations: number;
  firstTry: boolean;
  /** Обвинения `[t, клетка, moveIndex]` — для таймлапса (слой обвинений) при восстановлении. */
  accusations?: [number, number, number][];
  /** Сжатый лог ходов (`codec.encodeMoveLog`); с бюджетом размера, как у дней. */
  moveLog?: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNat = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Запись с сервера (недоверенная) → `LiarDayRecord` или `null`. */
export function sanitizeLiarRecord(raw: unknown): LiarDayRecord | null {
  if (!isObject(raw)) return null;
  const status = raw["status"];
  if (status !== "solved" && status !== "unfinished") return null;
  const mission = raw["mission"];
  if (typeof mission !== "string" || !/^[0-9]{81}$/.test(mission)) return null;
  const difficulty = raw["difficulty"];
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) return null;
  const rec: LiarDayRecord = {
    status,
    difficulty: difficulty as Difficulty,
    mission,
    caught: raw["caught"] === true,
    wrongAccusations: isNat(raw["wrongAccusations"], 81) ? raw["wrongAccusations"] : 0,
    firstTry: raw["firstTry"] === true,
  };
  if (typeof raw["timeMs"] === "number" && Number.isFinite(raw["timeMs"]) && raw["timeMs"] >= 0) rec.timeMs = raw["timeMs"];
  if (rec.caught) {
    if (isNat(raw["catchPlacement"], CELLS)) rec.catchPlacement = raw["catchPlacement"];
    if (typeof raw["catchT"] === "number" && Number.isFinite(raw["catchT"]) && raw["catchT"] >= 0) rec.catchT = raw["catchT"];
  }
  const acc = raw["accusations"];
  if (Array.isArray(acc) && acc.length <= CELLS && acc.every((a) => Array.isArray(a) && a.length === 3 && isNat(a[0]) && isNat(a[1], CELLS - 1) && isNat(a[2]))) {
    rec.accusations = acc as [number, number, number][];
  }
  if (status === "solved") {
    const solvedAt = raw["solvedAt"];
    if (typeof solvedAt !== "string" || !ISO_RE.test(solvedAt) || Number.isNaN(Date.parse(solvedAt))) return null;
    rec.solvedAt = solvedAt;
    if (!rec.caught) return null; // решить Лжеца без поимки нельзя — запись испорчена
  }
  if (decodeMoveLog(raw["moveLog"]) !== null) rec.moveLog = raw["moveLog"] as string;
  return rec;
}

export function sanitizeLiar(raw: unknown): Record<string, LiarDayRecord> {
  const out: Record<string, LiarDayRecord> = {};
  if (!isObject(raw)) return out;
  for (const [date, rec] of Object.entries(raw)) {
    if (!DATE_RE.test(date)) continue;
    const r = sanitizeLiarRecord(rec);
    if (r) out[date] = r;
  }
  return out;
}

/** Исходная сетка (с ложью) партии Лжеца дня. */
function missionWithLie(saved: SavedPlay): string {
  const m = saved.play.mission.slice();
  if (saved.play.liar) m[saved.play.liar.liarCell] = saved.play.liar.liarDigit;
  return m.join("");
}

/**
 * Запись снапшота по локальной записи Лжеца дня. `null` — без прогресса (ни хода, ни обвинения): в снапшот не идёт.
 * PD-197: решённая партия без `solvedAt` выгружается с началом даты дня (`solvedAtOrDayStart`), а не с «сейчас» — как дни
 * в `dayRecordFromProgress`: значение стабильно между циклами и устройствами (иначе каждый синк давал бы новую запись, а
 * слияние «раньше — сильнее» зависело бы от того, какое устройство выгрузило первым); схема не меняется. `_now` оставлен
 * ради совместимости сигнатуры.
 */
export function liarRecordFromSaved(saved: SavedPlay & { daily: string }, _now: Date): LiarDayRecord | null {
  const play = saved.play;
  const acc = play.accusations ?? [];
  if (!play.solved && play.log.length === 0 && acc.length === 0) return null;
  const info = liarInfoOf(saved);
  const solved = play.solved && info?.caught === true;
  const rec: LiarDayRecord = {
    status: solved ? "solved" : "unfinished",
    timeMs: Math.round(saved.elapsedMs),
    difficulty: saved.difficulty,
    mission: missionWithLie(saved),
    caught: info?.caught === true,
    wrongAccusations: info?.wrongAccusations ?? 0,
    firstTry: info?.firstTry === true,
  };
  if (rec.caught) {
    if (info?.catchPlacement !== null && info?.catchPlacement !== undefined) rec.catchPlacement = info.catchPlacement;
    if (info?.catchT !== null && info?.catchT !== undefined) rec.catchT = Math.round(info.catchT);
  }
  if (acc.length > 0) rec.accusations = packAccusations(acc);
  if (solved) {
    rec.solvedAt = solvedAtOrDayStart({ date: saved.daily, solvedAt: saved.solvedAt ?? null });
    if (play.log.length > 0 && play.logSynthetic !== true) rec.moveLog = encodeMoveLog(play.log);
  }
  return rec;
}

/**
 * Локальная запись Лжеца дня из записи снапшота (восстановление после чистки хранилища, другое устройство). Только решённые
 * (как у дней: незаконченную партию с сервера не продолжить без настоящего состояния). Секрет выводится из `mission`
 * (`validateLiar`: единственная подсказка, без которой решение одно); не выводится — `null`. Лог не воспроизводится в
 * решение — партия без лога (`liarInfo` хранит метрики, таймлапса нет).
 */
export function savedFromLiarRecord(date: string, rec: LiarDayRecord): (SavedPlay & { daily: string }) | null {
  if (rec.status !== "solved" || !rec.caught) return null;
  let liarCell: number | null;
  let solution: string | null;
  try {
    const v = validateLiar(rec.mission, { minDepth: 0 });
    liarCell = v.liarCell;
    solution = v.solution;
  } catch {
    return null;
  }
  if (liarCell === null || solution === null) return null;
  const sol = [...solution].map(Number);
  const lie = [...rec.mission].map(Number);
  const trueDigit = sol[liarCell] as Digit;
  const liarDigit = lie[liarCell] as Digit;
  const honest = lie.slice();
  honest[liarCell] = 0;
  const mission = lie.slice();
  mission[liarCell] = trueDigit;
  const decoded = decodeMoveLog(rec.moveLog);
  const log = decoded ?? [];
  const accusations = (rec.accusations ?? []).filter((a) => a[2] <= log.length).map(([t, cell, moveIndex]) => ({ t, cell, moveIndex }));
  const caughtInAcc = accusations.some((a) => a.cell === liarCell);
  const raw = {
    v: 1,
    mode: "liar",
    difficulty: rec.difficulty,
    startedOn: rec.solvedAt ?? `${date}T12:00:00.000Z`,
    play: {
      mission,
      solution: sol,
      values: mission.map((g, i) => (g ? 0 : (sol[i] as number))),
      notes: new Array<number>(CELLS).fill(0),
      log,
      undoStack: [],
      solved: true,
      liar: { liarCell, liarDigit, trueDigit, honestMission: honest.join("") },
      // Обвинения нужны таймлапсу; без верного (урезаны вместе с логом) — подставляем его в конец, иначе партия «не поймана».
      accusations: caughtInAcc ? accusations : [...accusations, { t: rec.catchT ?? rec.timeMs ?? 0, cell: liarCell, moveIndex: log.length }],
    },
    elapsedMs: rec.timeMs ?? 0,
    selected: null,
    notesMode: false,
    daily: date,
    solvedAt: rec.solvedAt ?? null,
    liarInfo: {
      caught: true,
      wrongAccusations: rec.wrongAccusations,
      firstTry: rec.firstTry,
      catchT: rec.catchT ?? null,
      catchPlacement: rec.catchPlacement ?? null,
    },
  };
  return parseSavedLiarDay(raw, date);
}

/** Атомарный выбор записи одного дня (как `pickDayRecord`): решённая сильнее; обе решены — раньше; иначе — дальше по времени. */
export function pickLiarRecord(a: LiarDayRecord, b: LiarDayRecord): LiarDayRecord {
  if (a.status !== b.status) return a.status === "solved" ? a : b;
  if (a.status === "solved") {
    const ta = Date.parse(a.solvedAt ?? "");
    const tb = Date.parse(b.solvedAt ?? "");
    if (ta !== tb) return ta < tb ? a : b;
    const la = a.moveLog?.length ?? 0;
    const lb = b.moveLog?.length ?? 0;
    if ((la > 0) !== (lb > 0)) return la > 0 ? a : b;
  } else {
    const ta = a.timeMs ?? 0;
    const tb = b.timeMs ?? 0;
    if (ta !== tb) return ta > tb ? a : b;
  }
  return canonical(a) <= canonical(b) ? a : b;
}

export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : val,
  );

export function mergeLiar(a: Record<string, LiarDayRecord> | undefined, b: Record<string, LiarDayRecord> | undefined): Record<string, LiarDayRecord> {
  const out: Record<string, LiarDayRecord> = { ...(a ?? {}) };
  for (const [date, rec] of Object.entries(b ?? {})) {
    const mine = out[date];
    out[date] = mine ? pickLiarRecord(mine, rec) : rec;
  }
  return out;
}

export const sameLiar = (a: Record<string, LiarDayRecord> | undefined, b: Record<string, LiarDayRecord> | undefined): boolean => {
  const ka = Object.keys(a ?? {});
  if (ka.length !== Object.keys(b ?? {}).length) return false;
  return ka.every((d) => canonical(a?.[d]) === canonical(b?.[d]));
};

/** Записи Лжеца дня из хранилища (`meta:liar:*`) → записи снапшота. */
export function liarRecordsFromMeta(entries: readonly [string, unknown][], now: Date): Record<string, LiarDayRecord> {
  const out: Record<string, LiarDayRecord> = {};
  for (const [key, value] of entries) {
    const date = key.slice("liar:".length);
    if (!DATE_RE.test(date)) continue;
    const saved = parseSavedLiarDay(value, date);
    if (!saved) continue;
    const rec = liarRecordFromSaved(saved, now);
    if (rec) out[date] = rec;
  }
  return out;
}
