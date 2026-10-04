/**
 * Состояние лесенки подсказок (PD-139): открыт ли док, на какой ступени, что подсвечено, показан ли шит правила и строка-намёк.
 *
 * Класс `HintLadder` не знает про React и DOM: он слушает хранилище партии (`GameStore`, общий для Play/Today/архива), считает
 * подсказку по доске игрока (`hintModel.computeHint`) и ведёт ступени 1–4. Экран подписывается хуком `useHintLadder`.
 *
 * Правила, которые здесь зафиксированы (решения владельца + макет PD-133 §4):
 * - «с помощью» ставится ПЕРВЫМ результативным открытием (ступень 1 или ветка «ошибка»); «ничего не нашёл» не считается и не
 *   помечает. Счёт растёт на каждое новое открытие дока, а не на ступень; пересчёт после хода при открытом доке — та же сессия;
 * - перед первой подсказкой за всё время — шит правила (флаг на устройстве, плюс «уже были дни с подсказкой» из хранилища);
 * - закрытие на ступени ≥3 выбирает клетку шага (цифру не называет); подсветки при закрытии снимаются;
 * - перезагрузка закрывает док: `hints`/`assisted` уже в записи, ступени — нет (мелкое решение, задокументировано в README);
 * - строка-намёк: ≥90 с тихого времени без поставленной цифры, ≥5 пустых клеток, шаг существует, один раз на устройство.
 */
import type { Hint } from "@pundoku/engine";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { GameStore, PlaySnapshot } from "./gameStore";
import { cellsLeft } from "./logic";
import type { PlayState } from "./logic";
import { computeHint, hintCellOf, hintFocusCell, hintMarks, HINT_STEPS } from "./hintModel";
import type { HintMarks, HintStep } from "./hintModel";

/** Порог строки-намёка: тихое время без поставленной цифры, мс (макет §3: «порог 90 с — настраиваемый»). */
export const NUDGE_AFTER_MS = 90_000;
/** Как часто хук проверяет условия строки-намёка. */
export const NUDGE_CHECK_MS = 5_000;
const NUDGE_MIN_EMPTY = 5;

export const RULE_KEY = "pundoku.hintRule";
export const NUDGE_KEY = "pundoku.hintNudge";

/** Крошечное хранилище флагов устройства: localStorage, при его недоступности — память до перезагрузки. */
export interface FlagStore {
  get(key: string): boolean;
  set(key: string): void;
}

export function localFlags(): FlagStore {
  const memory = new Set<string>();
  return {
    get(key) {
      if (memory.has(key)) return true;
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    set(key) {
      memory.add(key);
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* флаг живёт до перезагрузки */
      }
    },
  };
}

/** Что ладдеру нужно от хранилища партии. */
export type HintHost = Pick<GameStore, "subscribe" | "getSnapshot" | "hintAllowed" | "registerHint" | "select" | "getElapsedMs">;

export interface HintLadderState {
  readonly open: boolean;
  readonly step: HintStep;
  readonly hint: Hint | null;
  readonly marks: HintMarks | null;
  /** Шит правила виден (первое открытие за всё время). */
  readonly rule: boolean;
  /** Строка-намёк «Stuck? …» вместо «N cells left». */
  readonly nudge: boolean;
  /** Растёт на каждое открытие дока — ключ для фокуса/озвучки. */
  readonly session: number;
}

const CLOSED: HintLadderState = { open: false, step: 1, hint: null, marks: null, rule: false, nudge: false, session: 0 };

export interface HintLadderOptions {
  readonly flags?: FlagStore;
  /** Были ли на устройстве дни с подсказкой (из хранилища прогресса): тогда шит правила уже не нужен. Асинхронно. */
  readonly assistedBefore?: () => Promise<boolean>;
}

