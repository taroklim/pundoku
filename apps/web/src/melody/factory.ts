/**
 * Единственное место, где приложение создаёт звуковое ядро Мелодии (PD-203): партия (`game.ts`), карточка (`MelodyTune`) и
 * таймлапс (`TimelapseSheet`). Тесты подменяют фабрику моком Web Audio и так проверяют, что вне Мелодии ядро не создаётся.
 */
import type { MelodyAudio, MelodyAudioOptions } from "./audio";
import { createMelodyAudio } from "./audio";

type Factory = (opts?: MelodyAudioOptions) => MelodyAudio;
let factory: Factory = (opts) => createMelodyAudio(opts);

export function makeMelodyAudio(opts?: MelodyAudioOptions): MelodyAudio {
  return factory(opts);
}

/** Только для тестов: подменить создание ядра. Возвращает восстановление. */
export function setMelodyAudioFactory(f: Factory): () => void {
  const prev = factory;
  factory = f;
  return () => {
    factory = prev;
  };
}
