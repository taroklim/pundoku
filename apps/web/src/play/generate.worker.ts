/**
 * Web Worker генерации сетки Play (PD-11). `generate()` для hard/expert бывает секундами —
 * на главном потоке это заморозило бы UI. Протокол — `GenerateRequest` → `GenerateResponse`.
 *
 * PD-171: тот же Worker строит сетки Лжеца (`liar: true`) — `generateLiar` / `dailyLiarPuzzle` (план режимов §1.2/§1.5).
 * Секрет Лжеца уходит только в хранилище партии, в UI его читают через `play/liar.ts`.
 */
import type { Difficulty, Digit } from "@pundoku/engine";
import { LIAR_VERSION, dailyLiarPuzzle, dailyPuzzle, generate, generateLiar } from "@pundoku/engine";

/**
 * Либо случайная партия Play (`seed`), либо клиентский фолбэк сетки дня (`date`): тогда сетка
 * строится ТОЛЬКО через `dailyPuzzle(date, difficulty)` (единая seed-конвенция с сервером).
 * `liar: true` — то же для Лжеца: `generateLiar({ difficulty, seed })` либо Лжец дня `dailyLiarPuzzle(date, difficulty)`.
 */
export type GenerateRequest =
  | { id: number; difficulty: Difficulty; seed: string; date?: undefined; liar?: boolean }
  | { id: number; difficulty: Difficulty; date: string; seed?: undefined; liar?: boolean };

/** Секрет сетки Лжеца (`LiarPuzzle` без меты). `version` — `LIAR_VERSION` движка, которым она построена. */
export interface LiarPart {
  readonly liarCell: number;
  readonly liarDigit: Digit;
  readonly trueDigit: Digit;
  readonly honestMission: string;
  readonly version: number;
}

export interface GeneratedPuzzle {
  mission: string;
  solution: string;
  difficulty: Difficulty;
  seed: string;
  liar?: LiarPart;
}

export type GenerateResponse = { id: number; ok: true; puzzle: GeneratedPuzzle } | { id: number; ok: false; error: string };

/** Сетка по запросу (вынесено из обработчика — тестируется без Worker). */
export function buildPuzzle(req: GenerateRequest): GeneratedPuzzle {
  const { difficulty } = req;
  if (req.liar === true) {
    const p = req.date !== undefined ? dailyLiarPuzzle(req.date, difficulty) : generateLiar({ difficulty, seed: req.seed });
    return {
      mission: p.mission,
      solution: p.solution,
      difficulty: p.difficulty,
      seed: p.seed,
      liar: { liarCell: p.liarCell, liarDigit: p.liarDigit, trueDigit: p.trueDigit, honestMission: p.honestMission, version: LIAR_VERSION },
    };
  }
  const p = req.date !== undefined ? dailyPuzzle(req.date, difficulty) : generate({ difficulty, seed: req.seed });
  return { mission: p.mission, solution: p.solution, difficulty: p.difficulty, seed: p.seed };
}

// В тестах модуль импортируется ради `buildPuzzle` — обработчик вешаем только в настоящем Worker.
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (event: MessageEvent<GenerateRequest>) => {
    const req = event.data;
    try {
      const res: GenerateResponse = { id: req.id, ok: true, puzzle: buildPuzzle(req) };
      self.postMessage(res);
    } catch (err) {
      const res: GenerateResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
      self.postMessage(res);
    }
  };
}
