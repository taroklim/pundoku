/**
 * Хранилище экрана Today (PD-12): сетка дня + постоянная сетка Grid ∞.
 *
 * Игровая механика — общий `GameStore` (та же, что в Play). Здесь — откуда берётся сетка дня
 * (`dayResolver`: ответ API либо клиентский фолбэк), сверка при возврате в сеть, проверка решения,
 * прогресс дня и «улёт» последней клетки в Grid ∞ (`permanent`). Хранилище живёт выше вкладок.
 */
import type { Difficulty } from "@pundoku/engine";
import { INK_RULES, solve } from "@pundoku/engine";
import type { GenerateRequest, GenerateResponse } from "../play/generate.worker";
import type { PlaySnapshot } from "../play/gameStore";
import { GameStore, initialSnapshot } from "../play/gameStore";
import type { PlayState } from "../play/logic";
import { fetchDaily, verifyDaily } from "./api";
import type { DayPuzzle, DaySource, FetchedDay } from "./dayResolver";
import {
  DAILY_FALLBACK_DIFFICULTY,
  fallbackDay,
  localDate,
  planDay,
  reconcileDay,
  shouldRefetch,
  verifyMode,
} from "./dayResolver";
import type { Landing, PermanentGridState } from "./permanent";
import { initialPermanent, isSolvable, landDay, newInstallSeed } from "./permanent";
import type { DayProgress, ProgressRepository } from "./repository";
import { sync as syncRuntime } from "../sync/runtime";
import type { RemoteApplied, SyncHooks } from "../sync/manager";
import { readUseStart } from "../year/firstUse";

export interface DaySnapshot extends PlaySnapshot {
  /** Локальная дата сетки, `YYYY-MM-DD`. */
  readonly date: string;
  readonly source: DaySource | null;
  /** `false` — сложность источника неизвестна движку: подпись без сложности. */
  readonly difficultyKnown: boolean;
  readonly winRate: number | null;
  /** Кто проверяет решение: сервер (`POST verify`) или локально. */
  readonly verification: "server" | "local";
  /** Ответ сервера на verify (`null` — не проверялось/нет ответа). */
  readonly serverVerified: boolean | null;
  /** Последняя попытка достать день у API не удалась — играем без подтверждения источника. */
  readonly offline: boolean;
  readonly permanent: PermanentGridState | null;
  readonly permanentSolvable: boolean;
  /** Архив: этой даты играть нельзя (сегодня/будущее, раньше начала пользования, кривая дата, сервер ответил 400/404) — фаза `error` без повтора. */
  readonly unavailable: boolean;
  /** День решён после своей даты (дата дня < даты решения): в Year остаётся пропуском. Известно только у решённого. */
  readonly late: boolean;
  /** Клетка, приземлившаяся в Grid ∞ при решении в ЭТОЙ сессии (id — новый на каждое решение). */
  readonly landing: { readonly cell: number; readonly digit: number; readonly id: number } | null;
}

export interface DayDeps {
  repo: ProgressRepository;
  /**
   * Архив: начало пользования (как в Year, `year/firstUse.ts › readUseStart`) — дни раньше него недоступны, как будущее.
   * `null` — не определить (хранилище не читается) или не задано: границы нет.
   */
  useStart?: (today: string) => Promise<string | null>;
  sync?: SyncHooks;
  fetchDay: (date: string) => Promise<FetchedDay>;
  verify: (date: string, grid: string) => Promise<boolean | null>;
  /** Клиентский фолбэк: только `dailyPuzzle(date, difficulty)` (в браузере — в Web Worker). */
  generateFallback: (date: string, difficulty: Difficulty) => Promise<{ mission: string; solution: string }>;
  now: () => Date;
  isOnline: () => boolean;
  /** Сколько ждать ответ API, прежде чем начать играть фолбэком (ответ, если придёт, сверится). */
  slowFetchMs: number;
}

export const SLOW_FETCH_FALLBACK_MS = 2500;
/** Сколько Today ждёт восстановления с сервера при старте, прежде чем играть локальным. */
export const RESTORE_WAIT_MS = 1500;

