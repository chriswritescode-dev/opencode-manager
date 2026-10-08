import { describe, expect, it } from 'vitest'
import { createLimiter, mapWithConcurrency } from '../../src/utils/concurrency'

describe('mapWithConcurrency', () => {
  it('keeps result order', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => item * 2)
    expect(result).toEqual([2, 4, 6, 8, 10])
  })

  it('runs at most limit calls at once', async () => {
    let inFlight = 0
    let maxInFlight = 0

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return item
    })

    expect(maxInFlight).toBe(2)
  })

  it('propagates a rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) {
          throw new Error('boom')
        }
        return item
      }),
    ).rejects.toThrow('boom')
  })

  it('passes the index to the callback', async () => {
    const result = await mapWithConcurrency(['a', 'b'], 2, async (item, index) => `${item}${index}`)
    expect(result).toEqual(['a0', 'b1'])
  })
})

describe('createLimiter', () => {
  it('runs at most limit tasks at once', async () => {
    const limiter = createLimiter(2)
    let inFlight = 0
    let maxInFlight = 0

    const task = async (value: number): Promise<number> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return value
    }

    const results = await Promise.all([1, 2, 3, 4, 5].map((value) => limiter.run(() => task(value))))

    expect(results).toEqual([1, 2, 3, 4, 5])
    expect(maxInFlight).toBe(2)
    expect(limiter.activeCount).toBe(0)
  })

  it('queues tasks beyond the limit until a slot frees', async () => {
    const limiter = createLimiter(1)
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const first = limiter.run(async () => {
      order.push('first')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
    })

    const second = limiter.run(async () => {
      order.push('second')
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['first'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('releases the slot when a task rejects', async () => {
    const limiter = createLimiter(1)

    await expect(limiter.run(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
    expect(limiter.activeCount).toBe(0)
  })
})
