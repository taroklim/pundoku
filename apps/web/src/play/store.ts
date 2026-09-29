/**
 * Внешнее хранилище партии Play (PD-11). Живёт выше вкладок: переключение Today/Play/Year не
 * сбрасывает партию. Прогресс — только в памяти (IndexedDB — PD-14): перезагрузка = новая партия.
 *
 * Хранилище связывает чистую логику (`logic.ts`), Web Worker генерации, тихий таймер (пауза при
 * скрытии страницы и при уходе с вкладки Play) и данные для анимаций M1/M3.
 */
import type { Difficulty } from "@pundoku/engine";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";
import type { PlayState } from "./logic";
import {
  closedUnits,
  createPlay,
  enterDigit,
  eraseCell,
  firstOpenCell,
  toggleNote,
  undo as undoMove,
} from "./logic";

export type Phase = "loading" | "playing" | "solved" | "error";

export interface PlaySnapshot {
  readonly phase: Phase;
  readonly difficulty: Difficulty;
  /** Дата партии (сегодня на момент старта) — подпись дня. */
  readonly startedOn: Date;
  readonly play: PlayState | null;
  readonly selected: number | null;
  readonly notesMode: boolean;
  /** M1: клетка, в которой только что поставлена цифра (id меняется на каждый ввод). */
  readonly pop: { readonly cell: number; readonly id: number } | null;
  /** M3: собранный юнит (клетки по порядку) — одна волна. */
  readonly wave: { readonly cells: readonly number[]; readonly id: number } | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DEFAULT_DIFFICULTY: Difficulty = "medium";

function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `play-${a[0]!.toString(16)}${a[1]!.toString(16)}`;
}

export class PlayStore {
  private snap: PlaySnapshot = {
    phase: "loading",
    difficulty: DEFAULT_DIFFICULTY,
    startedOn: new Date(),
    play: null,
    selected: null,
    notesMode: false,
    pop: null,
    wave: null,
  };
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private requestId = 0;
  private started = false;
  private effectId = 0;
  /** Счётчик волн M3: подряд идущие волны получают id разной чётности (см. Board, класс wave-a/b). */
  private waveSeq = 0;

  // Таймер: накопленное + текущий отрезок. Идёт только пока партия играется, вкладка Play
  // показана и страница видима.
  private elapsedBase = 0;
  private runningSince: number | null = null;
  private tabActive = false;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly getSnapshot = (): PlaySnapshot => this.snap;

  private set(patch: Partial<PlaySnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.syncClock();
    this.listeners.forEach((fn) => fn());
  }

  /** Первый показ вкладки Play: слушатели видимости страницы + первая партия. Идемпотентно. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener("visibilitychange", this.syncClock);
    this.newGame(this.snap.difficulty);
  }

  /** Вкладка Play сейчас на экране? (пауза таймера при уходе на Today/Year.) */
  setTabActive(active: boolean): void {
    this.tabActive = active;
    this.syncClock();
  }

  newGame(difficulty: Difficulty = this.snap.difficulty): void {
    const id = ++this.requestId;
    this.worker?.terminate();
    this.worker = null;
    this.elapsedBase = 0;
    this.runningSince = null;
    this.set({
      phase: "loading",
      difficulty,
      startedOn: new Date(),
      play: null,
      selected: null,
      notesMode: false,
      pop: null,
      wave: null,
    });
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
    const play = createPlay(res.puzzle);
    this.elapsedBase = 0;
    this.set({ phase: "playing", play, selected: firstOpenCell(play), startedOn: new Date() });
  }

  // ---- таймер -------------------------------------------------------------------------------

  private syncClock = (): void => {
    const shouldRun = this.snap.phase === "playing" && this.tabActive && document.visibilityState === "visible";
    if (shouldRun && this.runningSince === null) {
      this.runningSince = performance.now();
    } else if (!shouldRun && this.runningSince !== null) {
      this.elapsedBase += performance.now() - this.runningSince;
      this.runningSince = null;
    }
  };

  getElapsedMs = (): number =>
    this.elapsedBase + (this.runningSince === null ? 0 : performance.now() - this.runningSince);

  // ---- ввод ---------------------------------------------------------------------------------

  select(cell: number | null): void {
    if (this.snap.phase !== "playing" || cell === this.snap.selected) return;
    this.set({ selected: cell });
  }

  /** Сдвиг выбора по стрелкам (без циклического перехода). */
  moveSelection(dRow: number, dCol: number): number | null {
    const cur = this.snap.selected;
    if (this.snap.phase !== "playing" || cur === null) return null;
    const r = Math.min(8, Math.max(0, Math.floor(cur / 9) + dRow));
    const c = Math.min(8, Math.max(0, (cur % 9) + dCol));
    const next = r * 9 + c;
    this.select(next);
    return next;
  }

  toggleNotesMode(): void {
    if (this.snap.phase !== "playing") return;
    this.set({ notesMode: !this.snap.notesMode });
  }

  /** Цифра с панели/клавиатуры. `invert` — временно противоположный режим (Alt/Shift на клавиатуре). */
  input(digit: number, invert = false): void {
    const { play, selected, phase, notesMode } = this.snap;
    if (phase !== "playing" || !play || selected === null) return;
    const t = this.getElapsedMs();
    const notes = notesMode !== invert;
    const next = notes ? toggleNote(play, selected, digit, t) : enterDigit(play, selected, digit, t);
    if (next === play) return;
    const placed = !notes && next.values[selected] === digit;
    const patch: Mutable<Partial<PlaySnapshot>> = { play: next };
    if (placed) {
      patch.pop = { cell: selected, id: ++this.effectId };
      if (next.solution[selected] === digit) {
        const unit = closedUnits(next, selected)[0];
        if (unit) patch.wave = { cells: unit, id: ++this.waveSeq };
      }
    }
    this.finishMove(next, patch);
  }

  erase(): void {
    const { play, selected, phase } = this.snap;
    if (phase !== "playing" || !play || selected === null) return;
    const next = eraseCell(play, selected, this.getElapsedMs());
    if (next !== play) this.finishMove(next, { play: next });
  }

  undo(): void {
    const { play, phase } = this.snap;
    if (phase !== "playing" || !play) return;
    const top = play.undoStack[play.undoStack.length - 1];
    const next = undoMove(play, this.getElapsedMs());
    if (next !== play) this.finishMove(next, { play: next, selected: top ? top.cell : this.snap.selected });
  }

  private finishMove(next: PlayState, patch: Partial<PlaySnapshot>): void {
    if (next.solved) {
      // Замираем: таймер останавливается на последнем ходе.
      const last = next.log[next.log.length - 1];
      this.set({ ...patch, phase: "solved" });
      this.elapsedBase = last ? last.t : this.getElapsedMs();
      this.runningSince = null;
      return;
    }
    this.set(patch);
  }
}

export const playStore = new PlayStore();
