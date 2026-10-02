/**
 * Первый запуск (PD-25): локальная дата первого запуска приложения хранится в `meta` хранилища прогресса
 * (`meta:firstUseDate`). С PD-51 она НЕ задаёт начало года в Year (им стал самый ранний решённый день,
 * `year/model.ts › yearStart`; PD-54), а задаёт границу архива: играть прошлые дни можно с этой даты
 * (`archiveStart`: меньшее из неё и самой ранней записи).
 *
 * Пишется один раз (`setMetaIfAbsent`) при старте приложения из `main.tsx`. Не синхронизируется:
 * после чистки IndexedDB дата становится «сегодня», а граница архива берёт меньшее из неё и самой ранней
 * восстановленной записи.
 */
import type { SyncStorage } from "../today/repository";
import { sanitizeDays } from "../today/repository";
import { localDate } from "../today/dayResolver";
import type { YearEntry } from "./model";
import { archiveStart, entryFromProgress } from "./model";

export const META_FIRST_USE = "firstUseDate";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Записать дату первого запуска, если её ещё нет; вернуть итоговую. Ошибки хранилища не мешают старту. */
export async function recordFirstUse(storage: Pick<SyncStorage, "setMetaIfAbsent">, now: Date = new Date()): Promise<string | null> {
  try {
    const value = await storage.setMetaIfAbsent(META_FIRST_USE, localDate(now));
    return typeof value === "string" && DATE_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function readFirstUse(storage: Pick<SyncStorage, "getMeta">): Promise<string | null> {
  try {
    const value = await storage.getMeta(META_FIRST_USE);
    return typeof value === "string" && DATE_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Граница архива (`archiveStart`: меньшее из первого запуска и самой ранней записи дня с ходами; нет ничего — сегодня).
 * Архив играет только дни не раньше этой даты; Year предлагает «сыграть» на тех же днях (раскраска Year от неё не зависит).
 * `null` — хранилище не читается (тогда границу не применяем: судить не по чему).
 */
export async function readUseStart(storage: Pick<SyncStorage, "getMeta" | "listDays">, today: string): Promise<string | null> {
  try {
    const [firstUse, days] = await Promise.all([readFirstUse(storage), storage.listDays()]);
    const entries = new Map<string, YearEntry>();
    for (const p of sanitizeDays(days, "readUseStart")) {
      const e = entryFromProgress(p);
      if (e) entries.set(p.date, e);
    }
    return archiveStart(firstUse, entries, today);
  } catch {
    return null;
  }
}
