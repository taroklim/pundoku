/**
 * PD-201: звуковое ядро Мелодии на моке Web Audio — разблокировка только по жесту, тишина до жеста, `audioSession = ambient`,
 * mute, прерывание/закрытие контекста, остановка посреди `playPath`, маппинг цифр в пентатонику, огибающая без щелчков.
 */
import { melodyOf } from "@pundoku/engine";
import type { Digit, Move } from "@pundoku/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMelodyAudio, DEFAULT_TIMBRE, noteFrequency, TIMBRES, UNIT_STEP_MS } from "./audio";

type Ev = [string, number, number?];

class FakeParam {
  value: number;
  events: Ev[] = [];
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["lin", v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError("exp ramp to 0");
    this.events.push(["exp", v, t]);
  }
  cancelScheduledValues(t: number) {
    this.events.push(["cancel", t]);
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect(n: FakeNode) {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeOsc extends FakeNode {
  type = "sine";
  frequency = new FakeParam(440);
  startAt: number | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  start(t: number) {
    this.startAt = t;
  }
  stop(t: number) {
    this.stopAt = t;
  }
}

class FakeCtx {
  state: string = "suspended";
  currentTime = 1;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  gains: FakeGain[] = [];
  oscs: FakeOsc[] = [];
  resumeCalls = 0;
  closed = false;
  resumeFails = false;
  resume() {
    this.resumeCalls++;
    if (this.resumeFails) return Promise.reject(new Error("NotAllowedError"));
    this.state = "running";
    this.onstatechange?.();
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(350) });
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return Object.assign(new FakeNode(), { buffer: null as unknown, start: () => undefined });
  }
}

function setup(extra: Parameters<typeof createMelodyAudio>[0] = {}) {
  const ctxs: FakeCtx[] = [];
  const nav = { audioSession: { type: "auto" } };
  const createContext = vi.fn(() => {
    const c = new FakeCtx();
    ctxs.push(c);
    return c as unknown as AudioContext;
  });
  const audio = createMelodyAudio({ createContext, navigator: nav, ...extra });
  const ctx = () => ctxs[ctxs.length - 1]!;
  const master = () => ctx().gains[0]!;
  /** Основные осцилляторы нот: у каждой ноты первым создаётся основной тон, за ним обертоны тембра. */
  const fundamentals = () => {
    const per = 1 + TIMBRES[audio.getTimbre()].partials.length;
    return ctx().oscs.filter((_, i) => i % per === 0);
  };
  return { audio, ctxs, ctx, nav, createContext, master, fundamentals };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("маппинг цифр в пентатонику", () => {
  it("1–9 → C4 D4 E4 G4 A4 C5 D5 E5 G5, строго по возрастанию, две октавы", () => {
    const f = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => noteFrequency(d));
    expect(f.map((x) => Math.round(x * 100) / 100)).toEqual([261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.26, 783.99]);
    for (let i = 1; i < 9; i++) expect(f[i]!).toBeGreaterThan(f[i - 1]!);
    expect(f[8]! / f[0]!).toBeLessThan(4); // в пределах двух октав
    expect(noteFrequency(6) / noteFrequency(1)).toBeCloseTo(2, 10); // цифра 6 — тоника октавой выше
  });

  it("цифра вне 1..9 — RangeError; playNote с такой цифрой молчит", () => {
    for (const bad of [0, 10, 1.5, NaN]) expect(() => noteFrequency(bad)).toThrow(RangeError);
    const { audio } = setup();
    audio.unlock();
    expect(audio.playNote(0)).toBe(false);
    expect(audio.playNote(10)).toBe(false);
  });
});

describe("разблокировка только по жесту", () => {
  it("до unlock: контекст не создан, ноты не звучат, состояние locked", () => {
    const { audio, createContext } = setup();
    expect(audio.state()).toBe("locked");
    expect(audio.playNote(5)).toBe(false);
    expect(audio.playUnit([1, 2, 3])).toBe(false);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("unlock: audioSession = ambient ДО создания контекста, resume, затем ноты звучат", async () => {
    const { audio, createContext, ctxs, ctx, nav, fundamentals } = setup();
    let typeAtCreate = "";
    createContext.mockImplementationOnce(() => {
      typeAtCreate = nav.audioSession.type;
      const c = new FakeCtx();
      ctxs.push(c);
      return c as unknown as AudioContext;
    });
    expect(audio.unlock()).toBe(true);
    expect(typeAtCreate).toBe("ambient");
    await Promise.resolve();
    expect(ctx().resumeCalls).toBe(1);
    expect(audio.state()).toBe("running");
    expect(audio.playNote(3)).toBe(true);
    expect(fundamentals().map((o) => o.frequency.value)).toEqual([noteFrequency(3)]);
  });

  it("нота в том же жесте, пока resume ещё не завершился, ставится в очередь контекста (не теряется)", () => {
    const { audio, createContext, ctxs } = setup();
    createContext.mockImplementationOnce(() => {
      const c = Object.assign(new FakeCtx(), { resume: () => new Promise<void>(() => undefined) });
      ctxs.push(c);
      return c as unknown as AudioContext;
    });
    audio.unlock();
    expect(ctxs[0]!.state).toBe("suspended");
    expect(audio.playNote(1)).toBe(true);
  });

  it("attachUnlock: жест на цели создаёт контекст; после снятия — нет", () => {
    const { audio, createContext } = setup();
    const target = new EventTarget();
    const detach = audio.attachUnlock(target);
    detach();
    target.dispatchEvent(new Event("pointerup"));
    expect(createContext).not.toHaveBeenCalled();
    audio.attachUnlock(target);
    target.dispatchEvent(new Event("touchend"));
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("нет Web Audio: unsupported, без исключений", () => {
    const audio = createMelodyAudio({ createContext: () => null, navigator: undefined });
    expect(audio.unlock()).toBe(false);
    expect(audio.state()).toBe("unsupported");
    expect(audio.playNote(1)).toBe(false);
    const thrower = createMelodyAudio({
      createContext: () => {
        throw new Error("boom");
      },
      navigator: undefined,
    });
    expect(thrower.unlock()).toBe(false);
  });

  it("resume отклонён (жест не засчитан) — без ошибок и необработанных отказов; ноты молчат", async () => {
    const { audio, createContext } = setup();
    createContext.mockImplementationOnce(() => Object.assign(new FakeCtx(), { resumeFails: true }) as unknown as AudioContext);
    audio.unlock();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(audio.state()).toBe("suspended");
    expect(audio.playNote(2)).toBe(false);
  });
});

describe("прерывание (звонок, сон PWA)", () => {
  it("interrupted/suspended — тишина без ошибок; следующий жест резюмирует тот же контекст", async () => {
    const { audio, ctx, createContext } = setup();
    audio.unlock();
    await Promise.resolve();
    ctx().state = "interrupted";
    ctx().onstatechange?.();
    expect(() => audio.playNote(4)).not.toThrow();
    expect(audio.playNote(4)).toBe(false);
    expect(audio.state()).toBe("suspended");
    audio.unlock();
    await Promise.resolve();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx().resumeCalls).toBe(2);
    expect(audio.playNote(4)).toBe(true);
  });

  it("контекст закрыт системой — следующий жест создаёт новый", async () => {
    const { audio, ctxs } = setup();
    audio.unlock();
    await Promise.resolve();
    ctxs[0]!.state = "closed";
    expect(audio.playNote(1)).toBe(false);
    audio.unlock();
    await Promise.resolve();
    expect(ctxs).toHaveLength(2);
    expect(audio.playNote(1)).toBe(true);
  });
});

describe("mute", () => {
  it("mute: ноты не звучат, мастер плавно уходит в 0; unmute — снова звучат", async () => {
    const { audio, master } = setup();
    audio.unlock();
    await Promise.resolve();
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.playNote(1)).toBe(false);
    expect(audio.playUnit([1, 2])).toBe(false);
    expect(master().gain.events.at(-1)).toEqual(["lin", 0, expect.any(Number)]);
    audio.setMuted(false);
    expect(audio.playNote(1)).toBe(true);
  });

  it("muted с самого начала: мастер создаётся с нулём", async () => {
    const { audio, master } = setup({ muted: true });
    audio.unlock();
    await Promise.resolve();
    expect(master().gain.value).toBe(0);
    expect(audio.playNote(9)).toBe(false);
  });
});

describe("огибающая и тембры", () => {
  it("каждая нота начинается и кончается в нуле (без щелчков), атака ≥ 5 мс, осциллятор останавливается после хвоста", async () => {
    for (const id of Object.keys(TIMBRES) as (keyof typeof TIMBRES)[]) {
      const { audio, ctx } = setup({ timbre: id });
      audio.unlock();
      await Promise.resolve();
      audio.playNote(5);
      const env = ctx().gains[1]!; // [0] — мастер, [1] — огибающая ноты
      expect(env.gain.events[0]).toEqual(["set", 0, expect.any(Number)]);
      expect(env.gain.events[1]![0]).toBe("lin");
      expect(env.gain.events.at(-1)![1]).toBe(0);
      const tb = TIMBRES[id];
      expect(tb.attack).toBeGreaterThanOrEqual(0.005);
      expect(tb.peak).toBeLessThanOrEqual(1);
      for (const o of ctx().oscs) expect(o.stopAt!).toBeGreaterThan(o.startAt! + tb.attack + tb.release);
    }
  });

  it("пресеты: три, по умолчанию «мягкий синус»; setTimbre меняет", () => {
    expect(Object.keys(TIMBRES).sort()).toEqual(["bell", "marimba", "soft"]);
    expect(DEFAULT_TIMBRE).toBe("soft");
    const { audio } = setup();
    expect(audio.getTimbre()).toBe("soft");
    audio.setTimbre("bell");
    expect(audio.getTimbre()).toBe("bell");
    audio.setTimbre("nope" as never);
    expect(audio.getTimbre()).toBe("bell");
  });

  it("громкость тихая по умолчанию", async () => {
    const { audio, master } = setup();
    audio.unlock();
    await Promise.resolve();
    expect(master().gain.value).toBeGreaterThan(0);
    expect(master().gain.value).toBeLessThanOrEqual(0.25);
  });
});

describe("playUnit", () => {
  it("арпеджио: ноты по порядку с шагом UNIT_STEP_MS", async () => {
    const { audio, fundamentals } = setup();
    audio.unlock();
    await Promise.resolve();
    expect(audio.playUnit([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(true);
    const f = fundamentals();
    expect(f.map((o) => o.frequency.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => noteFrequency(d)));
    for (let i = 1; i < 9; i++) expect(f[i]!.startAt! - f[i - 1]!.startAt!).toBeCloseTo(UNIT_STEP_MS / 1000, 6);
  });
});

describe("playPath", () => {
  const SOLVED = "123456789" + "456789123" + "789123456" + "214365897" + "365897214" + "897214365" + "531642978" + "642978531" + "978531642";
  const MISSION = "000" + SOLVED.slice(3);
  const place = (t: number, cell: number, digit: Digit): Move => ({ t, cell, kind: "place", digit });
  const melody = () => melodyOf([place(1000, 0, 1), place(2000, 1, 2), place(2500, 2, 3)], { mission: MISSION, solution: SOLVED })!;

  it("шаги по времени событий (как кадры таймлапса), onStep и onEnd, done = ended", async () => {
    const { audio, fundamentals } = setup();
    audio.unlock();
    await Promise.resolve();
    const m = melody();
    const steps: [number, string][] = [];
    const onEnd = vi.fn();
    const pb = audio.playPath(m, { onStep: (e, i) => steps.push([i, e.kind]), onEnd });
    vi.advanceTimersByTime(999);
    expect(steps).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([
      [0, "note"],
      [1, "unit"],
    ]);
    vi.advanceTimersByTime(2000);
    expect(steps.map(([i]) => i)).toEqual(m.map((_, i) => i));
    expect(onEnd).toHaveBeenCalledTimes(1);
    await expect(pb.done).resolves.toBe("ended");
    expect(fundamentals().length).toBeGreaterThan(3); // ноты + арпеджио
  });

  it("stop посреди пути: оставшиеся шаги не наступают, звучащее гаснет, done = stopped, onEnd не вызван", async () => {
    const { audio, ctx } = setup();
    audio.unlock();
    await Promise.resolve();
    const steps: number[] = [];
    const onEnd = vi.fn();
    const pb = audio.playPath(melody(), { onStep: (_, i) => steps.push(i), onEnd });
    vi.advanceTimersByTime(1500);
    const before = steps.length;
    expect(before).toBeGreaterThan(0);
    pb.stop();
    pb.stop(); // повторно — no-op
    vi.advanceTimersByTime(10_000);
    expect(steps).toHaveLength(before);
    expect(onEnd).not.toHaveBeenCalled();
    await expect(pb.done).resolves.toBe("stopped");
    const bus = ctx().gains[1]!; // шина пути создаётся первой после мастера
    expect(bus.gain.events.at(-1)).toEqual(["lin", 0, expect.any(Number)]);
  });

  it("новый playPath останавливает предыдущий; fromMs пропускает ранние события", async () => {
    const { audio } = setup();
    audio.unlock();
    await Promise.resolve();
    const a = audio.playPath(melody());
    const steps: number[] = [];
    const b = audio.playPath(melody(), { fromMs: 2000, onStep: (_, i) => steps.push(i) });
    await expect(a.done).resolves.toBe("stopped");
    vi.advanceTimersByTime(0);
    expect(steps[0]).toBe(2); // первое событие с t ≥ 2000 — нота клетки 1
    vi.advanceTimersByTime(1000);
    await expect(b.done).resolves.toBe("ended");
  });

  it("до жеста или в mute: шаги идут (синхронизация с таймлапсом), звука нет", async () => {
    const { audio, createContext } = setup();
    const steps: number[] = [];
    audio.playPath(melody(), { onStep: (_, i) => steps.push(i) });
    vi.advanceTimersByTime(5000);
    expect(steps.length).toBe(melody().length);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("ошибка в onStep не роняет проигрывание", async () => {
    const { audio } = setup();
    let n = 0;
    const pb = audio.playPath(melody(), {
      onStep: () => {
        n++;
        throw new Error("ui");
      },
    });
    vi.advanceTimersByTime(5000);
    expect(n).toBe(melody().length);
    await expect(pb.done).resolves.toBe("ended");
  });
});

describe("dispose", () => {
  it("закрывает контекст, снимает слушатели, останавливает путь; дальше — тишина", async () => {
    const { audio, ctx, createContext } = setup();
    const target = new EventTarget();
    audio.attachUnlock(target);
    target.dispatchEvent(new Event("click"));
    await Promise.resolve();
    const pb = audio.playPath([{ t: 100, kind: "note", digit: 1 }]);
    audio.dispose();
    audio.dispose();
    await expect(pb.done).resolves.toBe("stopped");
    expect(ctx().closed).toBe(true);
    expect(audio.state()).toBe("disposed");
    expect(audio.playNote(1)).toBe(false);
    expect(audio.unlock()).toBe(false);
    target.dispatchEvent(new Event("click"));
    expect(createContext).toHaveBeenCalledTimes(1);
    await expect(audio.playPath([]).done).resolves.toBe("stopped");
  });
});
