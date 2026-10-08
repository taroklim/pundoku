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
 * PD-171 (Лжец): режим `liar` строит сетку `generateLiar` (тот же Worker), тяжёлые классы берутся из заготовок (`liarPool.ts`).
 * Лжец дня (medium, `dailyLiarPuzzle`) — отдельная партия вне слотов: запись `meta:liar:YYYY-MM-DD` переживает решение (Year,
 * снапшот синхронизации `liar`), незаконченный Лжец дня — строка «Продолжить» хаба. Свободная партия Лжеца — слот `liar`.
 *
 * Общая механика (ввод, undo, таймер, анимации) — `GameStore`; здесь — источник сетки (генерация в Web Worker) и слоты.
 */
import type { Difficulty } from "@pundoku/engine";
import type { SyncEvent } from "../sync/manager";
import { sync as syncRuntime } from "../sync/runtime";
import { localDate } from "../today/dayResolver";
import type { SyncStorage } from "../today/repository";
import type { SlotSummary } from "./daySlot";
import type { GeneratedPuzzle, GenerateRequest, GenerateResponse } from "./generate.worker";
import type { PlaySnapshot } from "./gameStore";
import { DEFAULT_DIFFICULTY, GameStore, initialSnapshot } from "./gameStore";
import { createLiarPlay, liarSummaryOf } from "./liar";
import { LiarPool } from "./liarPool";
import type { PlayState } from "./logic";
import { cellsLeft, resumeSelection } from "./logic";
import type { ModeId } from "./modes";
import { DEFAULT_MODE, MODES, legacyModeOf, modeDef, slotKey } from "./modes";
import type { SavedPlay } from "./savedPlay";
import { liarDayKey, parseSavedLiarDay, parseSavedPlay, summaryOf } from "./savedPlay";

export type { Phase, PlaySnapshot } from "./gameStore";
export type { ModeId } from "./modes";
export type { SavedPlay } from "./savedPlay";
export { parseSavedPlay, summaryOf } from "./savedPlay";

/** Сложность Лжеца дня (план режимов §1.5: medium строится за десятки мс — без заготовки). */
export const LIAR_DAILY_DIFFICULTY: Difficulty = "medium";

/**
 * Потолок ожидания генерации партии, мс (план режимов §1.5): easy–hard — p95 ≤ 0,6 с, max < 1 с на десктопе; expert/master —
 * хвост до ~3 с (на телефоне дольше). Дольше — Worker обрывается, экран показывает «Не удалось» с повтором.
 */
export const GENERATION_TIMEOUT_MS: Readonly<Record<Difficulty, number>> = { easy: 15_000, medium: 15_000, hard: 15_000, expert: 45_000, master: 45_000 };

/** Ключ истории поимок (сравнение «с собой» на карточке Лжеца): локально, не синхронизируется. */
export const LIAR_HISTORY_KEY = "liarHistory";
const LIAR_HISTORY_MAX = 200;

/** Запись истории: партия Лжеца, где лжец пойман (`id` — момент старта партии, ISO). */
export interface LiarHistoryEntry {
  readonly id: string;
  readonly catchPlacement: number;
}

/** Лжец дня для шита режима и «Продолжить»: нет записи / идёт / решён (с итогом). */
export type LiarDayState =
  | { readonly kind: "none" }
  | { readonly kind: "playing"; readonly summary: SlotSummary }
  | { readonly kind: "solved"; readonly timeMs: number };

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
  /** PD-171: живая партия — Лжец дня этой даты (`YYYY-MM-DD`); свободная партия — `null`. */
  readonly daily?: string | null;
  /** PD-171: растёт, когда изменились записи Лжеца дня (шит/«Продолжить» перечитывают состояние). */
  readonly dailyRev?: number;
  /** PD-225: растёт, когда слот режима удалён с хаба или возвращён «Отменить» (строки хаба перечитывают `slots()`). */
  readonly slotsRev?: number;
}

/** Единственный ключ записи Play до PD-167 (`meta:playGame`): читается только ради переноса в слот режима. */
export const PLAY_META_KEY = "playGame";
export { slotKey };

