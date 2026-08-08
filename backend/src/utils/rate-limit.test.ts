import { describe, it, expect } from 'vitest'
import { TokenBucketRateLimiter } from './rate-limit'

describe('TokenBucketRateLimiter', () => {
  it('allows first 10 calls within capacity', () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillPerMs: 6000 })
    const results: boolean[] = []

    for (let i = 0; i < 10; i++) {
      const result = limiter.tryConsume('test-key')
      results.push(result.allowed)
    }

    expect(results.every((r) => r)).toBe(true)
  })

  it('rejects 11th call within rate window', () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillPerMs: 6000 })

    for (let i = 0; i < 10; i++) {
      limiter.tryConsume('test-key')
    }

    const result = limiter.tryConsume('test-key')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('refills tokens after time advances', () => {
    let currentTime = 0
    const limiter = new TokenBucketRateLimiter(
      { capacity: 10, refillPerMs: 10000 },
      () => currentTime,
    )

    for (let i = 0; i < 10; i++) {
      limiter.tryConsume('test-key')
    }

    let result = limiter.tryConsume('test-key')
    expect(result.allowed).toBe(false)

    currentTime = 5000
    result = limiter.tryConsume('test-key')
    expect(result.allowed).toBe(true)
  })

  it('maintains independent buckets for distinct keys', () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillPerMs: 6000 })

    for (let i = 0; i < 10; i++) {
      limiter.tryConsume('key-a')
    }

    const resultA = limiter.tryConsume('key-a')
    const resultB = limiter.tryConsume('key-b')

    expect(resultA.allowed).toBe(false)
    expect(resultB.allowed).toBe(true)
  })
})