/** Фолбэк дня в Web Worker: `dailyPuzzle` для тяжёлых сложностей бывает секундами. */
function workerFallback(date: string, difficulty: Difficulty): Promise<{ mission: string; solution: string }> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(new URL("../play/generate.worker.ts", import.meta.url), { type: "module" });
      const done = (fn: () => void) => {
        worker.terminate();
        fn();
      };
      worker.onmessage = (e: MessageEvent<GenerateResponse>) =>
        done(() => (e.data.ok ? resolve(e.data.puzzle) : reject(new Error(e.data.error))));
      worker.onerror = () => done(() => reject(new Error("worker error")));
      const req: GenerateRequest = { id: 1, difficulty, date };
      worker.postMessage(req);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export const defaultDeps = (): DayDeps => ({
  repo: syncRuntime.repository,
  useStart: (today) => readUseStart(syncRuntime.repository, today),
  sync: syncRuntime.hooks,
  fetchDay: (date) => fetchDaily(date),
  verify: (date, grid) => verifyDaily(date, grid),
  generateFallback: workerFallback,
  now: () => new Date(),
  isOnline: () => navigator.onLine,
  slowFetchMs: SLOW_FETCH_FALLBACK_MS,
});

function initialDaySnapshot(date: string): DaySnapshot {
  return {
    ...initialSnapshot(),
    date,
    source: null,
    difficultyKnown: true,
    winRate: null,
    verification: "local",
    serverVerified: null,
    offline: false,
    permanent: null,
    permanentSolvable: false,
    unavailable: false,
    late: false,
    landing: null,
  };
}

const sleep = (ms: number) => new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), ms));

/** Клетка последнего хода лога — позиция, в которой «улетает» клетка дня. */
export function lastMoveCell(play: PlayState): number | null {
  const last = play.log[play.log.length - 1];
  return last ? last.cell : null;
}

/**
 * Дата, которую можно играть как архивную: существующая дата `YYYY-MM-DD` СТРОГО раньше сегодняшней.
 * Сегодняшний день ведёт вкладка Today (свой стор), будущее сервер отдаёт как 400/404 — и то и другое
 * в архиве недоступно.
 */
export function isArchiveDate(date: string, today: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return false;
  return date < today;
}

export interface DayStoreOptions {
  /**
   * Архивный стор (PD-33): играет ОДНУ прошлую дату, заданную `openArchive(date)`, а не «сегодня». Отдельный
   * экземпляр — состояние сегодняшнего дня и Grid ∞ он не трогает: свой снапшот, своя запись дня по своей дате,
   * без постоянной сетки (доигранный архивный день в Grid ∞ не «улетает»), без смены суток.
   */
  archive?: boolean;
}

export class DayStore extends GameStore<DaySnapshot> {
  private started = false;
  private token = 0;
  private landingSeq = 0;
  private lastKnownDifficulty: Difficulty | null = null;
  private readonly deps: DayDeps;
  /** Записи в хранилище в полёте: порядок держит сама IndexedDB (транзакции одного хранилища идут по очереди), `notify` ждёт их все. */
  private inflight = new Set<Promise<unknown>>();
  private unsubscribeRemote: (() => void) | null = null;
  private restore: Promise<void> | null = null;
  /** Итог дня для снапшота/Year: момент решения и «поздно» — фиксируются при первом решении. */
  private solvedAt: string | null = null;
  private late = false;
  private assisted = false;
  /** >0 — идёт замена записи дня победителем слияния: `persist` молчит, чтобы не записать проигравшую (PD-43). */
  private holdPersist = 0;
  private readonly archive: boolean;
  /** Архив: играемая дата (задаётся `openArchive`); у стора «сегодня» не используется. */
  private targetDate: string | null = null;

  constructor(deps: DayDeps = defaultDeps(), options: DayStoreOptions = {}) {
    super(initialDaySnapshot(localDate(deps.now())));
    this.deps = deps;
    this.archive = options.archive === true;
  }

  /** Ink (PD-71): на Today — да; в архиве — только если правила (`INK_RULES.allowInArchive`) это разрешают. */
  protected override inkAllowed(): boolean {
    return !this.archive || INK_RULES.allowInArchive;
  }

  private attach(): boolean {
    if (this.started) return false;
    this.started = true;
    this.watchVisibility();
    window.addEventListener("online", this.refresh);
    document.addEventListener("visibilitychange", this.onVisible);
    this.unsubscribeRemote = this.deps.sync?.subscribeRemote(this.applyRemote) ?? null;
    return true;
  }

