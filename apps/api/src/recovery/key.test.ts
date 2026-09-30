import { describe, expect, it } from "vitest";
import { KEY_ALPHABET, KEY_INPUT_MAX, generateRecoveryKey, hmacEqual, hmacRecoveryKey, keyHmacPrefix, normalizeRecoveryKey } from "./key.js";

const secret = Buffer.from("s".repeat(32));

describe("recovery key", () => {
  it("формат: 8 групп по 4 символа Crockford base32, 160 бит, ключи различаются", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const key = generateRecoveryKey();
      expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
      for (const ch of key.replace(/-/g, "")) expect(KEY_ALPHABET).toContain(ch);
      keys.add(key);
    }
    expect(keys.size).toBe(200);
  });

  it("нормализация: регистр, пробелы, дефисы, I/L→1, O→0; нестрока и гигант → null; неверный формат не отвергается", () => {
    expect(normalizeRecoveryKey(" ab-cd ef\tgh ")).toBe("ABCDEFGH");
    expect(normalizeRecoveryKey("oil")).toBe("011");
    expect(normalizeRecoveryKey("")).toBe("");
    expect(normalizeRecoveryKey(5)).toBeNull();
    expect(normalizeRecoveryKey(undefined)).toBeNull();
    expect(normalizeRecoveryKey("a".repeat(KEY_INPUT_MAX + 1))).toBeNull();
    expect(normalizeRecoveryKey("a".repeat(KEY_INPUT_MAX))).not.toBeNull();
    const key = generateRecoveryKey();
    expect(normalizeRecoveryKey(key.toLowerCase())).toBe(normalizeRecoveryKey(key));
  });

  it("HMAC: детерминирован, зависит от секрета и ключа, 32 байта; hmacEqual сравнивает по значению и длине", () => {
    const a = hmacRecoveryKey(secret, "ABC");
    expect(a).toHaveLength(32);
    expect(hmacRecoveryKey(secret, "ABC").equals(a)).toBe(true);
    expect(hmacRecoveryKey(secret, "ABD").equals(a)).toBe(false);
    expect(hmacRecoveryKey(Buffer.from("t".repeat(32)), "ABC").equals(a)).toBe(false);
    expect(hmacEqual(a, Buffer.from(a))).toBe(true);
    expect(hmacEqual(a, hmacRecoveryKey(secret, "ABD"))).toBe(false);
    expect(hmacEqual(a, a.subarray(0, 31))).toBe(false);
    expect(keyHmacPrefix(a)).toBe(a.toString("hex").slice(0, 6));
  });
});
