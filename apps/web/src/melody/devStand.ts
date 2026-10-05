/**
 * PD-201: dev-стенд звукового ядра (страница `apps/web/dev/melody.html`, только `vite` dev-сервер). Приложение этот модуль
 * не импортирует — в продакшн-бандл он не попадает. Ручная проверка — кнопками; автоматическая — `window.__melody`
 * (`design/pd201-audio-check.mjs`): состояние ядра, счётчики созданных узлов Web Audio, шаги пути, офлайн-рендер нот
 * с замером сигнала (есть звук, нет клиппинга, начало и конец в нуле — без щелчков).
 */
import { dailyPuzzle, melodyOf } from "@pundoku/engine";
import type { Digit, MelodyEvent, Move } from "@pundoku/engine";
import type { PathPlayback, TimbreId } from "./audio";
import { createMelodyAudio, DEFAULT_VOLUME, scheduleNote, TIMBRES } from "./audio";

const counts = { contexts: 0, oscillators: 0, gains: 0, filters: 0 };
const nav = navigator as unknown as { audioSession?: { type: string } };

const audio = createMelodyAudio({
  createContext: () => {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const c = new Ctor();
    counts.contexts++;
    const osc = c.createOscillator.bind(c);
    const gain = c.createGain.bind(c);
    const filt = c.createBiquadFilter.bind(c);
    c.createOscillator = () => (counts.oscillators++, osc());
    c.createGain = () => (counts.gains++, gain());
    c.createBiquadFilter = () => (counts.filters++, filt());
    return c;
  },
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $("log");
const log = (msg: string) => {
  logEl.textContent = `${new Date().toISOString().slice(11, 23)} ${msg}\n${logEl.textContent ?? ""}`.slice(0, 4000);
};
const refresh = () => {
  $("state").textContent = audio.state();
  $("session").textContent = nav.audioSession?.type ?? "n/a";
};

const P = dailyPuzzle("2026-10-05", "easy");
const EMPTY = [...P.mission].flatMap((c, i) => (c === "0" ? [i] : []));
const LOG: Move[] = EMPTY.map((cell, i) => ({ t: 400 + i * 300, cell, kind: "place", digit: Number(P.solution[cell]) as Digit, correct: true }));
/** Мелодия пути решённой дневной easy: ~8 с, паузы сжаты как в таймлапсе. */
const MELODY: MelodyEvent[] = melodyOf(LOG, P, { durationMs: 8000 }) ?? [];

const steps: { i: number; kind: string; at: number }[] = [];
let playback: PathPlayback | null = null;
let pathResult: string | null = null;

function startPath(fromMs = 0): void {
  steps.length = 0;
  pathResult = null;
  const t0 = performance.now();
  playback = audio.playPath(MELODY, {
    fromMs,
    onStep: (e, i) => {
      steps.push({ i, kind: e.kind, at: Math.round(performance.now() - t0) });
      if (e.kind === "unit") log(`step ${i}: unit ${e.unit}${e.index} [${e.digits.join("")}]`);
    },
  });
  void playback.done.then((r) => {
    pathResult = r;
    log(`path ${r}`);
  });
}

/** Отрендерить ноты офлайн тем же синтезом и измерить сигнал. */
async function renderOffline(timbre: TimbreId, digits: readonly number[] = [1, 5, 9], gapSec = 0.3) {
  const tb = TIMBRES[timbre];
  const rate = 44100;
  const dur = 0.05 + gapSec * (digits.length - 1) + tb.attack + tb.release + 0.2;
  const ctx = new OfflineAudioContext(1, Math.ceil(rate * dur), rate);
  const master = ctx.createGain();
  master.gain.value = DEFAULT_VOLUME;
  master.connect(ctx.destination);
  digits.forEach((d, i) => scheduleNote(ctx, master, d, 0.05 + i * gapSec, tb));
  const buf = await ctx.startRendering();
  const x = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let maxStep = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!);
    if (a > peak) peak = a;
    sum += x[i]! * x[i]!;
    if (i > 0) maxStep = Math.max(maxStep, Math.abs(x[i]! - x[i - 1]!));
  }
  const firstNoteAt = Math.floor(0.05 * rate);
  return {
    timbre,
    peak,
    rms: Math.sqrt(sum / x.length),
    /** До первой ноты — тишина. */
    preRoll: Math.max(...Array.from(x.subarray(0, firstNoteAt - 1), Math.abs)),
    /** Последние 10 мс — тишина (хвост дозатух, без обрыва). */
    tail: Math.max(...Array.from(x.subarray(x.length - Math.floor(rate * 0.01)), Math.abs)),
    /** Самый большой скачок между соседними сэмплами — щелчок дал бы скачок порядка пика. */
    maxStep,
  };
}

const api = {
  state: () => audio.state(),
  session: () => nav.audioSession?.type ?? null,
  counts: () => ({ ...counts }),
  unlock: () => audio.unlock(),
  playNote: (d: number) => audio.playNote(d),
  playUnit: (ds: number[]) => audio.playUnit(ds),
  setMuted: (m: boolean) => audio.setMuted(m),
  setTimbre: (t: TimbreId) => audio.setTimbre(t),
  startPath,
  stopPath: () => playback?.stop(),
  steps: () => steps.map((s) => ({ ...s })),
  pathResult: () => pathResult,
  melodyLength: () => MELODY.length,
  melodyDuration: () => (MELODY.length > 0 ? MELODY[MELODY.length - 1]!.t : 0),
  renderOffline,
  dispose: () => audio.dispose(),
};
(window as unknown as { __melody: typeof api }).__melody = api;

// ---- ручные кнопки -------------------------------------------------------------------------------------------------------
audio.attachUnlock(document);
const digitsEl = $("digits");
for (let d = 1; d <= 9; d++) {
  const b = document.createElement("button");
  b.textContent = String(d);
  b.dataset.digit = String(d);
  b.addEventListener("click", () => {
    log(`note ${d}: ${audio.playNote(d) ? "played" : "silent"}`);
    refresh();
  });
  digitsEl.append(b);
}
const sel = $<HTMLSelectElement>("timbre");
for (const id of Object.keys(TIMBRES)) sel.append(new Option(id, id, id === audio.getTimbre(), id === audio.getTimbre()));
sel.addEventListener("change", () => audio.setTimbre(sel.value as TimbreId));
$("unlock").addEventListener("click", () => {
  log(`unlock: ${audio.unlock()}`);
  setTimeout(refresh, 50);
});
$<HTMLInputElement>("mute").addEventListener("change", (e) => audio.setMuted((e.target as HTMLInputElement).checked));
$("unit").addEventListener("click", () => log(`unit: ${audio.playUnit([1, 2, 3, 4, 5, 6, 7, 8, 9]) ? "played" : "silent"}`));
$("path").addEventListener("click", () => startPath());
$("stop").addEventListener("click", () => playback?.stop());
$("dispose").addEventListener("click", () => {
  audio.dispose();
  refresh();
});
document.addEventListener("visibilitychange", refresh);
refresh();
log(`ready: melody of ${MELODY.length} events, ${api.melodyDuration()} ms`);
