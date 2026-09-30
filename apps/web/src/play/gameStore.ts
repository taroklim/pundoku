/**
 * Общая часть хранилищ партии (PD-11 → PD-12): снапшот, тихий таймер, ввод/undo/erase, данные
 * анимаций M1/M3. Наследники решают, ОТКУДА берётся сетка: `PlayStore` (Play — генератор в
 * Worker) и `DayStore` (Today — сетка дня с сервера или фолбэк движка).
 *
 * Хранилище живёт выше вкладок: переключение Today/Play/Year не сбрасывает партию.
 */
import type { Difficulty } from "@pundoku/engine";
import { isBlotMistake } from "@pundoku/engine";
import type { PlayState } from "./logic";
import {
  closedUnits,
  createPlay,
  enterDigit,
  eraseCell,
  firstOpenCell,
  setInkMode,
  toggleNote,
  undo as undoMove,
} from "./logic";

export type Phase = "loading" | "playing" | "solved" | "error";

export interface PlaySnapshot {
  readonly phase: Phase;
  readonly difficulty: Difficulty;
  /** Момент старта партии — ключ для перезапуска кольца/озвучки; подпись дня считают наследники. */
  readonly startedOn: Date;
  readonly play: PlayState | null;
  readonly selected: number | null;
  readonly notesMode: boolean;
  /** M1: клетка, в которой только что поставлена цифра (id меняется на каждый ввод). */
  readonly pop: { readonly cell: number; readonly id: number } | null;
  /** M3: собранный юнит (клетки по порядку) — одна волна. */
  readonly wave: { readonly cells: readonly number[]; readonly id: number } | null;
  /** Ink (PD-71): клякса, только что поставленная игроком (неверная цифра и клетка; id меняется на каждую). */
  readonly blot?: { readonly cell: number; readonly digit: number; readonly id: number } | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const DEFAULT_DIFFICULTY: Difficulty = "medium";

export function initialSnapshot(): PlaySnapshot {
  return {
    phase: "loading",
    difficulty: DEFAULT_DIFFICULTY,
    startedOn: new Date(),
    play: null,
    selected: null,
    notesMode: false,
    pop: null,
    wave: null,
    blot: null,
  };
}

export abstract class GameStore<S extends PlaySnapshot = PlaySnapshot> {
  protected snap: S;
  private listeners = new Set<() => void>();
  private effectId = 0;
  /** Счётчик волн M3: подряд идущие волны получают id разной чётности (см. Board, класс wave-a/b). */
  private waveSeq = 0;

  // Таймер: накопленное + текущий отрезок. Идёт только пока партия играется, вкладка показана
  // и страница видима.
  protected elapsedBase = 0;
  private runningSince: number | null = null;
  private tabActive = false;

