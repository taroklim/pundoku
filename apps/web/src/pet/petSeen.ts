/**
 * «Проснуться» в листе дня Year (PD-260, макет PD-223 md §1/§6.2): чтобы переход «спит → настроение» сыграл ровно один раз,
 * помним последнее ПОКАЗАННОЕ настроение каждой даты. Это память экрана этого устройства, а не прогресс: localStorage (как
 * `pundoku.pet`), схема снапшота синхронизации не меняется. Нет хранилища (приватный режим) — память до перезагрузки.
 */
import type { PetMood } from "@pundoku/engine";
import { useEffect, useState } from "react";

export const PET_SEEN_KEY = "pundoku.petSeen";
/** Сколько дат помнить: больше года — лишнее (Year показывает год), старые вытесняются по дате. */
export const PET_SEEN_MAX = 400;

const MOODS: readonly string[] = ["happy", "tired", "surprised", "asleep"];
let memory: Record<string, PetMood> = {};

function readAll(): Record<string, PetMood> {
  try {
    const raw = localStorage.getItem(PET_SEEN_KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: Record<string, PetMood> = {};
    for (const [k, m] of Object.entries(v as Record<string, unknown>)) if (typeof m === "string" && MOODS.includes(m)) out[k] = m as PetMood;
    return out;
  } catch {
    return { ...memory };
  }
}

export function seenMood(date: string): PetMood | null {
  return readAll()[date] ?? null;
}

export function rememberMood(date: string, mood: PetMood): void {
  const all = readAll();
  if (all[date] === mood) return;
  all[date] = mood;
  const keys = Object.keys(all).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - PET_SEEN_MAX))) delete all[k];
  memory = all;
  try {
    localStorage.setItem(PET_SEEN_KEY, JSON.stringify(all));
  } catch {
    /* память до перезагрузки */
  }
}

/**
 * Лист дня: играть ли «проснуться» для этой даты. Возвращает 0 — не играть, иначе номер «проснуться» (ключ для ремаунта кляксы,
 * чтобы действие сыграло на текущем показе). «Проснуться» — когда клякса на экране (`live`), её прежде ПОКАЗАННОЕ настроение —
 * «спит», а сейчас день закончен:
 * - при показе листа (день закончили, пока лист был закрыт);
 * - у уже открытого листа, когда данные обновились под ним (PD-287: возврат из архива — лист открывается на прежних данных
 *   Year до перечитывания хранилища; снапшот с другого устройства при открытом листе);
 * - когда клякса снова на экране, если день закончили, пока её не было видно (вкладка/приложение скрыты).
 * Показанное настроение запоминается только на экране: скрытая клякса ничего не «видела», и «проснуться» её ждёт.
 * Повторный показ после «проснуться» — только покой; смена настроения закрытого дня — без «проснуться».
 */
export function useWakeOnce(date: string, mood: PetMood, live = true): number {
  const [s, setS] = useState(() => ({ mood, live, wake: wakesNow(date, mood, live), id: 1 }));
  let cur = s;
  // Производное состояние от предыдущего рендера (как `useLiveRun` в PetBlot): решение — в том же рендере, где пришли данные.
  if (s.mood !== mood || s.live !== live) {
    const w = wakesNow(date, mood, live);
    cur = { mood, live, wake: w || (s.wake && s.mood === mood), id: w ? s.id + 1 : s.id };
    setS(cur);
  }
  useEffect(() => {
    if (live) rememberMood(date, mood);
  }, [date, mood, live]);
  return cur.wake ? cur.id : 0;
}

function wakesNow(date: string, mood: PetMood, live: boolean): boolean {
  return live && mood !== "asleep" && seenMood(date) === "asleep";
}
