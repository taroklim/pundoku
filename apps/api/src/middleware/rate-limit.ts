import type { Request, RequestHandler, Response } from "express";

/**
 * Простой in-memory rate-limit по IP: фиксированное окно. Один процесс, без Redis —
 * для личного проекта достаточно. Заголовки RateLimit-* по draft-ietf-httpapi-ratelimit-headers.
 */
export interface RateLimitOptions {
  windowMs: number;
  max: number;
  now?: () => number;
  /** Ключ корзины; по умолчанию IP. Для лимита «по устройству» — `res.locals.deviceId` (после requireDevice). */
  key?: (req: Request, res: Response) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit({ windowMs, max, now = Date.now, key: keyOf }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  const sweep = (t: number): void => {
    // Ленивая уборка протухших окон, чтобы Map не рос бесконечно.
    if (buckets.size < 1000) return;
    for (const [key, bucket] of buckets) if (bucket.resetAt <= t) buckets.delete(key);
  };

  return (req, res, next) => {
    const t = now();
    sweep(t);
    const key = keyOf ? keyOf(req, res) : (req.ip ?? "unknown");
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    const resetSec = Math.ceil((bucket.resetAt - t) / 1000);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSec));
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(resetSec));
      res.status(429).json({ error: { code: "rate_limited", message: `Слишком много запросов, попробуй через ${resetSec} с` } });
      return;
    }
    next();
  };
}

/**
 * Счётчик НЕУДАЧ в фиксированном окне (in-memory, один процесс): `blocked(key)` — сколько секунд ждать (0 — можно),
 * `fail(key)` — записать неудачу. Успехи не считаются: обычный человек с опечаткой в ключе не упрётся в лимит,
 * а перебор упирается после `max` промахов. Нужен для redeem ключа восстановления (PD-27).
 */
export class FailureCounter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  blocked(key: string): number {
    const bucket = this.buckets.get(key);
    const t = this.now();
    if (!bucket || bucket.resetAt <= t || bucket.count < this.max) return 0;
    return Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
  }

  fail(key: string): void {
    const t = this.now();
    if (this.buckets.size >= 1000) for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
  }
}

/** Пропускает, пока по ключу не набралось `max` неудач; иначе 429 с Retry-After (тем же JSON, что и rateLimit). */
export function failureGuard(counter: FailureCounter, key: (req: Request, res: Response) => string): RequestHandler {
  return (req, res, next) => {
    const wait = counter.blocked(key(req, res));
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      res.status(429).json({ error: { code: "rate_limited", message: `Слишком много неудачных попыток, попробуй через ${wait} с` } });
      return;
    }
    next();
  };
}