  /** Первый показ вкладки Today: слушатели, постоянная сетка, загрузка дня. Идемпотентно. */
  ensureStarted(): void {
    if (this.archive || !this.attach()) return;
    void this.loadPermanent();
    void this.load();
  }

  /** Архив: открыть прошлую дату (слушатели, загрузка). Повторный вызов с другой датой — загрузка новой. */
  openArchive(date: string): void {
    if (!this.archive) throw new Error("openArchive: только для архивного DayStore");
    this.targetDate = date;
    this.attach();
    void this.load();
  }

  /**
   * Архив: экран закрыт — сохранить накопленное время, отписаться, сбросить снапшот в «загрузку»
   * (следующее открытие не покажет чужую партию даже на кадр).
   */
  closeArchive(): void {
    if (!this.archive) return;
    this.persist();
    this.dispose();
    this.resetToLoading({ source: null, winRate: null, landing: null, serverVerified: null, offline: false, verification: "local", unavailable: false, late: false });
  }

  private onVisible = (): void => {
    if (document.visibilityState === "visible") this.refresh();
    else this.persist(); // таймер уже остановился (слушатель GameStore): сохранить накопленное время
  };

  private write(job: () => Promise<unknown>): Promise<unknown> {
    const p: Promise<unknown> = job().catch(() => undefined); // сбой хранилища не должен ронять игру
    this.inflight.add(p);
    void p.then(() => this.inflight.delete(p));
    return p;
  }

  private writesSettled(): Promise<unknown> {
    return Promise.all([...this.inflight]);
  }

  /** Ждать восстановления с сервера один раз за сессию: игра не зависит от сети дольше `RESTORE_WAIT_MS`. */
  private awaitRestore(): Promise<void> {
    if (!this.deps.sync) return Promise.resolve();
    this.restore ??= this.deps.sync.whenReady(RESTORE_WAIT_MS);
    return this.restore;
  }

  /** Сервер дописал в локальное хранилище решённые дни/Grid ∞ (восстановление, слияние после 409). */
  private applyRemote = (info: RemoteApplied): void => {
    if (!this.started) return;
    // Сначала день: пока снапшот держит проигравшую запись, ни одно `persist` не должно её записать поверх победителя.
    if (info.dates.includes(this.snap.date)) {
      if (this.snap.phase === "solved") void this.reloadSolved();
      else if (this.snap.phase !== "loading") void this.load();
    }
    if (info.gridChanged && !this.archive) {
      void this.deps.repo.getPermanent().then((state) => {
        // Запись дня тут не нужна: `set()` → `persist()` затёр бы в хранилище запись, пришедшую с сервера (PD-43).
        if (state) this.patchQuiet({ permanent: state, permanentSolvable: isSolvable(state) });
      });
    }
  };

  /**
   * Слияние заменило запись уже решённого на этом экране дня (у победителя другая сетка/`winRate`/`verification`):
   * показать победившую запись без прохода через «загрузку» и не записывать проигравшую обратно (PD-43).
   * Победитель всегда решён (`applyLocally` пишет только `solved`-записи), поэтому не решённая запись — не наш случай.
   */
  private async reloadSolved(): Promise<void> {
    const token = ++this.token;
    const date = this.snap.date;
    this.holdPersist++;
    try {
      await this.writesSettled();
      const saved = await this.deps.repo.getDay(date);
      if (token !== this.token || this.snap.date !== date || !saved?.solved) return;
      this.resumeSaved(saved);
    } finally {
      this.holdPersist--;
    }
  }

  // ---- постоянная сетка --------------------------------------------------------------------

  private async loadPermanent(): Promise<void> {
    await this.awaitRestore();
    const saved = await this.deps.repo.getPermanent();
    if (this.snap.permanent) return; // успели приземлить клетку до загрузки
    const state = saved ?? initialPermanent(newInstallSeed());
    if (!saved) await this.write(() => this.deps.repo.savePermanent(state));
    this.set({ permanent: state, permanentSolvable: isSolvable(state) });
  }

