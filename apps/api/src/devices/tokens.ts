import { createHash, randomBytes } from "node:crypto";

/** 32 случайных байта → base64url (43 символа без padding). Клиент хранит как есть. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** В БД — только sha256-хеш (hex, 64 символа). Сам токен сервер нигде не хранит и не логирует. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function looksLikeDeviceToken(token: string): boolean {
  return TOKEN_RE.test(token);
}
