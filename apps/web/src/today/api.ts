/**
 * Клиент `GET /api/daily/:date` и `POST /api/daily/:date/verify` (`apps/api`). Никогда не бросает:
 * любой отказ — значение (`FetchedDay { ok: false }` / `null`), а решение «что играть» принимает
 * `dayResolver`. Base URL — `VITE_API_BASE_URL`; пусто — тот же origin (dev-прокси Vite `/api`).
 */
import type { FetchedDay } from "./dayResolver";
import { parseDaily } from "./dayResolver";

/** Верхняя граница ожидания ответа: сервер сам ждёт Sudoku.com до 5 с, потом отдаёт фолбэк. */
export const FETCH_TIMEOUT_MS = 8000;

export function apiUrl(path: string, base: string = import.meta.env.VITE_API_BASE_URL ?? ""): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

interface Options {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  base?: string;
}

async function request(url: string, init: RequestInit, o: Options): Promise<Response | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? FETCH_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  o.signal?.addEventListener("abort", onAbort);
  try {
    return await (o.fetchFn ?? fetch)(url, { ...init, signal: ctl.signal });
  } catch {
    return null; // офлайн, DNS, таймаут, отмена
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchDaily(date: string, o: Options = {}): Promise<FetchedDay> {
  // `no-cache` = всегда сверяться с сервером: фолбэк-сетка отдаётся с `max-age=60` и заменяется на
  // сетку Sudoku.com, а возврат в сеть как раз и проверяет, не заменилась ли она (см. README).
  const res = await request(
    apiUrl(`/api/daily/${date}`, o.base),
    { headers: { accept: "application/json" }, cache: "no-cache" },
    o,
  );
  if (res === null) return { ok: false, reason: "network" };
  if (!res.ok) return { ok: false, reason: "http" }; // 404 not_available_yet, 429, 503 и т. п.
  try {
    return parseDaily(date, await res.json());
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Проверка решения на сервере. `true/false` — ответ сервера; `null` — ответа нет (сеть/ошибка):
 * решение при этом остаётся решённым (проверено локально), просто без серверного подтверждения.
 */
export async function verifyDaily(date: string, grid: string, o: Options = {}): Promise<boolean | null> {
  const res = await request(
    apiUrl(`/api/daily/${date}/verify`, o.base),
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grid }) },
    o,
  );
  if (res === null || !res.ok) return null;
  try {
    const body = (await res.json()) as { correct?: unknown };
    return typeof body.correct === "boolean" ? body.correct : null;
  } catch {
    return null;
  }
}
