/**
 * Клиент `POST /api/devices` и `GET/PUT /api/snapshot` (PD-14). Как и `today/api.ts`, никогда не бросает:
 * любой отказ — значение результата, а решение (ретрай/слияние/стоп) принимает `SyncManager`.
 */
import type { Options } from "../today/api";
import { apiUrl, request } from "../today/api";

export interface RemoteSnapshot {
  version: number;
  updatedAt: string;
  data: unknown;
}

export type RegisterResult = { kind: "ok"; token: string } | { kind: "error"; retryAfterMs: number | null };
export type PullResult =
  | { kind: "ok"; snapshot: RemoteSnapshot }
  | { kind: "none" }
  | { kind: "unauthorized" }
  | { kind: "error"; retryAfterMs: number | null };
export type PushResult =
  | { kind: "ok"; version: number }
  /** 409: `snapshot` — текущий снапшот сервера (его слияние — на клиенте). */
  | { kind: "conflict"; snapshot: RemoteSnapshot | null }
  | { kind: "too_large" }
  | { kind: "unauthorized" }
  | { kind: "error"; retryAfterMs: number | null };

export interface SyncApi {
  register(): Promise<RegisterResult>;
  pull(token: string): Promise<PullResult>;
  push(token: string, body: { version: number; updatedAt: string; data: unknown }): Promise<PushResult>;
}

const TIMEOUT_MS = 15_000;

const retryAfter = (res: Response): number | null => {
  const raw = res.headers.get("retry-after");
  const sec = raw === null ? NaN : Number(raw);
  return Number.isFinite(sec) && sec >= 0 ? Math.min(sec, 3600) * 1000 : null;
};

function asSnapshot(v: unknown): RemoteSnapshot | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o["version"] !== "number" || typeof o["updatedAt"] !== "string" || !("data" in o)) return null;
  return { version: o["version"], updatedAt: o["updatedAt"], data: o["data"] };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export function httpSyncApi(o: Options = {}): SyncApi {
  const opts: Options = { timeoutMs: TIMEOUT_MS, ...o };
  return {
    async register() {
      const res = await request(apiUrl("/api/devices", o.base), { method: "POST", headers: { accept: "application/json" } }, opts);
      if (res === null) return { kind: "error", retryAfterMs: null };
      if (!res.ok) return { kind: "error", retryAfterMs: retryAfter(res) };
      try {
        const body = (await res.json()) as { deviceToken?: unknown };
        return typeof body.deviceToken === "string" && body.deviceToken !== ""
          ? { kind: "ok", token: body.deviceToken }
          : { kind: "error", retryAfterMs: null };
      } catch {
        return { kind: "error", retryAfterMs: null };
      }
    },

    async pull(token) {
      const res = await request(
        apiUrl("/api/snapshot", o.base),
        { headers: { accept: "application/json", ...auth(token) }, cache: "no-store" },
        opts,
      );
      if (res === null) return { kind: "error", retryAfterMs: null };
      if (res.status === 404) return { kind: "none" };
      if (res.status === 401) return { kind: "unauthorized" };
      if (!res.ok) return { kind: "error", retryAfterMs: retryAfter(res) };
      try {
        const snap = asSnapshot(await res.json());
        return snap ? { kind: "ok", snapshot: snap } : { kind: "error", retryAfterMs: null };
      } catch {
        return { kind: "error", retryAfterMs: null };
      }
    },

    async push(token, body) {
      const res = await request(
        apiUrl("/api/snapshot", o.base),
        { method: "PUT", headers: { "content-type": "application/json", ...auth(token) }, body: JSON.stringify(body) },
        opts,
      );
      if (res === null) return { kind: "error", retryAfterMs: null };
      if (res.ok) {
        try {
          const b = (await res.json()) as { version?: unknown };
          return { kind: "ok", version: typeof b.version === "number" ? b.version : body.version };
        } catch {
          return { kind: "ok", version: body.version };
        }
      }
      if (res.status === 409) {
        try {
          const b = (await res.json()) as { snapshot?: unknown };
          return { kind: "conflict", snapshot: asSnapshot(b.snapshot) };
        } catch {
          return { kind: "conflict", snapshot: null };
        }
      }
      if (res.status === 413) return { kind: "too_large" };
      if (res.status === 401) return { kind: "unauthorized" };
      return { kind: "error", retryAfterMs: retryAfter(res) };
    },
  };
}
