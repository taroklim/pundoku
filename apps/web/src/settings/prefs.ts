import { useSyncExternalStore } from "react";

/**
 * Локальные UI-предпочтения устройства (PD-112): как язык (`pundoku.locale`) — localStorage, не IndexedDB и не снапшот
 * синхронизации. Это настройка этого телефона, а не прогресс: схема снапшота не меняется, старый клиент ничего не
 * затрёт. Подписка — `useSyncExternalStore`, поэтому переключатель в Settings действует на открытом Play/Today сразу.
 */

/** Подсвечивать неверные цифры в обычной (не чернильной) партии. Включено только значением «1». */
export const HIGHLIGHT_WRONG_KEY = "pundoku.highlightWrong";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
/** Запасное хранилище, если localStorage недоступен (приватный режим): выбор живёт до перезагрузки. */
let memory = false;

/**
 * По умолчанию ВЫКЛЮЧЕНО у всех, включая пользователей, игравших до PD-112: ключа нет — значит выкл, миграции
 * «сохранить прежнее поведение» нет (решение владельца 2026-10-02).
 */
export function getHighlightWrong(): boolean {
  try {
    return localStorage.getItem(HIGHLIGHT_WRONG_KEY) === "1";
  } catch {
    return memory;
  }
}

export function setHighlightWrong(on: boolean): void {
  memory = on;
  try {
    if (on) localStorage.setItem(HIGHLIGHT_WRONG_KEY, "1");
    else localStorage.removeItem(HIGHLIGHT_WRONG_KEY);
  } catch {
    /* выбор живёт до перезагрузки */
  }
  notify();
}

/**
 * Настройки, ВКЛЮЧЁННЫЕ по умолчанию (PD-119, PD-124): ключа нет — значит вкл; выкл хранится значением «0». Так у всех, включая
 * игравших раньше, новое поведение работает без действий, а возврат к умолчанию — просто удаление ключа.
 */
export const AUTO_CLEAR_NOTES_KEY = "pundoku.autoClearNotes";
export const HIGHLIGHT_PEERS_KEY = "pundoku.highlightPeers";

function defaultOnPref(key: string) {
  let memory = true;
  return {
    get(): boolean {
      try {
        return localStorage.getItem(key) !== "0";
      } catch {
        return memory;
      }
    },
    set(on: boolean): void {
      memory = on;
      try {
        if (on) localStorage.removeItem(key);
        else localStorage.setItem(key, "0");
      } catch {
        /* выбор живёт до перезагрузки */
      }
      notify();
    },
  };
}

const autoClearPref = defaultOnPref(AUTO_CLEAR_NOTES_KEY);
const peersPref = defaultOnPref(HIGHLIGHT_PEERS_KEY);

/** PD-119: убирать поставленную цифру из заметок строки/столбца/блока. По умолчанию ВКЛ. В чернилах не действует никогда. */
export const getAutoClearNotes = autoClearPref.get;
export const setAutoClearNotes = autoClearPref.set;
/** PD-124: очень слабая заливка строки/столбца/блока выбранной клетки. По умолчанию ВКЛ. */
export const getHighlightPeers = peersPref.get;
export const setHighlightPeers = peersPref.set;

/**
 * PD-180: Питомец-клякса на карточке результата и в листе дня Year. PD-297 (решение владельца 2026-10-10): по умолчанию ВКЛ —
 * как остальные «включённые по умолчанию» настройки: выкл хранится «0», ключа нет — вкл. Прежний формат (до PD-297 вкл = «1»,
 * выкл = ключа нет) читается без миграции: «1» — тоже вкл. Явного «выкл» старый формат не хранил (выкл = удалённый ключ), поэтому
 * отличить «не трогал» от «включил и выключил» нельзя — оба получают вкл. Локальная настройка устройства — в снапшот не идёт.
 */
export const PET_KEY = "pundoku.pet";
const petPref = defaultOnPref(PET_KEY);
export const getPetEnabled = petPref.get;
export const setPetEnabled = petPref.set;

/**
 * PD-203: звук в партиях Мелодии (пункт «Звук» в меню ⋯, макет PD-202 вариант C). По умолчанию ВКЛ: выкл хранится «0».
 * Настройка этого устройства, как остальные: в снапшот не идёт. На карточку и таймлапс не действует (там звук запускается явно).
 */
export const MELODY_SOUND_KEY = "pundoku.melodySound";
const melodySoundPref = defaultOnPref(MELODY_SOUND_KEY);
export const getMelodySound = melodySoundPref.get;
export const setMelodySound = melodySoundPref.set;

const WATCHED_KEYS: readonly string[] = [HIGHLIGHT_WRONG_KEY, AUTO_CLEAR_NOTES_KEY, HIGHLIGHT_PEERS_KEY, PET_KEY, MELODY_SOUND_KEY];

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Другая вкладка/окно PWA изменила настройку (или очистила хранилище: key === null).
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || WATCHED_KEYS.includes(e.key)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHighlightWrong(): boolean {
  return useSyncExternalStore(subscribe, getHighlightWrong, () => false);
}

export function useAutoClearNotes(): boolean {
  return useSyncExternalStore(subscribe, getAutoClearNotes, () => true);
}

export function useHighlightPeers(): boolean {
  return useSyncExternalStore(subscribe, getHighlightPeers, () => true);
}

export function usePetEnabled(): boolean {
  return useSyncExternalStore(subscribe, getPetEnabled, () => true);
}

export function useMelodySound(): boolean {
  return useSyncExternalStore(subscribe, getMelodySound, () => true);
}