export class HintLadder {
  private state: HintLadderState = CLOSED;
  private readonly listeners = new Set<() => void>();
  private readonly flags: FlagStore;
  private derivedSeen = false;
  private registered = false;
  private lastValues: readonly number[] | null = null;
  private lastNotes: readonly number[] | null = null;
  private nudgeFor: { values: readonly number[]; hint: Hint } | null = null;
  private detach: (() => void) | null = null;

  constructor(
    private readonly host: HintHost,
    private readonly opts: HintLadderOptions = {},
  ) {
    this.flags = opts.flags ?? localFlags();
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly getState = (): HintLadderState => this.state;

  /** Подписаться на хранилище партии (вызывает хук при монтировании); возвращает отписку. */
  attach(): () => void {
    if (this.detach) return this.detach;
    const off = this.host.subscribe(this.onHost);
    let alive = true;
    void this.opts.assistedBefore?.().then(
      (seen) => {
        if (alive && seen) this.derivedSeen = true;
      },
      () => undefined,
    );
    this.lastValues = this.host.getSnapshot().play?.values ?? null;
    this.detach = () => {
      alive = false;
      off();
      this.detach = null;
    };
    return this.detach;
  }

  private commit(next: HintLadderState): void {
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }

  private play(): PlayState | null {
    return this.host.getSnapshot().play;
  }

  private ruleSeen(): boolean {
    return this.derivedSeen || (this.host.getSnapshot().hints ?? 0) > 0 || this.flags.get(RULE_KEY);
  }

  // ---- действия ---------------------------------------------------------------------------------

  /** Лампочка: открыть/закрыть. Закрытая лампочка при недоступной подсказке (Ink, решено, загрузка) — ничего. */
  toggle(): void {
    if (this.state.open) this.close();
    else if (this.state.rule) this.dismissRule();
    else this.openLadder();
  }

  openLadder(): void {
    if (!this.host.hintAllowed() || !this.play()) return;
    if (!this.ruleSeen()) {
      this.commit({ ...this.state, rule: true, nudge: false });
      return;
    }
    this.reveal();
  }

  /** «Показать подсказку» на шите правила. */
  confirmRule(): void {
    this.flags.set(RULE_KEY);
    this.commit({ ...this.state, rule: false });
    this.reveal();
  }

  /** «Не сейчас»: ничего не помечено, шит покажется снова при следующем открытии. */
  dismissRule(): void {
    if (this.state.rule) this.commit({ ...this.state, rule: false });
  }

  private reveal(): void {
    const play = this.play();
    if (!play || !this.host.hintAllowed()) return;
    this.flags.set(RULE_KEY);
    this.registered = false;
    this.lastValues = play.values;
    this.lastNotes = play.notes;
    const hint = computeHint(play);
    this.commit({ open: true, step: 1, hint, marks: hintMarks(hint, 1, play.notes), rule: false, nudge: false, session: this.state.session + 1 });
    this.registerIfResult(hint);
  }

  /** Результативное открытие (шаг или ошибка) — ровно один раз за сессию дока. */
  private registerIfResult(hint: Hint): void {
    if (this.registered || hint.kind === "none") return;
    this.registered = this.host.registerHint(hintCellOf(hint));
  }

  /** «Ещё шаг»; на ступени 4 — «Понятно» (закрыть). Ветка ошибки и «ничего не нашёл» одноступенчатые. */
  next(): void {
    const { open, step, hint } = this.state;
    if (!open || !hint) return;
    if (hint.kind !== "step" || step >= HINT_STEPS) {
      this.close();
      return;
    }
    const to = (step + 1) as HintStep;
    this.commit({ ...this.state, step: to, marks: hintMarks(hint, to, this.play()?.notes ?? []) });
  }

  /** Закрыть док. На ступени ≥3 выбирает клетку шага (кольцо выбора переезжает туда); `select = false` — молча (смена экрана). */
  close(select = true): void {
    const { open, step, hint } = this.state;
    if (!open) return;
    const cell = select && hint?.kind === "step" && step >= 3 ? hintFocusCell(hint) : null;
    this.registered = false;
    this.commit({ ...this.state, open: false, step: 1, hint: null, marks: null });
    if (cell !== null) this.host.select(cell);
  }

  // ---- следим за партией ----------------------------------------------------------------------------

  private readonly onHost = (): void => {
    const play = this.play();
    const s = this.state;
    if (!s.open) {
      if (s.nudge && play && play.values !== this.lastValues) this.commit({ ...s, nudge: false });
      if (s.rule && !this.host.hintAllowed()) this.commit({ ...s, rule: false });
      this.lastValues = play?.values ?? null;
      return;
    }
    if (!play || !this.host.hintAllowed()) {
      this.close(false);
      return;
    }
    if (play.values !== this.lastValues) {
      // Игрок поставил/стёр цифру при открытом доке: та же сессия, новый шаг, ступень 1, счёт не растёт.
      this.recompute(play, 1);
    } else if (play.notes !== this.lastNotes) {
      // Заметки меняют только то, что ещё не вычеркнуто: ступень сохраняем, пока шаг тот же.
      this.recompute(play, null);
    }
  };

  private recompute(play: PlayState, forceStep: HintStep | null): void {
    this.lastValues = play.values;
    this.lastNotes = play.notes;
    const hint = computeHint(play);
    const old = this.state.hint;
    const same =
      old?.kind === "step" &&
      hint.kind === "step" &&
      old.technique === hint.technique &&
      old.explanation.id === hint.explanation.id &&
      old.region.unit === hint.region.unit;
    const step: HintStep = forceStep ?? (same ? this.state.step : 1);
    this.commit({ ...this.state, step, hint, marks: hintMarks(hint, step, play.notes) });
    this.registerIfResult(hint);
  }

  // ---- строка-намёк --------------------------------------------------------------------------------

  /** Проверить условия строки-намёка (хук вызывает раз в `NUDGE_CHECK_MS`). Возвращает, показана ли она. */
  checkNudge(): boolean {
    const s = this.state;
    const snap: PlaySnapshot = this.host.getSnapshot();
    const play = snap.play;
    if (s.nudge) return true;
    if (s.open || s.rule || !play || !this.host.hintAllowed() || (snap.hints ?? 0) > 0) return false;
    if (this.flags.get(NUDGE_KEY)) return false;
    if (cellsLeft(play) < NUDGE_MIN_EMPTY) return false;
    const lastPlace = [...play.log].reverse().find((m) => m.kind === "place");
    if (this.host.getElapsedMs() - (lastPlace?.t ?? 0) < NUDGE_AFTER_MS) return false;
    // Шаг существует: считаем по текущим цифрам один раз (кэш по массиву значений).
    if (!this.nudgeFor || this.nudgeFor.values !== play.values) this.nudgeFor = { values: play.values, hint: computeHint(play) };
    if (this.nudgeFor.hint.kind !== "step") return false;
    this.flags.set(NUDGE_KEY);
    this.lastValues = play.values;
    this.commit({ ...s, nudge: true });
    return true;
  }
}

/** Лесенка экрана: создаётся на хранилище, подписывается на него, пока экран жив; строка-намёк проверяется по таймеру. */
export function useHintLadder(host: HintHost, opts: HintLadderOptions = {}, active = true): { ladder: HintLadder; state: HintLadderState } {
  // `opts` живёт столько же, сколько хранилище: пересоздавать лесенку на каждый рендер нельзя.
  const ladder = useMemo(() => new HintLadder(host, opts), [host]);
  useEffect(() => {
    // PD-161: скрытая вкладка (смонтирована, но не на экране) лесенку не держит — как раньше размонтированная.
    if (!active) return;
    const off = ladder.attach();
    const id = window.setInterval(() => ladder.checkNudge(), NUDGE_CHECK_MS);
    return () => {
      window.clearInterval(id);
      ladder.close(false); // экран ушёл (смена вкладки): подсветки не остаются висеть
      off();
    };
  }, [ladder, active]);
  const state = useSyncExternalStore(ladder.subscribe, ladder.getState);
  return { ladder, state };
}