  private landOnSolve(play: PlayState): Landing | null {
    if (this.archive) return null; // архивный день в Grid ∞ не летит (и постоянную сетку стор не держит)
    const perm = this.snap.permanent ?? initialPermanent(newInstallSeed());
    const preferred = lastMoveCell(play) ?? 0;
    const landing = landDay(perm, this.snap.date, preferred);
    if (!landing) {
      if (!this.snap.permanent) this.set({ permanent: perm, permanentSolvable: isSolvable(perm) });
      return null;
    }
    void this.write(() => this.deps.repo.savePermanent(landing.state));
    return landing;
  }

  // ---- загрузка дня ------------------------------------------------------------------------

  /**
   * Загрузить день (сегодняшний; в архиве — заданную дату): сохранённый прогресс → API (или фолбэк) → игра.
   * Архив: дата не из прошлого/несуществующая — сразу `unavailable`, без сети и без записи в хранилище.
   */
  async load(): Promise<void> {
    const token = ++this.token;
    const today = localDate(this.deps.now());
    const date = this.archive ? (this.targetDate ?? today) : today;
    this.solvedAt = null;
    this.late = false;
    this.assisted = false;
    this.resetToLoading({ date, source: null, winRate: null, landing: null, serverVerified: null, offline: false, verification: "local", unavailable: false, late: false });
    if (this.archive && !isArchiveDate(date, today)) {
      this.set({ phase: "error", unavailable: true });
      return;
    }

    await this.awaitRestore();
    if (token !== this.token) return;
    await this.writesSettled(); // не читать день, пока не дописан предыдущий
    if (this.archive) {
      // День раньше начала пользования Year не предлагает — прямой URL тоже не открывает: без фолбэка, без запроса
      // сетки и без записи (граница архива — firstUseDate: играть раньше первого дня пользования нельзя, хотя запись теперь и так сдвигает старт года, PD-51).
      const start = (await this.deps.useStart?.(today)) ?? null;
      if (token !== this.token) return;
      if (start !== null && date < start) {
        this.set({ phase: "error", unavailable: true });
        return;
      }
    }
    const saved = await this.deps.repo.getDay(date);
    if (token !== this.token) return;
    if (saved?.solved) {
      // Решённый день финален: без сети, без анимации — сразу карточка.
      this.resumeSaved(saved);
      return;
    }

    const online = this.deps.isOnline();
    const fetchP = online ? this.fetchDay(date) : null;
    const first = fetchP ? await Promise.race([fetchP, sleep(this.deps.slowFetchMs)]) : "slow";
    if (token !== this.token) return;

    if (first !== "slow") {
      await this.start(token, date, saved, first);
      return;
    }
    // Ответа нет (офлайн или медленный сервер): играем то, что есть, ответ (если придёт) сверится.
    await this.start(token, date, saved, { ok: false, reason: "network" });
    if (token !== this.token) return;
    if (fetchP) {
      const late = await fetchP;
      if (token === this.token) await this.applyLatest(late);
    }
  }

  private async fetchDay(date: string): Promise<FetchedDay> {
    const r = await this.deps.fetchDay(date);
    // Метка сложности Sudoku.com — не сложность генератора (`dailyPuzzle` её не знает): запоминаем только
    // сложность `generator`, иначе фолбэк новой даты зависел бы от истории сессии.
    const known = r.ok ? generatorDifficulty(r.puzzle) : (r.difficulty ?? null);
    if (known) this.lastKnownDifficulty = known;
    return r;
  }

  private async start(token: number, date: string, saved: DayProgress | null, fetched: FetchedDay): Promise<void> {
    if (saved && !fetched.ok) return this.resumeSaved(saved, true); // сохранённое надёжнее фолбэка
    // Архив: сервер сказал «такой даты нет» (400 future_date / 404 not_available_yet) — фолбэк-сетку НЕ строим:
    // сетка ещё не существует, а сгенерированная заранее не совпала бы с настоящей.
    if (this.archive && !fetched.ok && fetched.reason === "http" && (fetched.status === 400 || fetched.status === 404)) {
      this.set({ phase: "error", unavailable: true });
      return;
    }
    const plan = planDay(date, fetched, this.lastKnownDifficulty);

    if (plan.kind === "server") {
      const solution = solveMission(plan.puzzle.mission);
      if (solution) {
        if (saved) {
          const r = reconcileDay(
            { mission: saved.mission, source: saved.source, hasMoves: saved.play.log.length > 0 },
            plan.puzzle,
          );
          // win rate относится к чужой (серверной) сетке — у своей его нет (PD-37: в записи он мог остаться от старой сверки)
          if (r.action === "keep-own") return this.resumeSaved({ ...saved, winRate: null }, false, "local");
          if (r.action === "keep") return this.resumeSaved(saved, false, "server", r.puzzle);
        }
        this.begin(plan.puzzle, solution, "server", false, saved?.play.ink === true);
        return;
      }
      // Мусор в mission (нет решения) — как «ответа не было»; сложность берём только у `generator`.
      return this.start(token, date, saved, { ok: false, reason: "invalid", difficulty: generatorDifficulty(plan.puzzle) });
    }

    try {
      const gen = await this.deps.generateFallback(plan.date, plan.difficulty);
      if (token !== this.token) return;
      const { puzzle, solution } = fallbackDay(plan.date, plan.difficulty, () => gen);
      this.begin(puzzle, solution, "local", true);
    } catch {
      if (token === this.token) this.set({ phase: "error" });
    }
  }

