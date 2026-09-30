/**
 * Хранилище партии Play (PD-11). Прогресс — только в памяти (IndexedDB — PD-14): перезагрузка =
 * новая партия. Общая механика (ввод, undo, таймер, анимации) — `GameStore`; здесь — источник
 * сетки: генерация в Web Worker (`generate()` для hard/expert бывает секундами).
 */
import type { Difficulty } from "@pundoku/engine";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";
import type { PlaySnapshot } from "./gameStore";
import { GameStore, initialSnapshot } from "./gameStore";

export type { Phase, PlaySnapshot } from "./gameStore";

function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `play-${a[0]!.toString(16)}${a[1]!.toString(16)}`;
}

/**
 * Снапшот экрана Play: поверх общего — шаг «New puzzle» (PD-74). Партия не стартует сама при открытии вкладки:
 * игрок выбирает сложность и Чернильный режим (режим выбирают до первого хода) и жмёт «Start».
 */
export interface PlayScreenSnapshot extends PlaySnapshot {
  /** Показан выбор «сложность / Ink mode / Start», партии нет. */
  readonly setup: boolean;
  /** Выбранный на этом шаге Чернильный режим — включится в новой партии. */
  readonly inkNext: boolean;
}

export class PlayStore extends GameStore<PlayScreenSnapshot> {
  private worker: Worker | null = null;
  private requestId = 0;
  private started = false;

  constructor() {
    super({ ...initialSnapshot(), setup: true, inkNext: false });
  }

  /** Первый показ вкладки Play: слушатели видимости страницы. Партию игрок запускает сам («Start»). Идемпотентно. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.watchVisibility();
  }

  /** Выбор сложности на шаге «New puzzle». */
  setDifficulty(difficulty: Difficulty): void {
    if (this.snap.setup) this.set({ difficulty });
  }

  /** Чернильный режим на шаге «New puzzle» (правило показывает экран до включения). */
  setInkNext(on: boolean): void {
    if (this.snap.setup) this.set({ inkNext: on });
  }

  /**
   * Вернуться к выбору новой партии (кнопка «New game», смена сложности посреди партии): текущая партия
   * закрывается, режим сбрасывается в «без чернил» — его каждый раз выбирают заново.
   */
  toSetup(difficulty: Difficulty = this.snap.difficulty): void {
    this.requestId++; // ответ уже запущенной генерации устарел
    this.worker?.terminate();
    this.worker = null;
    this.resetToLoading({ difficulty, setup: true, inkNext: false });
  }

  /** «Start»: генерация по выбранным сложности и режиму. */
  start(): void {
    this.newGame(this.snap.difficulty, this.snap.inkNext);
  }

  newGame(difficulty: Difficulty = this.snap.difficulty, ink: boolean = this.snap.inkNext): void {
    const id = ++this.requestId;
    this.worker?.terminate();
    this.worker = null;
    this.resetToLoading({ difficulty, setup: false, inkNext: ink });
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
    // Чернильный режим выбран на шаге «New puzzle»: лог новой партии пуст, режим включается без ограничений.
    if (this.snap.inkNext) this.setInk(true);
  }
}

export const playStore = new PlayStore();
