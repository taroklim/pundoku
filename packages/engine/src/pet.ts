/**
 * Питомец-клякса (PD-180, план режимов релиза 2 §2): настроение по итогу дня. Чистая функция без хранения —
 * настроение не пишется ни в запись дня, ни в снапшот, оно каждый раз выводится из записи.
 *
 * Вход — плоская сводка дня (`PetDay`), а не web-типы записей (`DayRecord`/`DayProgress`/`LiarDayRecord`): движок не знает
 * о схеме снапшота, сводку собирает web (`apps/web/src/pet/petDay.ts`). Так правило живёт в одном месте и
 * покрыто таблицей тестов без DOM.
 *
 * Правило (порядок проверок важен):
 * 1. не играл или не закончил → `asleep`;
 * 2. особый день → `surprised`: Лжец пойман с первого обвинения; чистое решение в Ink (ни одной кляксы/правки);
 *    личный рекорд времени для класса (сложности), взятый без подсказок;
 * 3. правки (`corrections ≥ PET_TIRED_CORRECTIONS`), кляксы или подсказки → `tired`;
 * 4. иначе (решено чисто) → `happy`.
 */

export type PetMood = "happy" | "tired" | "surprised" | "asleep";

/** Порядок — как в макете PD-170 (превью в Настройках). */
export const PET_MOODS: readonly PetMood[] = ["happy", "tired", "surprised", "asleep"];

/**
 * С какого числа правок клякса «устала». 1 = любая правка: совпадает с «Clean» на карточке (`summary.clean`), чтобы
 * питомец не спорил со строкой «Corrections» рядом. Константа — чтобы порог можно было ослабить одной правкой.
 */
export const PET_TIRED_CORRECTIONS = 1;

export interface PetDay {
  /** Партия решена. `false` — начата, но не решена. Нет партии вовсе — передавайте `null` в `petMood`. */
  readonly solved: boolean;
  /** Правки (`summary.corrections`); в Ink каждая клякса уже входит сюда. */
  readonly corrections: number;
  /** Кляксы Чернильного режима (только Ink). */
  readonly blots?: number;
  /** Результативные подсказки (или 1, если день лишь помечен «с помощью» без счётчика). */
  readonly hints?: number;
  /** Партия в Чернильном режиме. */
  readonly ink?: boolean;
  /** Лжец пойман первым же обвинением. */
  readonly liarFirstTry?: boolean;
  /** Время партии — личный рекорд для своей сложности (см. `isPersonalBest`). */
  readonly personalBest?: boolean;
}

export function petMood(day: PetDay | null | undefined): PetMood {
  if (!day || !day.solved) return "asleep";
  const corrections = Math.max(0, day.corrections);
  const blots = Math.max(0, day.blots ?? 0);
  const hints = Math.max(0, day.hints ?? 0);
  const inkClean = day.ink === true && corrections === 0 && blots === 0 && hints === 0;
  const record = day.personalBest === true && hints === 0;
  if (day.liarFirstTry === true || inkClean || record) return "surprised";
  if (corrections >= PET_TIRED_CORRECTIONS || blots > 0 || hints > 0) return "tired";
  return "happy";
}

/**
 * Личный рекорд: время строго меньше каждого из прежних решений того же класса. Первое решение класса рекордом
 * не считается (иначе каждая новая сложность «удивляла» бы сразу) — нужен хотя бы один прежний результат.
 * Нечисловые/отрицательные времена игнорируются.
 */
export function isPersonalBest(timeMs: number, previousTimesMs: readonly number[]): boolean {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return false;
  const prev = previousTimesMs.filter((t) => Number.isFinite(t) && t > 0);
  if (prev.length === 0) return false;
  return prev.every((t) => timeMs < t);
}
