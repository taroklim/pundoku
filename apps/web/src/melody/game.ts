/**
 * Звук партии режима Мелодия (PD-203, макет design/pd202-melody.html, вариант C — решения владельца 2026-10-05).
 *
 * - Звук живёт ТОЛЬКО в партии Мелодии: ядро (`createMelodyAudio`) создаётся, когда экран входит в такую партию, и
 *   уничтожается (контекст закрывается), когда партия уходит с экрана. В Классике и других режимах ядра нет вовсе, а
 *   значит нет и `AudioContext`.
 * - Отдельной кнопки «включить звук» нет: первая поставленная цифра и есть жест, её нота звучит тем же тапом. PD-206:
 *   `AudioContext` создаётся лениво — `unlock` зовётся только при ноте (синхронно в обработчике тапа/клавиши, что поставил
 *   цифру), а не на любом жесте документа (выбор клетки, меню); при выключенном звуке контекст не создаётся вовсе.
 * - Нота — на каждую постановку (`snap.melodyCue`, ставит `GameStore.input`); ошибочная цифра звучит как верная; undo,
 *   стирание и заметки молчат (они `melodyCue` не ставят). Юнит, заполненный постановкой, — арпеджио после ноты; если
 *   закрыто несколько — по очереди (шаги — {@link ringSchedule}, их же рисует кольцо на поле).
 * - Пункт «Звук» (настройка устройства `pundoku.melodySound`) — мастер-mute ядра; на кольцо не влияет.
 * - Сворачивание PWA / смена вкладки браузера (`visibilitychange` → hidden, `pagehide`) — ядро уничтожается сразу;
 *   вернулись — новое ядро ждёт следующего жеста. Конец партии — последняя нота с арпеджио доигрывает (≤ {@link TAIL_MS}),
 *   потом ядро закрывается; «Сыграть мелодию» на карточке глушит хвост сразу ({@link silenceGameAudio}).
 */
import type { CompletedUnit } from "@pundoku/engine";
import { useEffect, useRef } from "react";
import type { PlaySnapshot } from "../play/gameStore";
import type { MelodyAudio } from "./audio";
import { UNIT_STEP_MS } from "./audio";
import { makeMelodyAudio } from "./factory";

/** Пауза между нотой постановки и арпеджио закрытого юнита, мс (макет: 0,35 с). */
export const UNIT_LEAD_MS = 350;
/** Шаг между арпеджио нескольких юнитов, закрытых одним ходом, мс (макет: 1,15 с = 9 × 110 + вдох). */
export const UNIT_GAP_MS = 1150;
/** Кольцо на клетке: 560 мс (бег), при Reduce Motion — 1 с на весь юнит сразу. Классы живут не дольше этого хвоста. */
export const RING_MS = 560;
export const RING_RM_MS = 1000;
/** Сколько после решения партии ядро ещё живёт, чтобы последняя нота с арпеджио доиграла, мс. */
export const TAIL_MS = 4000;

/** Задержка старта арпеджио юнита `k` (по порядку `units`) от постановки, мс. */
export const unitDelayMs = (k: number): number => UNIT_LEAD_MS + k * UNIT_GAP_MS;

/** Кольцо на поле: для каждой клетки — задержки (по юнитам, где она есть) и её позиция в арпеджио. */
export interface RingMark {
  /** Задержка старта арпеджио юнита, мс. */
  readonly unitMs: number;
  /** Позиция клетки в арпеджио 0..8 (шаг {@link UNIT_STEP_MS}; при Reduce Motion шаг гасится CSS-множителем `--mo`). */
  readonly step: number;
}

/** Кольца по клеткам для закрытых юнитов (клетка на пересечении двух юнитов получает два кольца). */
export function ringSchedule(units: readonly CompletedUnit[]): Map<number, RingMark[]> {
  const out = new Map<number, RingMark[]>();
  units.forEach((u, k) => {
    u.cells.forEach((cell, step) => {
      const list = out.get(cell) ?? [];
      list.push({ unitMs: unitDelayMs(k), step });
      out.set(cell, list);
    });
  });
  return out;
}

