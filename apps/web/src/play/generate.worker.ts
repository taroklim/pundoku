/**
 * Web Worker генерации сетки Play (PD-11). `generate()` для hard/expert бывает секундами —
 * на главном потоке это заморозило бы UI. Протокол — `GenerateRequest` → `GenerateResponse`.
 */
import type { Difficulty } from "@pundoku/engine";
import { generate } from "@pundoku/engine";

export interface GenerateRequest {
  id: number;
  difficulty: Difficulty;
  seed: string;
}

export type GenerateResponse =
  | { id: number; ok: true; puzzle: { mission: string; solution: string; difficulty: Difficulty; seed: string } }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const { id, difficulty, seed } = event.data;
  try {
    const p = generate({ difficulty, seed });
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
