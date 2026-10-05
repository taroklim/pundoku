/**
 * Звуковое ядро режима Мелодия (PD-201, план режимов §4). Без UI: экран, кнопки и настройка звука — PD-203 (`melody/game.ts`,
 * `melody/MelodyTune.tsx`).
 *
 * - Только синтез Web Audio (осциллятор + огибающая + фильтр), никаких файлов: работает офлайн и ничего не весит.
 * - Цифра 1–9 → мажорная пентатоника по возрастанию (до–ре–ми–соль–ля), две октавы от C4: C4 D4 E4 G4 A4 C5 D5 E5 G5.
 *   Любое сочетание этих нот консонансно, поэтому арпеджио юнита и мелодия пути не «фальшивят».
 * - Тембр — пресет ({@link TIMBRES}): «маримба» («Дерево», по умолчанию — выбор владельца по PD-202), «мягкий синус», «колокольчик».
 * - Громкость тихая (мастер {@link DEFAULT_VOLUME}); огибающая начинается и кончается в нуле — без щелчков.
 *
 * Разблокировка (iOS PWA, `reports/sudoku-pwa-research/03-tech.md`): `AudioContext` создаётся и резюмируется ТОЛЬКО в
 * {@link MelodyAudio.unlock}, который вызывается из обработчика жеста (или автоматически слушателем {@link MelodyAudio.attachUnlock}).
 * До первого жеста `playNote`/`playUnit` молчат и возвращают `false`. Перед созданием контекста ставится
 * `navigator.audioSession.type = 'ambient'` (iOS 17+): звук уважает беззвучный режим и не глушит чужую музыку.
 * Прерывание (звонок, засыпание PWA) переводит контекст в `interrupted`/`suspended` — ядро молчит без ошибок и тихо
 * восстанавливается на следующем жесте; закрытый системой контекст пересоздаётся.
 */

/** Полутоны мажорной пентатоники от тоники для цифр 1..9 (индекс 0 — цифра 1). */
export const PENTATONIC_SEMITONES: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19];
/** Тоника — C4. */
export const BASE_HZ = 261.6255653005986;
/** Мастер-громкость по умолчанию (0..1): тихо, чтобы звук не спорил с размышлением. */
export const DEFAULT_VOLUME = 0.18;
/** Шаг арпеджио юнита, мс (макет PD-202 §2 п. 8: 9 нот ≈ 1 с; тот же шаг у кольца на поле). */
export const UNIT_STEP_MS = 110;
/** В мелодии пути арпеджио юнита начинается через столько мс после ноты, которая его закрыла. */
export const UNIT_DELAY_MS = 140;

/** Частота ноты цифры 1..9, Гц. Иное — `RangeError`. */
export function noteFrequency(digit: number, baseHz: number = BASE_HZ): number {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) throw new RangeError(`digit must be 1..9, got ${String(digit)}`);
  return baseHz * 2 ** (PENTATONIC_SEMITONES[digit - 1]! / 12);
}

/** Обертон тембра: кратность частоты и относительная громкость. */
export interface TimbrePartial {
  readonly ratio: number;
  readonly gain: number;
  /** Свой тип волны (по умолчанию — `wave` тембра). */
  readonly wave?: OscillatorType;
  /** Затухание этого обертона быстрее основного: множитель к `release` (≤ 1). По умолчанию 1. */
  readonly releaseScale?: number;
}

/** Параметры тембра (всё, что меняется между пресетами). Времена — в секундах. */
export interface Timbre {
  readonly id: TimbreId;
  readonly wave: OscillatorType;
  /** Атака до пика. Не короче 5 мс — иначе щелчок. */
  readonly attack: number;
  /** Экспоненциальное затухание от пика до тишины. */
  readonly release: number;
  /** Пик огибающей одной ноты (до мастер-громкости), 0..1. */
  readonly peak: number;
  /** Обертоны поверх основного тона (основной — ratio 1, gain 1 — всегда есть). */
  readonly partials: readonly TimbrePartial[];
  /** Низкочастотный фильтр, Гц (смягчает верх); нет — без фильтра. */
  readonly lowpassHz?: number;
}