/** Сколько живёт кольцо хода целиком (с запасом на Reduce Motion), мс. */
export function ringLifetimeMs(units: readonly CompletedUnit[]): number {
  if (units.length === 0) return 0;
  return unitDelayMs(units.length - 1) + Math.max(8 * UNIT_STEP_MS + RING_MS, RING_RM_MS) + 60;
}

/** Живые ядра партии (одно на экран; набор — на случай гонки размонтирования). */
const live = new Set<{ kill: () => void }>();

/** Заглушить звук партии сразу (хвост последней ноты): карточка запускает свою мелодию — один источник звука за раз. */
export function silenceGameAudio(): void {
  [...live].forEach((h) => h.kill());
}

type Store = { subscribe: (fn: () => void) => () => void; getSnapshot: () => PlaySnapshot };

/** Цифры клеток юнита по текущей сетке (подсказки + свои). */
const unitDigits = (snap: PlaySnapshot, u: CompletedUnit): number[] =>
  u.cells.map((c) => snap.play?.mission[c] || snap.play?.values[c] || 0);

/**
 * Подключить звук к партии Мелодии, пока `enabled` (партия Мелодии на экране, идёт игра). `muted` — пункт «Звук» выкл.
 * Ноты играются синхронно в подписке на хранилище — в том же обработчике жеста, что поставил цифру (iOS).
 */
export function useMelodyGame(store: Store, enabled: boolean, muted: boolean): void {
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const audioRef = useRef<MelodyAudio | null>(null);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (!enabled) return;
    let audio: MelodyAudio | null = null;
    let tail: ReturnType<typeof setTimeout> | null = null;
    const drop = () => {
      if (tail !== null) clearTimeout(tail);
      tail = null;
      audio?.dispose();
      audio = null;
      audioRef.current = null;
    };
    const handle = { kill: drop };
    live.add(handle);
    const ensure = (): MelodyAudio => {
      if (audio === null) {
        // Ядро без контекста: Web Audio появится в первом `unlock` (при ноте), не на любом жесте.
        audio = makeMelodyAudio({ muted: mutedRef.current });
        audioRef.current = audio;
      }
      return audio;
    };
    ensure();
    let lastId = store.getSnapshot().melodyCue?.id ?? 0;
    const unsub = store.subscribe(() => {
      const snap = store.getSnapshot();
      const cue = snap.melodyCue;
      if (!cue || cue.id === lastId) return;
      lastId = cue.id;
      if (document.visibilityState === "hidden") return;
      if (mutedRef.current) return; // «Звук» выкл: контекст не создаём и не будим
      const a = ensure();
      a.unlock(); // мы в обработчике жеста, поставившего цифру: контекст создаётся/резюмируется здесь, нота — тем же тапом
      a.playNote(cue.digit);
      cue.units.forEach((u, k) => a.playUnit(unitDigits(snap, u), unitDelayMs(k)));
    });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") drop();
      else ensure();
    };
    const onPageHide = () => drop();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // Партия решена — даём последней ноте с арпеджио доиграть (но без новых жестов-разблокировок), иначе — сразу тишина.
      const solved = store.getSnapshot().phase === "solved" && document.visibilityState !== "hidden";
      if (solved && audio !== null) {
        const a = audio;
        audioRef.current = null;
        const kill = () => {
          if (tail !== null) clearTimeout(tail);
          tail = null;
          document.removeEventListener("visibilitychange", kill);
          window.removeEventListener("pagehide", kill);
          a.dispose();
          audio = null;
          live.delete(handle);
        };
        tail = setTimeout(kill, TAIL_MS);
        // Хвост тоже обрывается сворачиванием/уходом со страницы.
        document.addEventListener("visibilitychange", kill);
        window.addEventListener("pagehide", kill);
        handle.kill = kill;
        return;
      }
      drop();
      live.delete(handle);
    };
  }, [enabled, store]);
}
