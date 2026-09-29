import type { RequestHandler } from "express";

/**
 * Простой in-memory rate-limit по IP: фиксированное окно. Один процесс, без Redis —
 * для личного проекта достаточно. Заголовки RateLimit-* по draft-ietf-httpapi-ratelimit-headers.
 */
export interface RateLimitOptions {
  windowMs: number;
  max: number;
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit({ windowMs, max, now = Date.now }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  const sweep = (t: number): void => {
    // Ленивая уборка протухших окон, чтобы Map не рос бесконечно.
    if (buckets.size < 1000) return;
    for (const [key, bucket] of buckets) if (bucket.resetAt <= t) buckets.delete(key);
  };

  return (req, res, next) => {
    const t = now();
    sweep(t);
    const key = req.ip ?? "unknown";
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
