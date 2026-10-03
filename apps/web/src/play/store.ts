/**
 * Хранилище партии Play (PD-11). Партия переживает перезагрузку и вытеснение PWA из памяти (PD-116): после каждого
 * хода она пишется локально в IndexedDB (запись `kv` «meta:playGame» — рядом с Today, но отдельно от `days`) и
 * восстанавливается при старте. Play НЕ входит в снапшот синхронизации (он строится из `days`) и не попадает в Year.
 * Общая механика (ввод, undo, таймер, анимации) — `GameStore`; здесь — источник сетки: генерация в Web Worker
 * (`generate()` для hard/expert бывает секундами) и запись/восстановление партии.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES } from "@pundoku/engine";
import { sync as syncRuntime } from "../sync/runtime";
import type { SyncStorage } from "../today/repository";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";
import type { PlaySnapshot } from "./gameStore";
import { GameStore, initialSnapshot } from "./gameStore";
import type { PlayState } from "./logic";
import { CELLS, firstOpenCell } from "./logic";

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
  /** Идёт чтение сохранённой партии при старте (PD-116): экран не мигает выбором сложности, пока не ясно, есть ли она. */
  readonly restoring?: boolean;
}

/** Ключ записи Play в `meta` хранилища (`kv` IndexedDB: `meta:playGame`). Не `days` — значит, не в синхронизации и не в Year. */
export const PLAY_META_KEY = "playGame";

/** Запись партии Play. Структура клонируема (IndexedDB/structuredClone); `v` — версия формата. */
export interface SavedPlay {
  readonly v: 1;
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
}

export interface PlayDeps {
  storage: Pick<SyncStorage, "getMeta" | "setMeta">;
}

const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.length === CELLS && v.every((n) => Number.isInteger(n));

/** Разобрать запись из хранилища; всё подозрительное — `null` (партия просто не восстановится, а не уронит экран). */
export function parseSavedPlay(raw: unknown): SavedPlay | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<Record<keyof SavedPlay, unknown>>;
  const p = r.play as Partial<PlayState> | undefined;
  if (r.v !== 1 || typeof p !== "object" || p === null) return null;
  if (!isNumArray(p.mission) || !isNumArray(p.solution) || !isNumArray(p.values) || !isNumArray(p.notes)) return null;
  if (!Array.isArray(p.log) || !Array.isArray(p.undoStack) || typeof p.solved !== "boolean") return null;
  if (!DIFFICULTIES.includes(r.difficulty as Difficulty)) return null;
  if (typeof r.elapsedMs !== "number" || !Number.isFinite(r.elapsedMs) || r.elapsedMs < 0) return null;
  if (typeof r.startedOn !== "string" || Number.isNaN(Date.parse(r.startedOn))) return null;
  const selected = typeof r.selected === "number" && Number.isInteger(r.selected) && r.selected >= 0 && r.selected < CELLS ? r.selected : null;
  const hints = typeof r.hints === "number" && Number.isInteger(r.hints) && r.hints > 0 && r.hints <= 999 ? r.hints : 0;
  const assisted = r.assisted === true || hints > 0; // подсказки без пометки — порча записи: пометка важнее
  return {
    v: 1,
    difficulty: r.difficulty as Difficulty,
    startedOn: r.startedOn,
    play: p as PlayState,
    elapsedMs: r.elapsedMs,
    selected,
    notesMode: r.notesMode === true,
    ...(hints > 0 ? { hints } : {}),
    ...(assisted ? { assisted: true } : {}),
  };
}

export class PlayStore extends GameStore<PlayScreenSnapshot> {
  private worker: Worker | null = null;
  private requestId = 0;
  private started = false;
  private readonly deps: PlayDeps | null;
  /** Записи идут строго по порядку: «очистить» после «сохранить» не должно оказаться затёртым запоздавшей записью. */
  private writes: Promise<unknown> = Promise.resolve();
  private listening = false;

  /**
   * `deps` — куда писать партию. Без них (тесты, `new PlayStore()`) хранилище работает только в памяти;
   * боевой `playStore` создаётся с IndexedDB и восстанавливает партию в `restore()`.
   */
  constructor(deps: PlayDeps | null = null) {
    super({ ...initialSnapshot(), setup: true, inkNext: false, restoring: deps !== null });
    this.deps = deps;
  }

  // ---- запись/восстановление (PD-116) -------------------------------------------------------