  /** `ink` — сетка заменяется до первого хода (выбор Чернильного режима не теряется вместе с партией). */
  private begin(puzzle: DayPuzzle, solution: string, verification: "server" | "local", offline: boolean, ink = false): void {
    this.beginGame(
      { mission: puzzle.mission, solution },
      {
        date: puzzle.date,
        source: puzzle.source,
        difficulty: puzzle.difficulty ?? this.lastKnownDifficulty ?? DAILY_FALLBACK_DIFFICULTY,
        difficultyKnown: puzzle.difficulty !== null,
        winRate: puzzle.winRate,
        verification,
        serverVerified: null,
        offline,
        landing: null,
      },
    );
    if (ink) this.setInk(true);
  }

  private resumeSaved(
    saved: DayProgress,
    offline = false,
    verification: "server" | "local" = saved.verification,
    latest?: DayPuzzle,
  ): void {
    const src = latest ?? saved;
    this.solvedAt = saved.solvedAt;
    this.late = saved.late;
    this.assisted = saved.assisted;
    this.resumeGame(saved.play, saved.elapsedMs, {
      date: saved.date,
      source: src.source,
      difficulty: src.difficulty ?? this.lastKnownDifficulty ?? DAILY_FALLBACK_DIFFICULTY,
      difficultyKnown: src.difficulty !== null,
      // Сохранённый winRate уже относится к сохранённой сетке (у чужой/клиентской его нет — см. `persist`,
      // `keep-own`), поэтому от `verification` он не зависит: у записи, восстановленной с сервера или подменённой
      // слиянием (`progressFromRecord`), `verification` всегда "local", а winRate в ней настоящий (PD-37).
      winRate: src.winRate,
      verification,
      serverVerified: saved.serverVerified,
      offline,
      late: saved.late,
      landing: null,
    });
  }

  // ---- возврат в сеть ----------------------------------------------------------------------

  /** Онлайн/возврат в приложение: сверить сетку с сервером, при смене суток — загрузить новый день. */
  refresh = (): void => {
    const s = this.snap;
    const today = localDate(this.deps.now());
    if (s.phase === "loading") return;
    if (s.phase === "error") {
      if (!s.unavailable) void this.load(); // «даты нет» сетью не лечится
      return;
    }
    if (!this.archive) {
      if (s.date !== today && (s.phase === "solved" || !s.play || s.play.log.length === 0)) {
        void this.load();
        return;
      }
      if (s.date !== today) return;
    }
    if (!shouldRefetch(s.source)) return;
    const token = this.token;
    void this.fetchDay(s.date).then((r) => (token === this.token ? this.applyLatest(r) : undefined));
  };

  /** Свежий ответ API против играемой сетки (`reconcileDay`). */
  private async applyLatest(fetched: FetchedDay): Promise<void> {
    const s = this.snap;
    if (!s.play || s.phase === "solved" || s.source === null) return;
    if (!fetched.ok) {
      if (!s.offline) this.set({ offline: true });
      return;
    }
    const r = reconcileDay(
      { mission: s.play.mission.join(""), source: s.source, hasMoves: s.play.log.length > 0 },
      fetched.puzzle,
    );
    switch (r.action) {
      case "none":
        return;
      case "keep":
        this.set({
          source: r.puzzle.source,
          winRate: r.puzzle.winRate,
          difficulty: r.puzzle.difficulty ?? s.difficulty,
          difficultyKnown: r.puzzle.difficulty !== null,
          verification: verifyMode(s.play.mission.join(""), r.puzzle.mission),
          offline: false,
        });
        return;
      case "replace": {
        const solution = solveMission(r.puzzle.mission);
        if (solution) this.begin(r.puzzle, solution, "server", false, s.play.ink === true); // молча: ходов не было
        return;
      }
      case "keep-own":
        // Играем свою сетку до конца; win rate относится к чужой сетке — не показываем.
        this.set({ verification: r.verify, winRate: null, offline: false });
        return;
    }
  }

