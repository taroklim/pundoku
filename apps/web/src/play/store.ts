/**
 * Хранилище партий Play (PD-11 → PD-116 → PD-167). Партия переживает перезагрузку и вытеснение PWA из памяти: после каждого
 * хода она пишется локально в IndexedDB (`kv`, запись `meta:playGame:<режим>` — рядом с Today, но отдельно от `days`) и
 * читается при старте. Play НЕ входит в снапшот синхронизации (он строится из `days`) и не попадает в Year.
 *
 * PD-167 (раскладка C, design/pd163-modes-layout.md, решение 1): у КАЖДОГО режима из реестра (`modes.ts`) свой слот
 * незавершённой игры — ни одна игра не уничтожает другую. Живая партия одна (на доске или на паузе за хабом), остальные
 * «припаркованы» в слотах; открыть режим = припарковать живую и поднять его слот. Единственный слот до PD-167
 * (`meta:playGame`) при старте переносится в слот своего режима (Чернила — по самой партии) и только потом удаляется.
 *
 * Общая механика (ввод, undo, таймер, анимации) — `GameStore`; здесь — источник сетки (генерация в Web Worker) и слоты.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES } from "@pundoku/engine";
import { sync as syncRuntime } from "../sync/runtime";
import type { SyncStorage } from "../today/repository";
import type { SlotSummary } from "./daySlot";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";
import type { PlaySnapshot } from "./gameStore";
import { DEFAULT_DIFFICULTY, GameStore, initialSnapshot } from "./gameStore";
import type { PlayState } from "./logic";
import { CELLS, cellsLeft, resumeSelection } from "./logic";
import type { ModeId } from "./modes";
import { DEFAULT_MODE, MODES, isModeId, legacyModeOf, modeDef, slotKey } from "./modes";

export type { Phase, PlaySnapshot } from "./gameStore";
export type { ModeId } from "./modes";

function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `play-${a[0]!.toString(16)}${a[1]!.toString(16)}`;
}

/**
 * Снапшот экрана Play: поверх общего — хаб (PD-144/PD-167). Партия не стартует сама при открытии вкладки: хаб показывает
 * «Продолжить» (только день) и список режимов; партию запускает шит режима.
 *
 * Живая партия — партия снапшота (`mode` — её режим): `hub: true` при `phase: "playing"` значит «партия есть и сохранена,
 * но игрок на хабе». Незавершённые игры других режимов живут в слотах (`slots()`), не в снапшоте.
 */
export interface PlayScreenSnapshot extends PlaySnapshot {
  /** Показан хаб, а не доска. Партия (если есть) стоит на паузе и сохранена. */
  readonly hub: boolean;
  /** Режим живой партии (или той, что сейчас генерируется). */
  readonly mode: ModeId;
  /** Последняя выбранная в шите сложность по режимам (предвыбор шита). */
  readonly picks: Readonly<Partial<Record<ModeId, Difficulty>>>;
  /** Растёт на каждый повторный тап по вкладке Play: экран закрывает оверлеи и (на хабе) прокручивает его наверх. */
  readonly reselect: number;
  /** Идёт чтение слотов при старте (PD-116): хаб не мигает пустыми строками, пока не ясно, что есть. */
  readonly restoring?: boolean;
}

/** Единственный ключ записи Play до PD-167 (`meta:playGame`): читается только ради переноса в слот режима. */
export const PLAY_META_KEY = "playGame";
export { slotKey };