export type TimbreId = "soft" | "bell" | "marimba";

/** Пресеты тембра. Дизайнер (PD-202) предложит, владелец выберет; меняются только числа здесь. */
export const TIMBRES: Readonly<Record<TimbreId, Timbre>> = {
  /** Мягкий синус: чистый тон, медленная атака, ровный хвост. */
  soft: { id: "soft", wave: "sine", attack: 0.025, release: 0.9, peak: 0.5, partials: [{ ratio: 2, gain: 0.08 }], lowpassHz: 2400 },
  /** Колокольчик: синус с негармоничным обертоном (≈2.76, как у колокола), быстрая атака, длинный звон. */
  bell: {
    id: "bell",
    wave: "sine",
    attack: 0.006,
    release: 1.6,
    peak: 0.4,
    partials: [
      { ratio: 2.76, gain: 0.28, releaseScale: 0.5 },
      { ratio: 5.4, gain: 0.08, releaseScale: 0.25 },
    ],
  },
  /** Маримба: треугольник с обертоном ×4 (деревянный брусок), короткое сухое затухание. */
  marimba: {
    id: "marimba",
    wave: "triangle",
    attack: 0.005,
    release: 0.45,
    peak: 0.55,
    partials: [{ ratio: 4, gain: 0.18, wave: "sine", releaseScale: 0.3 }],
    lowpassHz: 3200,
  },
};

/** PD-202/PD-203: владелец выбрал «Дерево» (маримба). */
export const DEFAULT_TIMBRE: TimbreId = "marimba";

/** Акцент ноты (мелодия пути, нота, закрывшая юнит — вместо арпеджио, макет PD-202 §2 п. 9): громче и длиннее. */
export const ACCENT_GAIN = 1.3;
export const ACCENT_RELEASE = 1.4;
export const accentOf = (tb: Timbre): Timbre => ({ ...tb, peak: Math.min(1, tb.peak * ACCENT_GAIN), release: tb.release * ACCENT_RELEASE });

/** Событие мелодии пути — совместимо с `MelodyEvent` движка (`melodyOf`). */
export interface PathEvent {
  readonly t: number;
  readonly kind: "note" | "unit";
  readonly digit: number;
  /** Цифры юнита в порядке арпеджио (у `unit`). */
  readonly digits?: readonly number[];
  /** Нота с акцентом (у `note`): громче и длиннее — так мелодия пути отмечает закрытый юнит вместо арпеджио (PD-202 §2 п. 9). */
  readonly accent?: boolean;
}

export interface PlayPathOptions<E extends PathEvent> {
  /** Вызывается на каждом событии в момент его звучания (синхронизация с таймлапсом). Звук может быть выключен — шаг всё равно идёт. */
  readonly onStep?: (event: E, index: number) => void;
  /**
   * Начать с этого момента шкалы, мс (продолжение с позиции таймлапса): события раньше пропускаются, остальные звучат через
   * `t − fromMs`. По умолчанию 0 — время событий как есть (первая нота через `t` первого события, ровно как кадр таймлапса).
   */
  readonly fromMs?: number;
  /** Мелодия доиграла до конца (не вызывается при `stop`). */
  readonly onEnd?: () => void;
}

export interface PathPlayback {
  /** Остановить: оставшиеся шаги не наступят, звучащие ноты пути быстро гаснут. Повторный вызов — no-op. */
  stop(): void;
  /** Завершение: `ended` — доиграла, `stopped` — остановлена (`stop`, новый `playPath`, `dispose`). */
  readonly done: Promise<"ended" | "stopped">;
}

