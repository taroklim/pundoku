/**
 * Хранилище экрана Today (PD-12): сетка дня + постоянная сетка Grid ∞.
 *
 * Игровая механика — общий `GameStore` (та же, что в Play). Здесь — откуда берётся сетка дня
 * (`dayResolver`: ответ API либо клиентский фолбэк), сверка при возврате в сеть, проверка решения,
 * прогресс дня и «улёт» последней клетки в Grid ∞ (`permanent`). Хранилище живёт выше вкладок.
 */
import type { Difficulty } from "@pundoku/engine";
import { solve } from "@pundoku/engine";
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
import { InMemoryProgressRepository } from "./repository";

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
  /** Клетка, приземлившаяся в Grid ∞ при решении в ЭТОЙ сессии (id — новый на каждое решение). */
  readonly landing: { readonly cell: number; readonly digit: number; readonly id: number } | null;
}

export interface DayDeps {
  repo: ProgressRepository;
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
  repo: new InMemoryProgressRepository(),
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
    landing: null,
  };
}

const sleep = (ms: number) => new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), ms));

/** Клетка последнего хода лога — позиция, в которой «улетает» клетка дня. */
export function lastMoveCell(play: PlayState): number | null {
  const last = play.log[play.log.length - 1];
  return last ? last.cell : null;
}

export class DayStore extends GameStore<DaySnapshot> {
  private started = false;
  private token = 0;
  private landingSeq = 0;
  private lastKnownDifficulty: Difficulty | null = null;
  private readonly deps: DayDeps;

  constructor(deps: DayDeps = defaultDeps()) {
    super(initialDaySnapshot(localDate(deps.now())));
    this.deps = deps;
  }

  /** Первый показ вкладки Today: слушатели, постоянная сетка, загрузка дня. Идемпотентно. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.watchVisibility();
    window.addEventListener("online", this.refresh);
    document.addEventListener("visibilitychange", this.onVisible);
    void this.loadPermanent();
    void this.load();
  }

  private onVisible = (): void => {
    if (document.visibilityState === "visible") this.refresh();
  };

  // ---- постоянная сетка --------------------------------------------------------------------

  private async loadPermanent(): Promise<void> {
    const saved = await this.deps.repo.getPermanent();
    if (this.snap.permanent) return; // успели приземлить клетку до загрузки
    const state = saved ?? initialPermanent(newInstallSeed());
    if (!saved) await this.deps.repo.savePermanent(state);
    this.set({ permanent: state, permanentSolvable: isSolvable(state) });
  }

  private landOnSolve(play: PlayState): Landing | null {
    const perm = this.snap.permanent ?? initialPermanent(newInstallSeed());
    const preferred = lastMoveCell(play) ?? 0;
    const landing = landDay(perm, this.snap.date, preferred);
    if (!landing) {
      if (!this.snap.permanent) this.set({ permanent: perm, permanentSolvable: isSolvable(perm) });
      return null;
    }
    void this.deps.repo.savePermanent(landing.state);
    return landing;
  }

  // ---- загрузка дня ------------------------------------------------------------------------

  /** Загрузить сегодняшний день: сохранённый прогресс → API (или фолбэк) → игра. */
  async load(): Promise<void> {
    const token = ++this.token;
    const date = localDate(this.deps.now());
    this.resetToLoading({ date, source: null, winRate: null, landing: null, serverVerified: null, offline: false, verification: "local" });

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
    const known = r.ok ? r.puzzle.difficulty : (r.difficulty ?? null);
    if (known) this.lastKnownDifficulty = known;
    return r;
  }

  private async start(token: number, date: string, saved: DayProgress | null, fetched: FetchedDay): Promise<void> {
    if (saved && !fetched.ok) return this.resumeSaved(saved, true); // сохранённое надёжнее фолбэка
    const plan = planDay(date, fetched, this.lastKnownDifficulty);

    if (plan.kind === "server") {
      const solution = solveMission(plan.puzzle.mission);
      if (solution) {
        if (saved) {
          const r = reconcileDay(
            { mission: saved.mission, source: saved.source, hasMoves: saved.play.log.length > 0 },
            plan.puzzle,
          );
          if (r.action === "keep-own") return this.resumeSaved(saved, false, "local");
          if (r.action === "keep") return this.resumeSaved(saved, false, "server", r.puzzle);
        }
        this.begin(plan.puzzle, solution, "server", false);
        return;
      }
      // Мусор в mission (нет единственного решения) — как «ответа не было», но сложность известна.
      return this.start(token, date, saved, { ok: false, reason: "invalid", difficulty: plan.puzzle.difficulty });
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

  private begin(puzzle: DayPuzzle, solution: string, verification: "server" | "local", offline: boolean): void {
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
  }

  private resumeSaved(
    saved: DayProgress,
    offline = false,
    verification: "server" | "local" = saved.verification,
    latest?: DayPuzzle,
  ): void {
    const src = latest ?? saved;
    this.resumeGame(saved.play, saved.elapsedMs, {
      date: saved.date,
      source: src.source,
      difficulty: src.difficulty ?? this.lastKnownDifficulty ?? DAILY_FALLBACK_DIFFICULTY,
      difficultyKnown: src.difficulty !== null,
      winRate: verification === "server" ? src.winRate : null,
      verification,
      serverVerified: saved.serverVerified,
      offline,
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
      void this.load();
      return;
    }
    if (s.date !== today && (s.phase === "solved" || !s.play || s.play.log.length === 0)) {
      void this.load();
      return;
    }
    if (s.date !== today || !shouldRefetch(s.source)) return;
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
        if (solution) this.begin(r.puzzle, solution, "server", false); // молча: ходов не было
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

  private persist(): void {
    const s = this.snap;
    if (!s.play || s.source === null) return;
    const progress: DayProgress = {
      date: s.date,
      mission: s.play.mission.join(""),
      difficulty: s.difficultyKnown ? s.difficulty : null,
      source: s.source,
      winRate: s.winRate,
      play: s.play,
      elapsedMs: this.getElapsedMs(),
      solved: s.phase === "solved",
      serverVerified: s.serverVerified,
      verification: s.verification,
    };
    void this.deps.repo.saveDay(progress);
  }

  protected override onSolved(play: PlayState): void {
    const landing = this.landOnSolve(play);
    this.set(
      landing
        ? {
            permanent: landing.state,
            permanentSolvable: isSolvable(landing.state),
            landing: { cell: landing.cell, digit: landing.digit, id: ++this.landingSeq },
          }
        : {},
    );
    if (this.snap.verification === "server") void this.verifyOnServer(play);
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
    this.started = false;
    this.token++;
  }
}

function solveMission(mission: string): string | null {
  const grid = solve(mission);
  return grid ? grid.join("") : null;
}

export const dayStore = new DayStore();
