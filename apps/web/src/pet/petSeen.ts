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
 * Лист дня: играть ли «проснуться» для этой даты. Решается один раз на показ (компонент листа дня ключуется датой): прежде
 * показанное настроение «спит», а сейчас день закончен. Показанное настроение запоминается — повторное открытие только покой.
 */
export function useWakeOnce(date: string, mood: PetMood): boolean {
  const [wake] = useState(() => mood !== "asleep" && seenMood(date) === "asleep");
  useEffect(() => {
    rememberMood(date, mood);
  }, [date, mood]);
  return wake;
}
