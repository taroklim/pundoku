/**
 * Начало пользования для Year (PD-25): локальная дата первого запуска приложения хранится в `meta`
 * хранилища прогресса (`meta:firstUseDate`). Раньше этой даты Year не рисует «пропуски»
 * («нельзя пропустить день, когда тебя ещё не было»).
 *
 * Пишется один раз (`setMetaIfAbsent`) при старте приложения из `main.tsx`. Не синхронизируется:
 * после чистки IndexedDB дата становится «сегодня», а Year берёт меньшее из неё и самой ранней
 * восстановленной записи (`year/model.ts › startDate`) — дни между настоящим первым запуском и
 * первой сыгранной партией в таком случае остаются пустыми, а не пропусками.
 */
import type { SyncStorage } from "../today/repository";
import { localDate } from "../today/dayResolver";

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
