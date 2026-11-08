/**
 * Какие сложности Play можно выбрать (PD-305). Набор режима — `ModeDef.difficulties`; настройка «Без X-Wing» (`settings/prefs.ts`,
 * по умолчанию вкл) убирает из него классы, которым нужна рыба или что-то сильнее. Классы до `expert` включительно рыб не требуют
 * по построению движка (PD-304: expert — «строго ниже X-Wing»), поэтому фильтр по классу и есть «только сетки без X-Wing».
 *
 * Решение по UI: такие классы СКРЫТЫ (а не показаны выключенными) — под списком одна строка, почему их нет и где включить.
 * Выключенная строка в радиогруппе не нажимается и не фокусируется (roving tabindex), но занимает высоту шита на 320×568/AX3
 * и выглядит как поломка; одна пояснительная строка честнее и короче.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES } from "@pundoku/engine";

/** Классы, которым нужен X-Wing/Swordfish (`expert_plus`) или что-то сильнее рыб (`master`). */
export const X_WING_DIFFICULTIES: readonly Difficulty[] = ["expert_plus", "master"];

/** Сложность Play по умолчанию (решение владельца 2026-11-08): новый пользователь и режим без сохранённого выбора — Эксперт. */
export const PLAY_DEFAULT_DIFFICULTY: Difficulty = "expert";

/** Набор режима с учётом «Без X-Wing» (порядок — как в `options`). */
export function playableDifficulties(options: readonly Difficulty[], noXWing: boolean): readonly Difficulty[] {
  return noXWing ? options.filter((d) => !X_WING_DIFFICULTIES.includes(d)) : options;
}

/** Скрыты ли настройкой классы из этого набора (тогда под списком — пояснение). */
export function hiddenByNoXWing(options: readonly Difficulty[], noXWing: boolean): boolean {
  return noXWing && options.some((d) => X_WING_DIFFICULTIES.includes(d));
}

/**
 * Сложность из допустимых: `want`, если он есть; иначе ближайший допустимый НИЖЕ (сохранённый `master` при «Без X-Wing» → `expert`,
 * а не `easy`); если ниже ничего нет — первый допустимый. Пустой набор — `want` (вызывающий решает сам).
 */
export function clampDifficulty(want: Difficulty, allowed: readonly Difficulty[]): Difficulty {
  if (allowed.includes(want)) return want;
  const rank = DIFFICULTIES.indexOf(want);
  let best: Difficulty | null = null;
  for (const d of allowed) if (DIFFICULTIES.indexOf(d) < rank && (best === null || DIFFICULTIES.indexOf(d) > DIFFICULTIES.indexOf(best))) best = d;
  return best ?? allowed[0] ?? want;
}