  private write(job: () => Promise<unknown>): void {
    this.writes = this.writes.then(job).catch(() => undefined); // сбой хранилища не должен ронять игру
  }

  private persist(): void {
    const { deps } = this;
    const s = this.snap;
    if (!deps || s.setup || !s.play || (s.phase !== "playing" && s.phase !== "solved")) return;
    const saved: SavedPlay = {
      v: 1,
      difficulty: s.difficulty,
      startedOn: s.startedOn.toISOString(),
      play: s.play,
      elapsedMs: this.getElapsedMs(),
      selected: s.selected,
      notesMode: s.notesMode,
      ...((s.hints ?? 0) > 0 ? { hints: s.hints } : {}),
      ...(s.assisted === true ? { assisted: true } : {}),
    };
    this.write(() => deps.storage.setMeta(PLAY_META_KEY, saved));
  }

  /** Удалить сохранённую партию (явное «New puzzle»): иначе перезагрузка воскресила бы отброшенную. */
  private clearSaved(): void {
    const { deps } = this;
    if (deps) this.write(() => deps.storage.setMeta(PLAY_META_KEY, null));
  }

  /** Партия меняется (ход/решение/смена фазы) — пишем. Выбор клетки, анимации и отклики — не прогресс, не пишем. */
  protected override set(patch: Partial<PlayScreenSnapshot>): void {
    super.set(patch);
    if (patch.play !== undefined || patch.phase !== undefined || patch.hints !== undefined) this.persist();
  }

  /** Решено: таймер уже остановлен на последнем ходе — дописываем точное время и итог. */
  protected override onSolved(): void {
    this.persist();
  }

  override setTabActive(active: boolean): void {
    super.setTabActive(active);
    if (!active) this.persist(); // ушли с вкладки: таймер остановился, сохраняем накопленное
  }

  /** Страница скрыта/закрывается (iOS убивает PWA без предупреждения): сохранить накопленное время и выбор. */
  private listen(): void {
    if (this.listening || !this.deps || typeof document === "undefined") return;
    this.listening = true;
    const save = (): void => this.persist();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") save();
    });
    window.addEventListener("pagehide", save);
  }

  /**
   * Старт приложения: прочитать сохранённую партию и продолжить её — решённая остаётся на экране результата до явного
   * «New puzzle». Нет записи/битая запись/уже начата новая — обычный выбор сложности. Идемпотентно.
   */
  async restore(): Promise<void> {
    const { deps } = this;
    if (!deps || this.snap.restoring !== true) return;
    this.listen();
    let saved: SavedPlay | null;
    try {
      saved = parseSavedPlay(await deps.storage.getMeta(PLAY_META_KEY));
    } catch {
      saved = null;
    }
    // Пока читали, игрок уже мог выбрать «Start» — тогда его выбор главнее.
    if (this.snap.restoring !== true) return;
    if (!saved) {
      this.set({ restoring: false });
      return;
    }
    this.resumeGame(saved.play, saved.elapsedMs, {
      setup: false,
      inkNext: false,
      restoring: false,
      difficulty: saved.difficulty,
      startedOn: new Date(saved.startedOn),
      selected: saved.play.solved ? null : (saved.selected ?? firstOpenCell(saved.play)),
      notesMode: saved.notesMode && !saved.play.solved,
      hints: saved.hints ?? 0,
      assisted: saved.assisted === true,
    });
  }

  /** Первый показ вкладки Play: слушатели видимости страницы. Партию игрок запускает сам («Start»). Идемпотентно. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.listen();
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
    this.resetToLoading({ difficulty, setup: true, inkNext: false, restoring: false });
    this.clearSaved();
  }

  /** «Start»: генерация по выбранным сложности и режиму. */
  start(): void {
    this.newGame(this.snap.difficulty, this.snap.inkNext);
  }

  newGame(difficulty: Difficulty = this.snap.difficulty, ink: boolean = this.snap.inkNext): void {
    const id = ++this.requestId;
    this.worker?.terminate();
    this.worker = null;
    this.resetToLoading({ difficulty, setup: false, inkNext: ink, restoring: false });
    this.clearSaved(); // прежняя партия закрыта: до первого хода новой записи нет (перезагрузка вернёт на выбор сложности)
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

export const playStore = new PlayStore({ storage: syncRuntime.repository });
void playStore.restore();
