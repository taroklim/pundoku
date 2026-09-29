/**
 * Хранилище партии Play (PD-11). Прогресс — только в памяти (IndexedDB — PD-14): перезагрузка =
 * новая партия. Общая механика (ввод, undo, таймер, анимации) — `GameStore`; здесь — источник
 * сетки: генерация в Web Worker (`generate()` для hard/expert бывает секундами).
 */
import type { Difficulty } from "@pundoku/engine";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";
import { GameStore, initialSnapshot } from "./gameStore";

export type { Phase, PlaySnapshot } from "./gameStore";

function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `play-${a[0]!.toString(16)}${a[1]!.toString(16)}`;
}

export class PlayStore extends GameStore {
  private worker: Worker | null = null;
  private requestId = 0;
  private started = false;

  constructor() {
    super(initialSnapshot());
  }

  /** Первый показ вкладки Play: слушатели видимости страницы + первая партия. Идемпотентно. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.watchVisibility();
    this.newGame(this.snap.difficulty);
  }

  newGame(difficulty: Difficulty = this.snap.difficulty): void {
    const id = ++this.requestId;
    this.worker?.terminate();
    this.worker = null;
    this.resetToLoading({ difficulty });
    try {
      const worker = new Worker(new URL("./generate.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<GenerateResponse>) => this.onGenerated(id, event.data);
      worker.onerror = () => this.onGenerated(id, { id, ok: false, error: "worker error" });
      const req: GenerateRequest = { id, difficulty, seed: randomSeed() };
      worker.postMessage(req);
    } catch {
      this.set({ phase: "error" });
    }
  }

  private onGenerated(id: number, res: GenerateResponse): void {
    if (id !== this.requestId) return; // устаревший ответ (сменили сложность)
    this.worker?.terminate();
    this.worker = null;
    if (!res.ok) {
      this.set({ phase: "error" });
      return;
    }
    this.beginGame(res.puzzle);
  }
}

export const playStore = new PlayStore();
