import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../../src/utils/concurrency'

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
