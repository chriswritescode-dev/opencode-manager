export interface RateLimiterOptions {
  capacity: number
  refillPerMs: number
}

interface BucketState {
  tokens: number
  lastRefill: number
}

export class TokenBucketRateLimiter {
  private buckets: Map<string, BucketState>

  constructor(
    private opts: RateLimiterOptions,
    private now: () => number = Date.now,
  ) {
    this.buckets = new Map()
  }

  tryConsume(key: string, cost = 1): { allowed: boolean; retryAfterMs: number } {
    const bucket = this.buckets.get(key) ?? this.createBucket(key)

    const elapsed = this.now() - bucket.lastRefill
    const refill = (elapsed / this.opts.refillPerMs) * this.opts.capacity
    bucket.tokens = Math.min(bucket.tokens + refill, this.opts.capacity)
    bucket.lastRefill = this.now()

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return { allowed: true, retryAfterMs: 0 }
    }

    const tokensNeeded = cost - bucket.tokens
    const retryAfterMs = (tokensNeeded / this.opts.capacity) * this.opts.refillPerMs
    return { allowed: false, retryAfterMs }
  }

  private createBucket(key: string): BucketState {
    const state: BucketState = {
      tokens: this.opts.capacity,
      lastRefill: this.now(),
    }
    this.buckets.set(key, state)
    return state
  }
}
