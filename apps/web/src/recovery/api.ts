/**
 * Клиент `/api/recovery/*` (PD-27, контракт — `docs/pd-27-recovery-key.md`). Все вызовы — под Bearer токеном
 * устройства. Как и остальные клиенты, никогда не бросает: любой отказ — значение результата, решение принимает
 * `RecoveryStore`. Ключ приходит только в теле ответа и уходит только в теле запроса; в адрес, заголовки, логи и
 * хранилище не попадает (тут нет ни одного вызова `console.*`), ответы не кэшируются.
 */
import type { Options } from "../today/api";
import { apiUrl, request } from "../today/api";

/** `pendingRotation` — неподтверждённая замена ключа (PD-126): старый ключ ещё работает, новый ждёт «Ключ сохранён». */
export type RecoveryStatus =
  | { hasKey: false }
  | { hasKey: true; devices: number; keyCreatedAt: string | null; pendingRotation: { expiresAt: string } | null };

/** Ответ начала замены: новый ключ (один раз), метка для подтверждения и срок жизни ожидающего ключа. */
export interface RotationStart {
  key: string;
  pendingId: string;
  expiresAt: string;
}

/**
 * Итог вызова. `unauthorized` — сервер не знает токен устройства (клиент перерегистрируется и повторит один раз);
 * `rate_limited` — 429 (`retryAfterSec` из `Retry-After`); `invalid_key` — единый ответ 400 на любую неудачу redeem;
 * `key_exists` / `no_key` — 409 / 404 создания и перевыпуска; `stale_rotation` — 409 подтверждения замены, которой уже нет
 * (отменена, затёрта новой, истекла, уже подтверждена); `network` — ответа нет; `error` — прочее.
 */
export type RecoveryResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "invalid_key" }
  | { kind: "key_exists" }
  | { kind: "no_key" }
  | { kind: "stale_rotation" }
  | { kind: "rate_limited"; retryAfterSec: number | null }
  | { kind: "unauthorized" }
  | { kind: "network" }
  | { kind: "error" };

export interface RecoveryApi {
  status(token: string): Promise<RecoveryResult<RecoveryStatus>>;
  create(token: string): Promise<RecoveryResult<{ key: string; devices: number }>>;
  /** Начать замену: старый ключ продолжает работать, пока не придёт `confirmRotation`. */
  rotate(token: string): Promise<RecoveryResult<RotationStart>>;
  /** «Ключ сохранён»: атомарно сделать ожидающий ключ рабочим. */
  confirmRotation(token: string, pendingId: string): Promise<RecoveryResult<true>>;
  /** Отменить ожидающую замену (рабочий ключ не трогается). */
  cancelRotation(token: string): Promise<RecoveryResult<true>>;
  /** `key` — 32 знака без дефисов (нормализованный ввод). */
  redeem(token: string, key: string): Promise<RecoveryResult<{ devices: number }>>;
  unlink(token: string): Promise<RecoveryResult<true>>;
  remove(token: string): Promise<RecoveryResult<true>>;
}

const TIMEOUT_MS = 15_000;

const retryAfterSec = (res: Response): number | null => {
  const raw = res.headers.get("retry-after");
  const sec = raw === null ? NaN : Number(raw);
  return Number.isFinite(sec) && sec >= 0 ? Math.min(sec, 3600) : null;
};

async function errorCode(res: Response): Promise<string | null> {
  try {
    const b = (await res.json()) as { error?: { code?: unknown } };
    return typeof b.error?.code === "string" ? b.error.code : null;
  } catch {
    return null;
  }
}

async function json(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await res.json();
    return typeof b === "object" && b !== null ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function httpRecoveryApi(o: Options = {}): RecoveryApi {
  const opts: Options = { timeoutMs: TIMEOUT_MS, ...o };
  const headers = (token: string, body = false): Record<string, string> => ({
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...(body ? { "content-type": "application/json" } : {}),
  });

  /** Общая часть: коды, одинаковые для всех вызовов. `ok` — на усмотрение вызывающего. */
  async function call<T>(
    path: string,
    init: RequestInit,
    onOk: (res: Response) => Promise<T | null>,
  ): Promise<RecoveryResult<T>> {
    const res = await request(apiUrl(path, o.base), { cache: "no-store", ...init }, opts);
    if (res === null) return { kind: "network" };
    if (res.ok) {
      const value = await onOk(res);
      return value === null ? { kind: "error" } : { kind: "ok", value };
    }
    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 429) return { kind: "rate_limited", retryAfterSec: retryAfterSec(res) };
    const code = await errorCode(res);
    if (res.status === 400 && code === "invalid_key") return { kind: "invalid_key" };
    if (res.status === 409 && code === "key_exists") return { kind: "key_exists" };
    if (res.status === 404 && code === "no_key") return { kind: "no_key" };
    if (res.status === 409 && (code === "no_pending" || code === "pending_replaced" || code === "pending_expired")) return { kind: "stale_rotation" };
    return { kind: "error" };
  }

  return {
    status: (token) =>
      call("/api/recovery", { headers: headers(token) }, async (res) => {
        const b = await json(res);
        if (!b) return null;
        if (b["hasKey"] === false) return { hasKey: false } satisfies RecoveryStatus;
        if (b["hasKey"] !== true || typeof b["devices"] !== "number") return null;
        const p = b["pendingRotation"];
        const expiresAt = typeof p === "object" && p !== null ? (p as Record<string, unknown>)["expiresAt"] : null;
        return {
          hasKey: true,
          devices: b["devices"],
          keyCreatedAt: typeof b["keyCreatedAt"] === "string" ? b["keyCreatedAt"] : null,
          pendingRotation: typeof expiresAt === "string" ? { expiresAt } : null,
        } satisfies RecoveryStatus;
      }),

    create: (token) =>
      call("/api/recovery/key", { method: "POST", headers: headers(token) }, async (res) => {
        const b = await json(res);
        return b && typeof b["key"] === "string" && typeof b["devices"] === "number" ? { key: b["key"], devices: b["devices"] } : null;
      }),

    rotate: (token) =>
      call("/api/recovery/key/rotate", { method: "POST", headers: headers(token) }, async (res) => {
        const b = await json(res);
        return b && typeof b["key"] === "string" && typeof b["pendingId"] === "string" && typeof b["expiresAt"] === "string"
          ? { key: b["key"], pendingId: b["pendingId"], expiresAt: b["expiresAt"] }
          : null;
      }),

    confirmRotation: (token, pendingId) =>
      call("/api/recovery/key/rotate/confirm", { method: "POST", headers: headers(token, true), body: JSON.stringify({ pendingId }) }, async (res) => {
        const b = await json(res);
        return b && b["confirmed"] === true ? (true as const) : null;
      }),

    cancelRotation: (token) => call("/api/recovery/key/rotate", { method: "DELETE", headers: headers(token) }, async () => true as const),

    redeem: (token, key) =>
      call("/api/recovery/redeem", { method: "POST", headers: headers(token, true), body: JSON.stringify({ key }) }, async (res) => {
        const b = await json(res);
        return b && b["linked"] === true ? { devices: typeof b["devices"] === "number" ? b["devices"] : 0 } : null;
      }),

    unlink: (token) => call("/api/recovery/link", { method: "DELETE", headers: headers(token) }, async () => true as const),

    remove: (token) => call("/api/recovery", { method: "DELETE", headers: headers(token) }, async () => true as const),
  };
}