/** Запись партии Play. Структура клонируема (IndexedDB/structuredClone); `v` — версия формата. */
export interface SavedPlay {
  readonly v: 1;
  /** PD-167: режим партии. Записи до PD-167 его не имеют — режим выводится из партии (`legacyModeOf`). */
  readonly mode?: ModeId;
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

/**
 * Разобрать запись из хранилища; всё подозрительное — `null` (партия просто не восстановится, а не уронит экран).
 * `slot` — режим слота, из которого прочитана запись: он главнее поля `mode`. Запись неизвестного этой версии режима — `null`.
 */
export function parseSavedPlay(raw: unknown, slot?: ModeId): SavedPlay | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<Record<keyof SavedPlay, unknown>>;
  const p = r.play as Partial<PlayState> | undefined;
  if (r.v !== 1 || typeof p !== "object" || p === null) return null;
  if (!isNumArray(p.mission) || !isNumArray(p.solution) || !isNumArray(p.values) || !isNumArray(p.notes)) return null;
  if (!Array.isArray(p.log) || !Array.isArray(p.undoStack) || typeof p.solved !== "boolean") return null;
  if (!DIFFICULTIES.includes(r.difficulty as Difficulty)) return null;
  if (typeof r.elapsedMs !== "number" || !Number.isFinite(r.elapsedMs) || r.elapsedMs < 0) return null;
  if (typeof r.startedOn !== "string" || Number.isNaN(Date.parse(r.startedOn))) return null;
  if (r.mode !== undefined && !isModeId(r.mode)) return null;
  const mode: ModeId = slot ?? (isModeId(r.mode) ? r.mode : legacyModeOf(p as PlayState));
  const selected = typeof r.selected === "number" && Number.isInteger(r.selected) && r.selected >= 0 && r.selected < CELLS ? r.selected : null;
  const hints = typeof r.hints === "number" && Number.isInteger(r.hints) && r.hints > 0 && r.hints <= 999 ? r.hints : 0;
  const assisted = r.assisted === true || hints > 0; // подсказки без пометки — порча записи: пометка важнее
  return {
    v: 1,
    mode,
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

/** Сводка слота для строки хаба. */
export function summaryOf(saved: SavedPlay): SlotSummary {
  return { difficulty: saved.difficulty, left: cellsLeft(saved.play), elapsedMs: saved.elapsedMs, ink: saved.play.ink === true };
}

export class PlayStore extends GameStore<PlayScreenSnapshot> {
  private worker: Worker | null = null;
  private requestId = 0;
  private started = false;
  private readonly deps: PlayDeps | null;
  /** Записи идут строго по порядку: «очистить» после «сохранить» не должно оказаться затёртым запоздавшей записью. */
  private writes: Promise<unknown> = Promise.resolve();
  private listening = false;
  /** Слоты режимов в памяти — зеркало `meta:playGame:<режим>`. Живая партия тоже здесь (обновляется на каждой записи). */
  private readonly saved = new Map<ModeId, SavedPlay>();

  /**
   * `deps` — куда писать партии. Без них (тесты, `new PlayStore()`) хранилище работает только в памяти;
   * боевой `playStore` создаётся с IndexedDB и читает слоты в `restore()`.
   */
  constructor(deps: PlayDeps | null = null) {
    super({ ...initialSnapshot(), hub: true, mode: DEFAULT_MODE, picks: {}, reselect: 0, restoring: deps !== null });
    this.deps = deps;
  }

  // ---- запись/восстановление (PD-116, PD-167) -----------------------------------------------

  private write(job: () => Promise<unknown>): void {
    this.writes = this.writes.then(job).catch(() => undefined); // сбой хранилища не должен ронять игру
  }

  /** Все записи, поставленные в очередь, дошли до хранилища (тесты, проверка миграции). */
  flushed(): Promise<void> {
    return this.writes.then(() => undefined);
  }

  private persist(): void {
    const s = this.snap;
    if (!s.play || (s.phase !== "playing" && s.phase !== "solved")) return;
    const saved: SavedPlay = {
      v: 1,
      mode: s.mode,
      difficulty: s.difficulty,
      startedOn: s.startedOn.toISOString(),
      play: s.play,
      elapsedMs: this.getElapsedMs(),
      selected: s.selected,
      notesMode: s.notesMode,
      ...((s.hints ?? 0) > 0 ? { hints: s.hints } : {}),
      ...(s.assisted === true ? { assisted: true } : {}),
    };
    this.saved.set(s.mode, saved);
    const { deps } = this;
    if (deps) this.write(() => deps.storage.setMeta(slotKey(s.mode), saved));
  }

  /** Удалить слот режима (новая сетка в нём, решённая партия ушла с экрана): иначе перезагрузка воскресила бы отброшенную. */
  private clearSlot(mode: ModeId): void {
    this.saved.delete(mode);
    const { deps } = this;
    if (deps) this.write(() => deps.storage.setMeta(slotKey(mode), null));
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
   * Старт приложения: прочитать слоты всех режимов реестра. Незавершённые становятся строками хаба (после перезагрузки
   * всегда хаб — доска не открывается сама); решённые записи удаляются (законченная своя сетка исчезает, PD-144 §6.4).
   *
   * Миграция PD-167: запись единственного слота до PD-167 (`meta:playGame`) переносится в слот своего режима — сначала
   * запись в новый слот, потом удаление старой (сбой между ними оставит обе, следующий старт доделает перенос). Если слот
   * режима уже занят (перенос однажды прошёл), старая запись просто удаляется. Нечитаемую старую запись не трогаем.
   * Слоты режимов, которых нет в реестре этой версии, не читаются и не стираются. Идемпотентно.
   */
  async restore(): Promise<void> {
    const { deps } = this;
    if (!deps || this.snap.restoring !== true) return;
    this.listen();
    const read = async (key: string): Promise<unknown> => {
      try {
        return await deps.storage.getMeta(key);
      } catch {
        return null;
      }
    };
    const found = new Map<ModeId, SavedPlay>();
    const stale: ModeId[] = [];
    for (const m of MODES) {
      const rec = parseSavedPlay(await read(slotKey(m.id)), m.id);
      if (!rec) continue;
      if (rec.play.solved) stale.push(m.id);
      else found.set(m.id, rec);
    }
    const legacy = parseSavedPlay(await read(PLAY_META_KEY));
    let migrate: SavedPlay | null = null;
    if (legacy) {
      const mode = legacy.mode ?? legacyModeOf(legacy.play);
      if (!legacy.play.solved && !found.has(mode) && !stale.includes(mode)) {
        migrate = { ...legacy, mode };
        found.set(mode, migrate);
      }
      const moved = migrate;
      this.write(async () => {
        if (moved) await deps.storage.setMeta(slotKey(mode), moved);
        await deps.storage.setMeta(PLAY_META_KEY, null);
      });
    }
    for (const mode of stale) this.write(() => deps.storage.setMeta(slotKey(mode), null));
    // Пока читали, игрок уже мог начать партию — её слот главнее прочитанного.
    for (const [mode, rec] of found) if (!this.saved.has(mode)) this.saved.set(mode, rec);
    if (this.snap.restoring === true) this.set({ restoring: false });
  }

  /** Первый показ вкладки Play: слушатели видимости страницы. Партию игрок запускает сам (шит режима). Идемпотентно. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.listen();
    this.watchVisibility();
  }

  /** Пока игрок на хабе, партия стоит на паузе: таймер не идёт (решение PD-144, README). */
  protected override holdClock(): boolean {
    return this.snap.hub;
  }

  /** Подсказок на хабе нет: лесенка слушает стор и закрывается сама, когда партию скрыл хаб. */
  override hintAllowed(): boolean {
    return !this.snap.hub && super.hintAllowed();
  }

  /** Живая партия не решена (она — слот своего режима). */
  hasSlot(): boolean {
    return this.snap.phase === "playing" && this.snap.play !== null;
  }

  /**
   * Незавершённые игры по режимам — строки хаба со статусом. Живая партия берётся из снапшота (время — накопленное),
   * остальные — из слотов. Режим без незавершённой игры в результате отсутствует.
   */
  slots(): Partial<Record<ModeId, SlotSummary>> {
    const out: Partial<Record<ModeId, SlotSummary>> = {};
    for (const [mode, rec] of this.saved) if (!rec.play.solved) out[mode] = summaryOf(rec);
    const s = this.snap;
    if (this.hasSlot() && s.play) {
      out[s.mode] = { difficulty: s.difficulty, left: cellsLeft(s.play), elapsedMs: this.getElapsedMs(), ink: s.play.ink === true };
    }
    return out;
  }

  /** Сложность, предвыбранная в шите режима: последняя выбранная → сложность незавершённой игры → по умолчанию. */
  pickFor(mode: ModeId): Difficulty {
    const allowed = modeDef(mode).difficulties;
    const want = this.snap.picks[mode] ?? this.slots()[mode]?.difficulty ?? DEFAULT_DIFFICULTY;
    return allowed.includes(want) ? want : (allowed[0] ?? DEFAULT_DIFFICULTY);
  }

  /** Выбор сложности в шите режима (запоминается для следующего открытия шита). */
  setPick(mode: ModeId, difficulty: Difficulty): void {
    if (!modeDef(mode).difficulties.includes(difficulty)) return;
    this.set({ picks: { ...this.snap.picks, [mode]: difficulty } });
  }

  /**
   * Вернуться на хаб (повторный тап по вкладке Play, «Новая сетка» на карточке результата): подтверждения нет. Идущая
   * партия НЕ выбрасывается — остаётся слотом своего режима (сохраняется с накопленным временем). Решённая, грузящаяся и
   * сорвавшаяся партии слотом не становятся: решённая исчезает, генерация отменяется.
   */
  toHub(): void {
    const s = this.snap;
    if (s.hub) return;
    if (s.phase === "playing" && s.play) {
      this.set({ hub: true, pop: null, wave: null, echo: null, blot: null, hint: null });
      this.persist(); // таймер уже накопился (`holdClock`), `getElapsedMs` вернёт итог
      return;
    }
    this.cancelGeneration();
    this.resetToLoading({ hub: true, restoring: false });
    this.clearSlot(s.mode);
  }

  private cancelGeneration(): void {
    this.requestId++; // ответ уже запущенной генерации устарел
    this.worker?.terminate();
    this.worker = null;
  }

  /** Живая партия — в слот (уже сохранена; дописываем накопленное время). Ничего не выбрасывает. */
  private park(): void {
    if (this.hasSlot()) this.persist();
  }

  /**
   * Тап по строке режима на хабе: есть незавершённая игра этого режима — она открывается на доске (живая партия другого
   * режима паркуется в свой слот). Возвращает `false`, если продолжать нечего (экран тогда открывает шит режима).
   */
  open(mode: ModeId): boolean {
    const s = this.snap;
    if (!s.hub) return false;
    if (s.mode === mode && this.hasSlot()) {
      this.set({ hub: false });
      return true;
    }
    const rec = this.saved.get(mode);
    if (!rec || rec.play.solved) return false;
    this.park();
    this.cancelGeneration();
    this.resumeGame(rec.play, rec.elapsedMs, {
      hub: false,
      mode,
      restoring: false,
      difficulty: rec.difficulty,
      startedOn: new Date(rec.startedOn),
      selected: resumeSelection(rec.play, rec.selected),
      notesMode: rec.notesMode,
      hints: rec.hints ?? 0,
      assisted: rec.assisted === true,
    });
    return true;
  }

  /** Живая партия на хабе → обратно на доску (то же, что `open` её режима). */
  resume(): void {
    this.open(this.snap.mode);
  }

  /**
   * Повторный тап по уже выбранной вкладке Play: из партии — на хаб, на хабе — только сигнал (экран закрывает оверлеи и
   * прокручивает хаб наверх). Ничего не выбрасывает и ничего не спрашивает.
   */
  reselect(): void {
    this.toHub();
    this.set({ reselect: this.snap.reselect + 1 });
  }

  /**
   * «Начать» в шите режима: новая сетка режима `mode`. Затирается ТОЛЬКО слот этого режима (шит предупреждает об этом
   * заранее); живая партия другого режима паркуется в свой слот. Работает и с хаба, и с доски («⋯ → Новая сетка»).
   */
  startNew(mode: ModeId, difficulty: Difficulty = this.pickFor(mode)): void {
    if (this.snap.mode !== mode) this.park();
    this.newGame(difficulty, mode);
  }

  newGame(difficulty: Difficulty = this.snap.difficulty, mode: ModeId = this.snap.mode): void {
    this.cancelGeneration();
    const id = this.requestId;
    this.clearSlot(mode); // прежняя игра режима закрыта: до первого хода новой записи нет (перезагрузка — без неё)
    this.resetToLoading({ difficulty, mode, picks: { ...this.snap.picks, [mode]: difficulty }, hub: false, restoring: false });
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
    if (id !== this.requestId) return; // устаревший ответ (ушли на хаб, начали другую)
    this.worker?.terminate();
    this.worker = null;
    if (!res.ok) {
      this.set({ phase: "error" });
      return;
    }
    this.startPuzzle(res.puzzle);
  }

  /** Сетка готова: партия + настройка под режим (`ModeDef.prepare`, лог ещё пуст). */
  protected startPuzzle(puzzle: { mission: string; solution: string }): void {
    const play = this.beginGame(puzzle);
    const prepare = modeDef(this.snap.mode).prepare;
    if (prepare) {
      const next = prepare(play);
      if (next !== play) this.set({ play: next });
    }
  }
}

export const playStore = new PlayStore({ storage: syncRuntime.repository });
void playStore.restore();
