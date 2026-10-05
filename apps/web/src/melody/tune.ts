/**
 * «Мелодия пути» для карточки и таймлапса (PD-203; ритм — макет PD-202 §2 п. 9).
 *
 * Ноты — итоговые собственные постановки в порядке пути (`melodyOf` движка). Закрытый юнит в пути — не арпеджио, а
 * **акцент** ноты, которая его закрыла (громче и длиннее; на карточке — ещё вдох 120 мс после неё).
 *
 * - Карточка ({@link cardTuneOf}): реальные паузы сжимаются логарифмически в 0,19–0,45 с, весь трек ≤ 18 с.
 * - Таймлапс ({@link timelapseTuneOf}): нота каждой постановки стоит ровно на смещении её кадра в расписании плеера —
 *   мелодия идёт за кадрами при любой скорости (проигрывание — `playPath(…, { fromMs })` с позиции ползунка).
 *
 * `null` — мелодии нет (лог урезан/синтетический/неполный): кнопки «Сыграть мелодию» и звука в плеере скрыты.
 */
import type { MelodyEvent, TimelapseFrame } from "@pundoku/engine";
import { melodyOf } from "@pundoku/engine";
import type { PlayState } from "../play/logic";

export interface TuneNote {
  /** Мс от начала трека. */
  readonly t: number;
  readonly kind: "note";
  readonly digit: number;
  readonly cell: number;
  /** Нота закрыла строку/столбец/блок. */
  readonly accent: boolean;
}

export const TUNE_MAX_MS = 18_000;
export const TUNE_GAP_MAX_MS = 450;
export const TUNE_BREATH_MS = 120;

/** События `melodyOf` в реальном времени партии (без сжатия пауз) или `null`. */
function rawMelody(play: PlayState): MelodyEvent[] | null {
  try {
    return melodyOf(
      play.log,
      { mission: play.mission.join(""), solution: play.solution.join("") },
      { maxGapMs: Infinity, synthetic: play.logSynthetic === true },
    );
  } catch {
    return null; // повреждённый лог — мелодии нет, карточка не падает
  }
}

/** Ноты с пометкой акцента (за нотой в `melodyOf` следуют арпеджио юнитов, которые она закрыла). */
function notesOf(events: readonly MelodyEvent[]): { t: number; digit: number; cell: number; accent: boolean }[] {
  const out: { t: number; digit: number; cell: number; accent: boolean }[] = [];
  for (const e of events) {
    if (e.kind === "note") out.push({ t: e.t, digit: e.digit, cell: e.cell, accent: false });
    else if (out.length > 0) out[out.length - 1]!.accent = true;
  }
  return out;
}

/** Есть ли у партии мелодия пути (для показа кнопки). */
export function hasTune(play: PlayState): boolean {
  const ev = rawMelody(play);
  return ev !== null && ev.length > 0;
}

/** Мелодия для карточки: сжатый ритм, вдох после акцента, ≤ 18 с. */
export function cardTuneOf(play: PlayState): TuneNote[] | null {
  const ev = rawMelody(play);
  if (ev === null) return null;
  const notes = notesOf(ev);
  if (notes.length === 0) return null;
  const out: TuneNote[] = [];
  let t = 0;
  notes.forEach((n, k) => {
    if (k > 0) {
      const realSec = Math.max(0, n.t - notes[k - 1]!.t) / 1000;
      t += Math.min(TUNE_GAP_MAX_MS, 120 + 70 * Math.log2(1 + realSec));
      if (notes[k - 1]!.accent) t += TUNE_BREATH_MS;
    }
    out.push({ t, kind: "note", digit: n.digit, cell: n.cell, accent: n.accent });
  });
  const total = out[out.length - 1]!.t;
  if (total <= TUNE_MAX_MS) return out.map((n) => ({ ...n, t: Math.round(n.t) }));
  const k = TUNE_MAX_MS / total;
  return out.map((n) => ({ ...n, t: Math.round(n.t * k) }));
}

/**
 * Мелодия для плеера таймлапса: нота на смещении кадра своей постановки. `frames` — кадры `timelapseOf(…, { maxGapMs:
 * Infinity })` (то же реальное время, что у `melodyOf` здесь), `offsets` — `playbackSchedule(frames, …).offsets`.
 * Возвращает и `frame` — номер кадра ноты (шаг «‹ / ›» играет ноту своего хода).
 */
export function timelapseTuneOf(
  play: PlayState,
  frames: readonly TimelapseFrame[],
  offsets: readonly number[],
): (TuneNote & { readonly frame: number })[] | null {
  const ev = rawMelody(play);
  if (ev === null) return null;
  const out: (TuneNote & { frame: number })[] = [];
  let from = 1;
  for (const n of notesOf(ev)) {
    // Кадр постановки: тот же момент и клетка, цифра в кадре — эта; последний такой (перезапись в ту же миллисекунду).
    let frame = -1;
    for (let j = from; j < frames.length; j++) {
      const f = frames[j]!;
      if (f.t > n.t) break;
      if (f.t === n.t && f.cell === n.cell && f.values[n.cell] === n.digit) frame = j;
    }
    if (frame < 0) return null; // лог не сходится с кадрами — лучше без звука, чем вразнобой
    from = frame;
    out.push({ t: offsets[frame] ?? 0, kind: "note", digit: n.digit, cell: n.cell, accent: n.accent, frame });
  }
  return out.length > 0 ? out : null;
}