  protected constructor(initial: S) {
    this.snap = initial;
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly getSnapshot = (): S => this.snap;

  protected set(patch: Partial<S>): void {
    this.snap = { ...this.snap, ...patch };
    this.syncClock();
    this.listeners.forEach((fn) => fn());
  }

  /** Подписка на видимость страницы для таймера; вызывают наследники при первом старте. */
  protected watchVisibility(): void {
    document.addEventListener("visibilitychange", this.syncClock);
  }

  /** Вкладка этой партии сейчас на экране? (пауза таймера при уходе на другую вкладку.) */
  setTabActive(active: boolean): void {
    this.tabActive = active;
    this.syncClock();
  }

  /** Начать партию с готовой сеткой: таймер с нуля, выбор — первая пустая клетка. */
  protected beginGame(puzzle: { mission: string; solution: string }, patch: Partial<S> = {}): PlayState {
    const play = createPlay(puzzle);
    this.elapsedBase = 0;
    this.runningSince = null;
    this.set({
      phase: "playing",
      play,
      selected: firstOpenCell(play),
      startedOn: new Date(),
      notesMode: false,
      pop: null,
      wave: null,
      blot: null,
      ...patch,
    } as Partial<S>);
    return play;
  }

  /** Продолжить сохранённую партию: игра, накопленное время; решённая — сразу в `solved`. */
  protected resumeGame(play: PlayState, elapsedMs: number, patch: Partial<S> = {}): void {
    this.elapsedBase = elapsedMs;
    this.runningSince = null;
    this.set({
      phase: play.solved ? "solved" : "playing",
      play,
      selected: play.solved ? null : firstOpenCell(play),
      startedOn: new Date(),
      notesMode: false,
      pop: null,
      wave: null,
      blot: null,
      ...patch,
    } as Partial<S>);
  }

  /** Сбросить партию в «загрузку» (таймер обнуляется). */
  protected resetToLoading(patch: Partial<S> = {}): void {
    this.elapsedBase = 0;
    this.runningSince = null;
    this.set({
      phase: "loading",
      play: null,
      selected: null,
      notesMode: false,
      pop: null,
      wave: null,
      blot: null,
      startedOn: new Date(),
      ...patch,
    } as Partial<S>);
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
    this.set({ selected: cell } as Partial<S>);
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

  /**
   * Чернильный режим (PD-71): включить/выключить. Только до первого хода (после — режим неизменен) и только
   * там, где он разрешён (`inkAllowed`). Возвращает `true`, если режим теперь ровно такой, как запрошено.
   */
  setInk(on: boolean): boolean {
    const { play, phase } = this.snap;
    if (phase !== "playing" || !play) return false;
    if (on && !this.inkAllowed()) return (play.ink === true) === on;
    const next = setInkMode(play, on);
    if (next !== play) this.set({ play: next } as Partial<S>);
    return (next.ink === true) === on;
  }

  /** Разрешён ли Чернильный режим на этом экране: Today и Play — да; архивный `DayStore` переопределяет. */
  protected inkAllowed(): boolean {
    return true;
  }

  toggleNotesMode(): void {
    if (this.snap.phase !== "playing") return;
    this.set({ notesMode: !this.snap.notesMode } as Partial<S>);
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
    // Ink: неверная цифра не остаётся в `values` (авто-замена) — клякса видна только в логе нового хода.
    const blot = notes ? undefined : next.log.slice(play.log.length).find(isBlotMistake);
    if (blot) patch.blot = { cell: blot.cell, digit: blot.digit ?? digit, id: ++this.effectId };
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
    // pop: null — восстановление/стирание не должно проигрывать M1 (устаревший popId).
    if (next !== play) this.finishMove(next, { play: next, pop: null });
  }

  undo(): void {
    const { play, phase } = this.snap;
    if (phase !== "playing" || !play) return;
    const top = play.undoStack[play.undoStack.length - 1];
    const next = undoMove(play, this.getElapsedMs());
    if (next !== play) this.finishMove(next, { play: next, pop: null, selected: top ? top.cell : this.snap.selected });
  }

  /**
   * Сбросить данные одноразовых анимаций M1/M3 (QA PD-23, Low 1). `pop`/`wave` живут в снапшоте
   * выше экрана: при возврате на вкладку экран монтируется заново и без сброса заново проиграл бы
   * стухшие «чернила впитались»/«волна». Экран зовёт это при размонтировании.
   */
  clearEffects(): void {
    if (this.snap.pop === null && this.snap.wave === null && (this.snap.blot ?? null) === null) return;
    this.set({ pop: null, wave: null, blot: null } as Partial<S>);
  }

  private finishMove(next: PlayState, patch: Partial<PlaySnapshot>): void {
    if (next.solved) {
      // Замираем: таймер останавливается на последнем ходе.
      const last = next.log[next.log.length - 1];
      this.set({ ...patch, phase: "solved" } as Partial<S>);
      this.elapsedBase = last ? last.t : this.getElapsedMs();
      this.runningSince = null;
      this.onSolved(next);
      return;
    }
    this.set(patch as Partial<S>);
  }

  /** Партия решена (таймер уже остановлен). Наследники записывают результат. */
  protected onSolved(_play: PlayState): void {
    /* по умолчанию ничего */
  }
}
