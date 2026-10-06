/**
 * Fixed-window in-memory limiter. Suitable for a single instance; for horizontal
 * scaling swap the store for Redis (interface kept deliberately small).
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): { count: number; resetAt: number };
}

class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, windowMs: number) {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      if (this.buckets.size > 50_000) this.sweep(now);
      return fresh;
    }
    b.count += 1;
    return b;
  }
  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

const store: RateLimitStore = new MemoryStore();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const { count, resetAt } = store.hit(key, windowMs);
  return { allowed: count <= limit, retryAfterMs: Math.max(0, resetAt - Date.now()) };
}