/** Что ядро берёт у окружения — подменяется в тестах и на dev-стенде. */
export interface MelodyAudioEnv {
  /** Создать контекст. По умолчанию `new AudioContext()` (или `webkitAudioContext`); нет Web Audio — `null`. */
  readonly createContext?: () => AudioContext | null;
  /** `navigator` для `audioSession` (iOS 17+). По умолчанию глобальный. */
  readonly navigator?: { audioSession?: { type: string } } | undefined;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export interface MelodyAudioOptions extends MelodyAudioEnv {
  readonly timbre?: TimbreId;
  /** Мастер-громкость 0..1. */
  readonly volume?: number;
  readonly muted?: boolean;
}

export type MelodyAudioState = "locked" | "running" | "suspended" | "unsupported" | "disposed";

export interface MelodyAudio {
  /**
   * Разблокировать звук — ВЫЗЫВАТЬ ИЗ ОБРАБОТЧИКА ЖЕСТА. Создаёт контекст (если нет или закрыт) и резюмирует его. Ошибки
   * глотаются: без звука игра продолжается. Возвращает `true`, если контекст есть (резюме могло ещё не завершиться).
   */
  unlock(): boolean;
  /** Повесить `unlock` на жесты `target` (pointerup/touchend/click/keydown, capture). Возвращает снятие; снимается и в `dispose`. */
  attachUnlock(target?: EventTarget): () => void;
  /** Нота цифры 1..9. `false` — не прозвучала (до жеста, mute, прерывание, нет Web Audio, цифра вне 1..9). */
  playNote(digit: number): boolean;
  /** Короткое арпеджио: цифры по порядку с шагом {@link UNIT_STEP_MS}, начиная через `delayMs`. `false` — как у `playNote`. */
  playUnit(digits: readonly number[], delayMs?: number): boolean;
  /** Мелодия пути по событиям `melodyOf` (время `t`, мс). Новый вызов останавливает предыдущий. */
  playPath<E extends PathEvent>(events: readonly E[], opts?: PlayPathOptions<E>): PathPlayback;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setTimbre(id: TimbreId): void;
  getTimbre(): TimbreId;
  state(): MelodyAudioState;
  /** Остановить всё, снять слушатели, закрыть контекст. После — ядро немо навсегда. */
  dispose(): void;
}

type AudioCtor = new () => AudioContext;

function defaultCreateContext(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

const GESTURES = ["pointerup", "touchend", "click", "keydown"] as const;
/** Минимум огибающей для экспоненциального спада (0 недопустим). */
const SILENT = 0.0001;

/**
 * Одна нота цифры `digit` в момент `at` (секунды контекста) в узел `out`: основной тон + обертоны тембра → огибающая (0 →
 * пик за `attack` → экспоненциально к тишине за `release` → 0) → фильтр. Узлы отключаются сами по окончании. Работает и с
 * `OfflineAudioContext` (dev-стенд рендерит ноты офлайн и меряет сигнал).
 */
export function scheduleNote(c: BaseAudioContext, out: AudioNode, digit: number, at: number, tb: Timbre = TIMBRES[DEFAULT_TIMBRE]): void {
  const f = noteFrequency(digit);
  const env = c.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(tb.peak, at + tb.attack);
  env.gain.exponentialRampToValueAtTime(SILENT, at + tb.attack + tb.release);
  env.gain.setValueAtTime(0, at + tb.attack + tb.release);
  let dest: AudioNode = out;
  if (tb.lowpassHz !== undefined) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = tb.lowpassHz;
    lp.connect(out);
    dest = lp;
  }
  env.connect(dest);
  const end = at + tb.attack + tb.release + 0.05;
  const parts: TimbrePartial[] = [{ ratio: 1, gain: 1 }, ...tb.partials];
  parts.forEach((p, i) => {
    const osc = c.createOscillator();
    osc.type = p.wave ?? tb.wave;
    osc.frequency.value = f * p.ratio;
    let node: AudioNode = osc;
    if (p.gain !== 1 || (p.releaseScale ?? 1) !== 1) {
      const g = c.createGain();
      g.gain.setValueAtTime(p.gain, at);
      g.gain.exponentialRampToValueAtTime(Math.max(SILENT, p.gain * SILENT), at + tb.attack + tb.release * (p.releaseScale ?? 1));
      osc.connect(g);
      node = g;
    }
    node.connect(env);
    osc.start(at);
    osc.stop(end);
    // Узлы отпускаем по окончании — без утечек на длинной партии. Все осцилляторы ноты кончаются в `end`; основной
    // (первый) заодно отпускает огибающую и фильтр.
    osc.onended = () => {
      try {
        node.disconnect();
        if (node !== osc) osc.disconnect();
        if (i === 0) {
          env.disconnect();
          if (dest !== out) dest.disconnect();
        }
      } catch {
        /* уже отключён */
      }
    };
  });
}

/** Создать звуковое ядро. Ничего не создаёт в Web Audio до первого `unlock`. */
export function createMelodyAudio(opts: MelodyAudioOptions = {}): MelodyAudio {
  const createContext = opts.createContext ?? defaultCreateContext;
  const nav = "navigator" in opts ? opts.navigator : (globalThis.navigator as unknown as MelodyAudioEnv["navigator"]);
  const setT = opts.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  const volume = Math.min(1, Math.max(0, opts.volume ?? DEFAULT_VOLUME));

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let unsupported = false;
  let disposed = false;
  let muted = opts.muted === true;
  let timbre: Timbre = TIMBRES[opts.timbre ?? DEFAULT_TIMBRE] ?? TIMBRES[DEFAULT_TIMBRE];
  /** `resume()` вызван в жесте и ещё не завершился: ноты можно ставить в очередь контекста — зазвучат по резюме. */
  let resumePending = false;
  const detachers = new Set<() => void>();
  let path: { stop: () => void } | null = null;

  const setAmbient = () => {
    try {
      if (nav?.audioSession) nav.audioSession.type = "ambient";
    } catch {
      /* старый iOS/не Safari — нет audioSession */
    }
  };

  function ensureContext(): AudioContext | null {
    if (ctx !== null && ctx.state !== "closed") return ctx;
    ctx = null;
    master = null;
    setAmbient();
    let c: AudioContext | null;
    try {
      c = createContext();
    } catch {
      c = null;
    }
    if (c === null) {
      unsupported = true;
      return null;
    }
    unsupported = false;
    const m = c.createGain();
    m.gain.value = muted ? 0 : volume;
    m.connect(c.destination);
    ctx = c;
    master = m;
    // Прерывание (звонок/сон PWA): новые ноты молчат (`audible()`), восстановление — на следующем жесте через `unlock`.
    c.onstatechange = () => {
      if (c.state === "running") resumePending = false;
    };
    return c;
  }

  function unlock(): boolean {
    if (disposed) return false;
    const c = ensureContext();
    if (c === null) return false;
    if (c.state !== "running") {
      resumePending = true;
      try {
        void Promise.resolve(c.resume())
          .catch(() => undefined)
          .finally(() => {
            resumePending = false;
          });
      } catch {
        resumePending = false;
      }
      primeSilence(c);
    }
    return true;
  }

  /** Короткий беззвучный буфер в жесте — старые iOS разблокируют вывод только так. */
  function primeSilence(c: AudioContext) {
    try {
      const b = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(c.destination);
      src.start(0);
    } catch {
      /* не критично */
    }
  }

  /** Можно ли звучать прямо сейчас. */
  function audible(): AudioContext | null {
    if (disposed || muted || ctx === null || master === null) return null;
    if (ctx.state === "running" || resumePending) return ctx;
    return null; // suspended/interrupted/closed — молчим, ждём жеста
  }

  const isDigit = (d: unknown): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 9;

  function noteInto(out: AudioNode | null, digit: number, delaySec = 0, accent = false): boolean {
    if (!isDigit(digit)) return false;
    const c = audible();
    if (c === null || master === null) return false;
    scheduleNote(c, out ?? master, digit, c.currentTime + 0.005 + delaySec, accent ? accentOf(timbre) : timbre);
    return true;
  }

  function unitInto(out: AudioNode | null, digits: readonly number[], delaySec = 0): boolean {
    const ds = digits.filter(isDigit);
    if (ds.length === 0) return false;
    const c = audible();
    if (c === null || master === null) return false;
    const t0 = c.currentTime + 0.005 + delaySec;
    ds.forEach((d, i) => scheduleNote(c, out ?? master!, d, t0 + (i * UNIT_STEP_MS) / 1000, timbre));
    return true;
  }

  function playPath<E extends PathEvent>(events: readonly E[], po: PlayPathOptions<E> = {}): PathPlayback {
    path?.stop();
    let resolve!: (r: "ended" | "stopped") => void;
    const done = new Promise<"ended" | "stopped">((r) => (resolve = r));
    if (disposed) {
      resolve("stopped");
      return { stop: () => undefined, done };
    }
    // Своя шина пути: `stop` гасит только звучащие ноты пути, не ноты партии.
    let bus: GainNode | null = null;
    const busFor = (): GainNode | null => {
      if (bus !== null) return bus;
      const c = audible();
      if (c === null || master === null) return null;
      bus = c.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      return bus;
    };
    const timers: unknown[] = [];
    let finished = false;
    const finish = (r: "ended" | "stopped") => {
      if (finished) return;
      finished = true;
      timers.forEach((h) => clearT(h));
      if (path === handle) path = null;
      if (r === "stopped" && bus !== null && ctx !== null) {
        const b = bus;
        const now = ctx.currentTime;
        try {
          b.gain.cancelScheduledValues(now);
          b.gain.setValueAtTime(b.gain.value, now);
          b.gain.linearRampToValueAtTime(0, now + 0.04); // быстро, но без щелчка
        } catch {
          /* контекст закрыт */
        }
        setT(() => {
          try {
            b.disconnect();
          } catch {
            /* уже */
          }
        }, 120);
      }
      resolve(r);
    };
    const handle = { stop: () => finish("stopped") };
    path = handle;
    const from = Math.max(0, po.fromMs ?? 0);
    const sorted = events.map((e, i) => ({ e, i })).filter(({ e }) => e.t >= from);
    sorted.forEach(({ e, i }) => {
      const at = Math.max(0, e.t - from);
      timers.push(
        setT(() => {
          if (finished) return;
          if (e.kind === "unit") unitInto(busFor(), e.digits ?? [], UNIT_DELAY_MS / 1000);
          else noteInto(busFor(), e.digit, 0, e.accent === true);
          try {
            po.onStep?.(e, i);
          } catch {
            /* колбэк UI не роняет проигрывание */
          }
        }, at),
      );
    });
    const last = sorted.reduce((m, { e }) => Math.max(m, e.t - from), 0);
    timers.push(
      setT(() => {
        if (finished) return;
        finish("ended");
        try {
          po.onEnd?.();
        } catch {
          /* колбэк UI */
        }
      }, last + 1),
    );
    return { stop: handle.stop, done };
  }

  function setMuted(m: boolean) {
    muted = m;
    if (master !== null && ctx !== null) {
      const now = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(m ? 0 : volume, now + 0.03);
      } catch {
        master.gain.value = m ? 0 : volume;
      }
    }
  }

