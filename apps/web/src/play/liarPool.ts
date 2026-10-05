/**
 * Заготовленные сетки Лжеца для тяжёлых классов (PD-171, план режимов §1.5): expert/master генерируются секунды (p95 ≈ 1,2–1,4 с
 * на десктопе, хвост до ~3 с, на iPhone дольше), поэтому сетку строим ЗАРАНЕЕ — при входе в режим (открыт шит Лжеца) и сразу
 * после старта партии — и кладём в IndexedDB по одной на класс (`meta:liarReady:<класс>`). Выбрал класс, а сетки нет — экран
 * показывает обычное «Готовим сетку…», пока её строит Worker партии.
 *
 * Пул живёт в своём Worker (тот же `generate.worker.ts`) и строит по одной сетке за раз, в фоне; партия ему не мешает: её
 * Worker отдельный. Сетка другой версии генератора (`LIAR_VERSION`) выбрасывается. Генерация дольше `POOL_TIMEOUT_MS`
 * обрывается (Worker завершается) — следующая попытка при следующем входе в режим.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES, LIAR_VERSION } from "@pundoku/engine";
import type { GeneratedPuzzle, GenerateRequest, GenerateResponse } from "./generate.worker";

/** Классы, которые держим заготовленными (easy–hard строятся быстрее бюджета ожидания — в момент старта). */
export const PREFETCH_DIFFICULTIES: readonly Difficulty[] = ["expert", "master"];
/** Потолок фоновой генерации одной сетки, мс (хвост expert/master по замеру ≈ 3 с на десктопе; запас на телефон). */
export const POOL_TIMEOUT_MS = 30_000;

export const poolKey = (d: Difficulty): string => `liarReady:${d}`;

/** Минимальный Worker: только то, что нужно пулу (тесты подставляют фейк). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<GenerateResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(req: GenerateRequest): void;
  terminate(): void;
}

export interface LiarPoolDeps {
  readonly storage: { getMeta(key: string): Promise<unknown>; setMeta(key: string, value: unknown): Promise<void> };
  readonly spawn: () => WorkerLike;
  readonly seed: () => string;
  readonly timeoutMs?: number;
}

/** Годная заготовка: целая сетка Лжеца нужного класса и текущей версии генератора. */
export function isPooled(v: unknown, d: Difficulty): v is GeneratedPuzzle {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<GeneratedPuzzle>;
  const l = p.liar;
  return (
    p.difficulty === d &&
    typeof p.mission === "string" &&
    /^[0-9]{81}$/.test(p.mission) &&
    typeof p.solution === "string" &&
    /^[1-9]{81}$/.test(p.solution) &&
    typeof l === "object" &&
    l !== null &&
    l.version === LIAR_VERSION &&
    Number.isInteger(l.liarCell) &&
    typeof l.honestMission === "string"
  );
}

export class LiarPool {
  private running: Promise<void> | null = null;
  private worker: WorkerLike | null = null;
  /** Классы, которые уже лежат в хранилище (кэш, чтобы не читать IDB на каждый вход). */
  private readonly ready = new Set<Difficulty>();

  constructor(private readonly deps: LiarPoolDeps) {}

  /** Взять заготовку класса (и удалить её из хранилища). Нет/негодна/класс не заготавливается — `null`. */
  async take(d: Difficulty): Promise<GeneratedPuzzle | null> {
    if (!PREFETCH_DIFFICULTIES.includes(d)) return null;
    let raw: unknown;
    try {
      raw = await this.deps.storage.getMeta(poolKey(d));
    } catch {
      return null;
    }
    this.ready.delete(d);
    if (raw !== null) void this.deps.storage.setMeta(poolKey(d), null).catch(() => undefined);
    return isPooled(raw, d) ? raw : null;
  }

  /** Достроить недостающие заготовки в фоне (идемпотентно: идущий прогрев не дублируется). */
  warm(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.fill().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Остановить фоновую генерацию (тесты, выгрузка). */
  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private async fill(): Promise<void> {
    for (const d of PREFETCH_DIFFICULTIES) {
      if (this.ready.has(d)) continue;
      let have: unknown;
      try {
        have = await this.deps.storage.getMeta(poolKey(d));
      } catch {
        return; // хранилище недоступно — заготавливать некуда
      }
      if (isPooled(have, d)) {
        this.ready.add(d);
        continue;
      }
      const puzzle = await this.generate(d);
      if (!puzzle) return; // сбой/таймаут — не крутимся; попробуем при следующем входе в режим
      try {
        await this.deps.storage.setMeta(poolKey(d), puzzle);
        this.ready.add(d);
      } catch {
        return;
      }
    }
  }

  private generate(difficulty: Difficulty): Promise<GeneratedPuzzle | null> {
    if (!DIFFICULTIES.includes(difficulty)) return Promise.resolve(null);
    return new Promise((resolve) => {
      let worker: WorkerLike;
      try {
        worker = this.deps.spawn();
      } catch {
        resolve(null);
        return;
      }
      this.worker = worker;
      const done = (p: GeneratedPuzzle | null) => {
        window.clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        resolve(p);
      };
      const timer = window.setTimeout(() => done(null), this.deps.timeoutMs ?? POOL_TIMEOUT_MS);
      worker.onmessage = (e) => done(e.data.ok && isPooled(e.data.puzzle, difficulty) ? e.data.puzzle : null);
      worker.onerror = () => done(null);
      worker.postMessage({ id: 1, difficulty, seed: this.deps.seed(), liar: true });
    });
  }
}
