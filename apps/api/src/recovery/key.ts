import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Ключ восстановления: 20 случайных байт (160 бит, CSPRNG) → Crockford base32 (32 символа, без I/L/O/U),
 * показ группами по 4 через дефис: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (8×4). 160 бит = ровно 32 символа
 * по 5 бит, без смещения. В БД — только HMAC-SHA256 с серверным секретом (утечка одной БД не даёт ключей).
 */
export const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const KEY_CHARS = 32;
/** Потолок длины ввода до любой работы: защита от мегабайтных «ключей», не проверка формата. */
export const KEY_INPUT_MAX = 128;

/** base32 без padding: 20 байт → 32 символа. */
function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += KEY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += KEY_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function formatKey(raw: string): string {
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

/** Новый ключ в человеческом виде (с дефисами). Показывать клиенту один раз, нигде не логировать. */
export function generateRecoveryKey(): string {
  return formatKey(encodeBase32(randomBytes(20)));
}

/**
 * Ввод человека → каноническая форма: регистр, пробелы/дефисы игнорируются, путаница Crockford прощается
 * (`I`/`L` → `1`, `O` → `0`). Формат намеренно НЕ проверяем: любая строка идёт в HMAC и поиск, чтобы
 * неверный формат и неверный ключ не различались ни ответом, ни временем. Нестрока/слишком длинное → `null`.
 */
export function normalizeRecoveryKey(input: unknown): string | null {
  if (typeof input !== "string" || input.length > KEY_INPUT_MAX) return null;
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/** HMAC-SHA256(секрет, нормализованный ключ) — единственная форма ключа на сервере. */
export function hmacRecoveryKey(secret: Buffer, normalized: string): Buffer {
  return createHmac("sha256", secret).update(normalized, "utf8").digest();
}

export function hmacEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Первые 6 hex HMAC — единственное, что можно писать в логи для расследований без раскрытия ключа. */
export function keyHmacPrefix(hmac: Buffer): string {
  return hmac.toString("hex").slice(0, 6);
}
