/**
 * Ключ восстановления на клиенте (PD-27): только разбор и показ. Ключ создаёт сервер (`POST /api/recovery/key`);
 * здесь он нигде не сохраняется — ни в IndexedDB/localStorage, ни в логах, ни в адресе.
 *
 * Формат: 32 символа Crockford base32 (без I, L, O, U), показ группами по 4 через дефис.
 */
export const KEY_CHARS = 32;
export const KEY_GROUP = 4;
export const KEY_GROUPS = KEY_CHARS / KEY_GROUP;

/**
 * Живая нормализация ввода (решение макета PD-48): регистр не важен; всё, что не буква/цифра (пробелы, дефисы,
 * переводы строк при вставке), выбрасывается; путаница Crockford прощается — `I`/`L` → `1`, `O` → `0`, `U` → `V`;
 * не больше 32 символов; группы по 4 через дефис. Результат — то, что видно в поле.
 */
export function normalizeKeyInput(raw: string): string {
  const compact = raw
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V")
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, KEY_CHARS);
  return compact.replace(new RegExp(`(.{${KEY_GROUP}})(?=.)`, "g"), "$1-");
}

/** Ключ без дефисов — то, что уходит на сервер. */
export const compactKey = (formatted: string): string => formatted.replace(/-/g, "");

/** Введено все 32 символа. */
export const isCompleteKey = (formatted: string): boolean => compactKey(formatted).length === KEY_CHARS;

/** Ключ (с дефисами или без) → 8 групп для плашек. Меньше 32 символов — пустой список. */
export function keyGroups(key: string): string[] {
  const compact = compactKey(key.replace(/\s/g, ""));
  if (compact.length !== KEY_CHARS) return [];
  return compact.match(new RegExp(`.{${KEY_GROUP}}`, "g")) ?? [];
}

/** «K7QP» → «K 7 Q P»: так VoiceOver читает группу по знакам, а не словом. */
export const spellGroup = (group: string): string => group.split("").join(" ");