  function attachUnlock(target: EventTarget | undefined = globalThis.document): () => void {
    if (target === undefined || disposed) return () => undefined;
    const onGesture = () => {
      unlock();
    };
    for (const type of GESTURES) target.addEventListener(type, onGesture, { capture: true, passive: true });
    const detach = () => {
      for (const type of GESTURES) target.removeEventListener(type, onGesture, { capture: true });
      detachers.delete(detach);
    };
    detachers.add(detach);
    return detach;
  }

  return {
    unlock,
    attachUnlock,
    playNote: (digit) => noteInto(null, digit),
    playUnit: (digits, delayMs = 0) => unitInto(null, digits, Math.max(0, delayMs) / 1000),
    playPath,
    setMuted,
    isMuted: () => muted,
    setTimbre: (id) => {
      timbre = TIMBRES[id] ?? timbre;
    },
    getTimbre: () => timbre.id,
    state: () => {
      if (disposed) return "disposed";
      if (unsupported) return "unsupported";
      if (ctx === null) return "locked";
      return ctx.state === "running" ? "running" : "suspended";
    },
    dispose: () => {
      if (disposed) return;
      path?.stop();
      [...detachers].forEach((d) => d());
      disposed = true;
      const c = ctx;
      ctx = null;
      master = null;
      if (c !== null) {
        c.onstatechange = null;
        try {
          void Promise.resolve(c.close()).catch(() => undefined);
        } catch {
          /* уже закрыт */
        }
      }
    },
  };
}
