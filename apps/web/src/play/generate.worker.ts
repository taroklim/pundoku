/**
 * Web Worker генерации сетки Play (PD-11). `generate()` для hard/expert бывает секундами —
 * на главном потоке это заморозило бы UI. Протокол — `GenerateRequest` → `GenerateResponse`.
 */
import type { Difficulty } from "@pundoku/engine";
import { dailyPuzzle, generate } from "@pundoku/engine";

/**
 * Либо случайная партия Play (`seed`), либо клиентский фолбэк сетки дня (`date`): тогда сетка
 * строится ТОЛЬКО через `dailyPuzzle(date, difficulty)` (единая seed-конвенция с сервером).
 */
export type GenerateRequest =
  | { id: number; difficulty: Difficulty; seed: string; date?: undefined }
  | { id: number; difficulty: Difficulty; date: string; seed?: undefined };

export type GenerateResponse =
  | { id: number; ok: true; puzzle: { mission: string; solution: string; difficulty: Difficulty; seed: string } }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const req = event.data;
  const { id, difficulty } = req;
  try {
    const p = req.date !== undefined ? dailyPuzzle(req.date, difficulty) : generate({ difficulty, seed: req.seed });
    const res: GenerateResponse = {
      id,
      ok: true,
      puzzle: { mission: p.mission, solution: p.solution, difficulty: p.difficulty, seed: p.seed },
    };
    self.postMessage(res);
  } catch (err) {
    const res: GenerateResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