export interface PlayDeps {
  storage: Pick<SyncStorage, "getMeta" | "setMeta">;
  /** PD-171: Лжец дня входит в снапшот синхронизации — сообщить о прогрессе/решении. Нет — без синхронизации (тесты). */
  notify?: (event: SyncEvent) => void;
  /** PD-171: заготовки тяжёлых классов Лжеца. Нет — генерация всегда в момент старта. */
  pool?: LiarPool | null;
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
  /** PD-171: записи Лжеца дня в памяти (зеркало `meta:liar:<дата>`): прочитанные и сыгранные в этой сессии. */
  private readonly dailies = new Map<string, SavedPlay & { daily: string }>();
  /** PD-171: история поимок (сравнение с собой). */
  private liarHistory: LiarHistoryEntry[] = [];
  private generationTimer: number | null = null;

  /**
   * `deps` — куда писать партии. Без них (тесты, `new PlayStore()`) хранилище работает только в памяти;
   * боевой `playStore` создаётся с IndexedDB и читает слоты в `restore()`.
   */
  constructor(deps: PlayDeps | null = null) {
    super({ ...initialSnapshot(), hub: true, mode: DEFAULT_MODE, picks: {}, reselect: 0, restoring: deps !== null, daily: null, dailyRev: 0, slotsRev: 0 });
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
    if (s.daily) {
      this.persistDaily(s.daily);
      return;
    }
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

  /**
   * Лжец дня: запись `meta:liar:<дата>` (не слот — переживает решение). Момент решения ставится один раз. Синхронизация узнаёт о
   * прогрессе (`progress` — только пометка) и о решении (`solved` — отправка), как у дня Today.
   */
  private persistDaily(date: string): void {
    const s = this.snap;
    if (!s.play) return;
    const prev = this.dailies.get(date);
    const solvedAt = s.play.solved ? (prev?.solvedAt ?? new Date().toISOString()) : null;
    const rec: SavedPlay & { daily: string } = {
      v: 1,
      mode: "liar",
      difficulty: s.difficulty,
      startedOn: s.startedOn.toISOString(),
      play: s.play,
      elapsedMs: this.getElapsedMs(),
      selected: s.selected,
      notesMode: s.notesMode,
      ...((s.hints ?? 0) > 0 ? { hints: s.hints } : {}),
      ...(s.assisted === true ? { assisted: true } : {}),
      daily: date,
      solvedAt,
    };
    this.dailies.set(date, rec);
    const { deps } = this;
    if (!deps) return;
    this.write(() => deps.storage.setMeta(liarDayKey(date), rec));
    if (s.play.solved && !prev?.play.solved) void this.writes.then(() => deps.notify?.("solved"));
    else if (!s.play.solved && (s.play.log.length > 0 || (s.play.accusations?.length ?? 0) > 0)) deps.notify?.("progress");
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

  /** Решено: таймер уже остановлен на последнем ходе — дописываем точное время и итог; Лжец — ещё и в историю поимок. */
  protected override onSolved(play: PlayState): void {
    this.persist();
    const sum = liarSummaryOf(play);
    if (sum && sum.catchPlacement !== null) this.recordCatch({ id: this.snap.startedOn.toISOString(), catchPlacement: sum.catchPlacement });
  }

  private recordCatch(entry: LiarHistoryEntry): void {
    if (this.liarHistory.some((e) => e.id === entry.id)) return;
    this.liarHistory = [...this.liarHistory, entry].slice(-LIAR_HISTORY_MAX);
    const { deps } = this;
    const list = this.liarHistory;
    if (deps) this.write(() => deps.storage.setMeta(LIAR_HISTORY_KEY, list));
  }

  /**
   * Сравнение с собой (план режимов §1.2: серверной статистики нет и не будет): средний «ход обвинения» по ДРУГИМ пойманным
   * партиям этого устройства. `null` — сравнивать не с чем (первая поимка).
   */
  liarAverage(): { avg: number; games: number } | null {
    const id = this.snap.startedOn.toISOString();
    const other = this.liarHistory.filter((e) => e.id !== id);
    if (other.length === 0) return null;
    return { avg: Math.round(other.reduce((a, e) => a + e.catchPlacement, 0) / other.length), games: other.length };
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
    // PD-171: Лжец дня сегодня (строка «Продолжить» хаба) и история поимок (сравнение с собой на карточке).
    await this.loadDaily(localDate(), read);
    const hist = await read(LIAR_HISTORY_KEY);
    if (Array.isArray(hist)) {
      const ok = hist.filter(
        (e): e is LiarHistoryEntry =>
          typeof e === "object" && e !== null && typeof (e as LiarHistoryEntry).id === "string" && Number.isInteger((e as LiarHistoryEntry).catchPlacement) && (e as LiarHistoryEntry).catchPlacement >= 0,
      );
      const known = new Set(this.liarHistory.map((e) => e.id));
      this.liarHistory = [...ok.filter((e) => !known.has(e.id)), ...this.liarHistory].slice(-LIAR_HISTORY_MAX);
    }
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

  /** Живая партия не решена (она — слот своего режима; Лжец дня — своя запись). */
  hasSlot(): boolean {
    return this.snap.phase === "playing" && this.snap.play !== null;
  }

  // ---- Лжец дня (PD-171) --------------------------------------------------------------------

  /** Прочитать запись Лжеца дня из хранилища (живая партия этой даты главнее). */
  private async loadDaily(date: string, read?: (key: string) => Promise<unknown>): Promise<void> {
    const { deps } = this;
    if (!deps) return;
    let raw: unknown;
    try {
      raw = read ? await read(liarDayKey(date)) : await deps.storage.getMeta(liarDayKey(date));
    } catch {
      return;
    }
    const rec = parseSavedLiarDay(raw, date);
    if (!rec || this.snap.daily === date) return;
    this.dailies.set(date, rec);
    this.set({ dailyRev: (this.snap.dailyRev ?? 0) + 1 });
  }

  /** Перечитать Лжеца дня (открыт шит Лжеца, вернулись на хаб): запись могла прийти из синхронизации. */
  refreshDaily(date: string = localDate()): void {
    void this.loadDaily(date);
  }

  /** Состояние Лжеца дня для шита режима и «Продолжить». */
  liarDay(date: string = localDate()): LiarDayState {
    const s = this.snap;
    if (s.daily === date && s.play && (s.phase === "playing" || s.phase === "solved")) {
      if (s.play.solved) return { kind: "solved", timeMs: this.getElapsedMs() };
      return { kind: "playing", summary: { difficulty: s.difficulty, left: cellsLeft(s.play), elapsedMs: this.getElapsedMs(), ink: false } };
    }
    const rec = this.dailies.get(date);
    if (!rec) return { kind: "none" };
    if (rec.play.solved) return { kind: "solved", timeMs: rec.elapsedMs };
    return { kind: "playing", summary: summaryOf(rec) };
  }

  /** «Продолжить» хаба: незаконченный Лжец дня с прогрессом (ход или обвинение). */
  liarDaySlot(date: string = localDate()): SlotSummary | null {
    const st = this.liarDay(date);
    if (st.kind !== "playing") return null;
    const s = this.snap;
    const play = s.daily === date && s.play ? s.play : this.dailies.get(date)?.play;
    if (!play || (play.log.length === 0 && (play.accusations?.length ?? 0) === 0)) return null;
    return st.summary;
  }

  /**
   * Открыть Лжеца дня: есть запись (идёт или решён) — она поднимается на доску (решённый — сразу карточка); нет — строится
   * `dailyLiarPuzzle(date, medium)` в Worker. Живая свободная партия паркуется в свой слот.
   */
  startDaily(date: string = localDate()): void {
    const s = this.snap;
    if (s.daily === date && s.play && (s.phase === "playing" || s.phase === "solved")) {
      if (s.hub) this.set({ hub: false });
      return;
    }
    this.park();
    this.cancelGeneration();
    const rec = this.dailies.get(date);
    if (rec) {
      this.resumeGame(rec.play, rec.elapsedMs, {
        hub: false,
        mode: "liar",
        daily: date,
        restoring: false,
        difficulty: rec.difficulty,
        startedOn: new Date(rec.startedOn),
        selected: resumeSelection(rec.play, rec.selected),
        notesMode: rec.notesMode,
        hints: rec.hints ?? 0,
        assisted: rec.assisted === true,
      });
      return;
    }
    const id = this.requestId;
    this.resetToLoading({ difficulty: LIAR_DAILY_DIFFICULTY, mode: "liar", daily: date, hub: false, restoring: false });
    this.spawn(id, { id, difficulty: LIAR_DAILY_DIFFICULTY, date, liar: true });
  }

  /** Заготовить тяжёлые сетки Лжеца (вход в режим — открыт его шит). */
  warmLiar(): void {
    void this.deps?.pool?.warm();
  }

  /** «Повторить» после сбоя генерации: та же партия, что не построилась (Лжец дня — снова он). */
  retry(): void {
    const { daily } = this.snap;
    if (daily) {
      this.cancelGeneration();
      const id = this.requestId;
      this.resetToLoading({ difficulty: LIAR_DAILY_DIFFICULTY, mode: "liar", daily, hub: false, restoring: false });
      this.spawn(id, { id, difficulty: LIAR_DAILY_DIFFICULTY, date: daily, liar: true });
      return;
    }
    this.newGame();
  }

  /**
   * Незавершённые игры по режимам — строки хаба со статусом. Живая партия берётся из снапшота (время — накопленное),
   * остальные — из слотов. Режим без незавершённой игры в результате отсутствует.
   */
  slots(): Partial<Record<ModeId, SlotSummary>> {
    const out: Partial<Record<ModeId, SlotSummary>> = {};
    for (const [mode, rec] of this.saved) if (!rec.play.solved) out[mode] = summaryOf(rec);
    const s = this.snap;
    if (this.hasSlot() && s.play && !s.daily) {
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
      this.set({ hub: true, pop: null, wave: null, echo: null, blot: null, hint: null, accusation: null });
      this.persist(); // таймер уже накопился (`holdClock`), `getElapsedMs` вернёт итог
      return;
    }
    this.cancelGeneration();
    this.resetToLoading({ hub: true, restoring: false, daily: null });
    // Лжец дня — не слот: решённый остаётся записью дня (Year/снапшот), а слот свободного Лжеца не трогаем.
    if (!s.daily) this.clearSlot(s.mode);
  }

  private cancelGeneration(): void {
    this.requestId++; // ответ уже запущенной генерации устарел
    this.worker?.terminate();
    this.worker = null;
    if (this.generationTimer !== null) window.clearTimeout(this.generationTimer);
    this.generationTimer = null;
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
    if (s.mode === mode && this.hasSlot() && !s.daily) {
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
      daily: null,
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

  /**
   * PD-225 (design/pd224-swipe-gestures.md §A6): удалить незаконченную свободную партию режима с хаба — свайп строки, пункт
   * «Удалить сетку» меню, кнопка «Удалить». Пишется СРАЗУ (слот → `null`, как `clearSlot`): убитое во время тоста приложение
   * партию не воскресит. Если это живая партия, запаркованная за хабом (вышли тапом по вкладке), сбрасывается и она — иначе
   * тап по строке поднял бы удалённую. С доски не удаляем (только хаб). Выбор сложности, другие слоты, Лжец дня (не слот) и
   * история поимок не трогаются. Синхронизация слоты не читает (`sync/manager.ts` `collectLocal`: дни, сетка, `meta:liar:*`) —
   * удалять на сервере нечего.
   *
   * Возвращает удалённую запись — её вернёт «Отменить» (`restoreSlot`); `null` — удалять нечего.
   */
  discard(mode: ModeId): SavedPlay | null {
    const s = this.snap;
    const live = s.mode === mode && this.hasSlot() && !s.daily;
    if (live && !s.hub) return null;
    if (live) this.persist(); // свежая копия живой партии (накопленное время, выбор) — именно её вернёт «Отменить»
    const rec = this.saved.get(mode);
    if (!rec || rec.play.solved) return null;
    if (live) {
      this.cancelGeneration();
      this.resetToLoading({ hub: true, restoring: false, daily: null });
    }
    this.clearSlot(mode);
    this.set({ slotsRev: (this.snap.slotsRev ?? 0) + 1 });
    return rec;
  }

  /**
   * PD-225: «Отменить» в тосте — запись, которую вернул `discard`, снова слот своего режима (память и IndexedDB, тот же путь, что
   * обычная запись слота). Строка хаба снова «● Не закончена …», тап поднимает партию на доску. Если в режиме тем временем
   * появилась новая партия — её не затираем (`false`).
   */
  restoreSlot(rec: SavedPlay): boolean {
    const mode = rec.mode ?? legacyModeOf(rec.play);
    if (rec.play.solved || this.slots()[mode] !== undefined) return false;
    const s = this.snap;
    if (s.mode === mode && !s.daily && s.phase === "loading" && !s.hub) return false; // новая сетка режима строится
    this.saved.set(mode, rec);
    const { deps } = this;
    if (deps) this.write(() => deps.storage.setMeta(slotKey(mode), rec));
    this.set({ slotsRev: (this.snap.slotsRev ?? 0) + 1 });
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
    if (this.snap.mode !== mode || this.snap.daily) this.park();
    this.newGame(difficulty, mode);
  }

  newGame(difficulty: Difficulty = this.snap.difficulty, mode: ModeId = this.snap.mode): void {
    this.cancelGeneration();
    const id = this.requestId;
    this.clearSlot(mode); // прежняя игра режима закрыта: до первого хода новой записи нет (перезагрузка — без неё)
    this.resetToLoading({ difficulty, mode, picks: { ...this.snap.picks, [mode]: difficulty }, hub: false, restoring: false, daily: null });
    const liar = modeDef(mode).grid === "liar";
    const req: GenerateRequest = { id, difficulty, seed: randomSeed(), ...(liar ? { liar: true } : {}) };
    const pool = liar ? this.deps?.pool : null;
    if (!pool) {
      this.spawn(id, req);
      return;
    }
    // Тяжёлый класс Лжеца — сначала заготовка (§1.5); нет — строим сейчас, экран показывает «Готовим сетку…».
    void pool
      .take(difficulty)
      .catch(() => null)
      .then((ready) => {
        if (id !== this.requestId) return;
        if (ready) this.onGenerated(id, { id, ok: true, puzzle: ready });
        else this.spawn(id, req);
      });
  }

  /** Запустить генерацию в Worker с потолком ожидания (`GENERATION_TIMEOUT_MS`). */
  private spawn(id: number, req: GenerateRequest): void {
    try {
      const worker = new Worker(new URL("./generate.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<GenerateResponse>) => this.onGenerated(id, event.data);
      worker.onerror = () => this.onGenerated(id, { id, ok: false, error: "worker error" });
      worker.postMessage(req);
      this.generationTimer = window.setTimeout(() => this.onGenerated(id, { id, ok: false, error: "timeout" }), GENERATION_TIMEOUT_MS[req.difficulty]);
    } catch {
      this.set({ phase: "error" });
    }
  }

  private onGenerated(id: number, res: GenerateResponse): void {
    if (id !== this.requestId) return; // устаревший ответ (ушли на хаб, начали другую)
    this.worker?.terminate();
    this.worker = null;
    if (this.generationTimer !== null) window.clearTimeout(this.generationTimer);
    this.generationTimer = null;
    if (!res.ok) {
      this.set({ phase: "error" });
      return;
    }
    this.startPuzzle(res.puzzle);
  }

  /** Сетка готова: партия + настройка под режим (`ModeDef.prepare`, лог ещё пуст). Лжец — партия с секретом. */
  protected startPuzzle(puzzle: GeneratedPuzzle | { mission: string; solution: string }): void {
    const liar = "liar" in puzzle ? puzzle.liar : undefined;
    if (liar) {
      this.beginGame(puzzle, {}, createLiarPlay({ mission: puzzle.mission, solution: puzzle.solution, ...liar }));
      this.warmLiar(); // сразу после старта партии — следующая тяжёлая сетка (§1.5)
      return;
    }
    const play = this.beginGame(puzzle);
    const prepare = modeDef(this.snap.mode).prepare;
    if (prepare) {
      const next = prepare(play);
      // PD-208: свежая партия Фонаря начинается в темноте — без выбранной клетки (свет пуст до первого тапа). Возврат в
      // начатую партию (`open`) выбор восстанавливает как обычно: фонарь там, где его оставили.
      if (next !== play) this.set(next.lantern === true ? { play: next, selected: null } : { play: next });
    }
  }
}

export const playStore = new PlayStore({
  storage: syncRuntime.repository,
  notify: (event) => syncRuntime.hooks.notify(event),
  pool:
    typeof Worker === "undefined"
      ? null
      : new LiarPool({
          storage: syncRuntime.repository,
          spawn: () => new Worker(new URL("./generate.worker.ts", import.meta.url), { type: "module" }),
          seed: randomSeed,
        }),
});
void playStore.restore();
