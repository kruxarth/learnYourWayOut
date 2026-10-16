/** Per-key token bucket. Time is injected for tests. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  /** `capacity` requests per `windowMs`, refilled continuously. */
  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes one token. Returns false when the key is out of tokens. */
  allow(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / this.windowMs) * this.capacity);
    b.at = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 5000) this.sweep(t);
    return ok;
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) if (t - b.at > this.windowMs) this.buckets.delete(k);
  }
}

export const NEW_PACKS_PER_WINDOW = 6;
export const NEW_PACKS_WINDOW_MS = 10 * 60_000;
export const POLLS_PER_WINDOW = 60;
export const POLLS_WINDOW_MS = 60_000;