  // ---- решение и прогресс ------------------------------------------------------------------

  protected override set(patch: Partial<DaySnapshot>): void {
    super.set(patch);
    this.persist();
  }

  /** Отклик на отказ (PD-117b) — не прогресс: ни записи дня, ни события синхронизации. */
  protected override setTransient(patch: Partial<DaySnapshot>): void {
    this.patchQuiet(patch);
  }

  /** Обновить снапшот, не трогая запись дня в хранилище (данные пришли из него же). */
  private patchQuiet(patch: Partial<DaySnapshot>): void {
    super.set(patch);
  }

  private persist(): void {
    const s = this.snap;
    if (!s.play || s.source === null || this.holdPersist > 0) return;
    const solved = s.phase === "solved";
    if (solved && this.solvedAt === null) {
      const now = this.deps.now();
      this.solvedAt = now.toISOString();
      this.late = s.date < localDate(now);
    }
    const progress: DayProgress = {
      date: s.date,
      mission: s.play.mission.join(""),
      difficulty: s.difficultyKnown ? s.difficulty : null,
      source: s.source,
      winRate: s.winRate,
      play: s.play,
      elapsedMs: this.getElapsedMs(),
      solved,
      serverVerified: s.serverVerified,
      verification: s.verification,
      solvedAt: solved ? this.solvedAt : null,
      late: solved && this.late,
      assisted: this.assisted,
    };
    void this.write(() => this.deps.repo.saveDay(progress));
    if (!solved && s.play.log.length > 0) this.deps.sync?.notify("progress");
  }

  protected override onSolved(play: PlayState): void {
    const landing = this.landOnSolve(play);
    this.set(
      landing
        ? {
            permanent: landing.state,
            permanentSolvable: isSolvable(landing.state),
            landing: { cell: landing.cell, digit: landing.digit, id: ++this.landingSeq },
            late: this.late,
          }
        : { late: this.late },
    );
    if (this.snap.verification === "server") void this.verifyOnServer(play);
    // Решён день (и улёт в Grid ∞): снапшот на сервер, когда запись в хранилище завершена.
    void this.writesSettled().then(() => this.deps.sync?.notify("solved"));
  }

  private async verifyOnServer(play: PlayState): Promise<void> {
    const token = this.token;
    const grid = play.mission.map((m, i) => m || play.values[i] || 0).join("");
    const ok = await this.deps.verify(this.snap.date, grid);
    if (token !== this.token) return;
    this.set({ serverVerified: ok });
  }

  /** Экран показал приземление — id больше не нужен для повторного показа. */
  acknowledgeLanding(): void {
    if (this.snap.landing) this.set({ landing: null });
  }

  /** Для тестов и смены сетки: отписаться от событий окна. */
  dispose(): void {
    window.removeEventListener("online", this.refresh);
    document.removeEventListener("visibilitychange", this.onVisible);
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = null;
    this.started = false;
    this.token++;
  }
}

/** Сложность, годная для фолбэка: только у сетки нашего генератора (метка Sudoku.com — чужая шкала). */
function generatorDifficulty(puzzle: DayPuzzle): Difficulty | null {
  return puzzle.source === "generator" ? puzzle.difficulty : null;
}

/** Решение сетки дня (первое найденное; единственность не проверяется — см. README, «Какая сетка дня играется»). */
function solveMission(mission: string): string | null {
  const grid = solve(mission);
  return grid ? grid.join("") : null;
}

export const dayStore = new DayStore();
/** Архив (PD-33): отдельный экземпляр под прошлую дату; сегодняшний день и Grid ∞ не затрагивает. */
export const archiveStore = new DayStore(defaultDeps(), { archive: true });
