export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const workerCount = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) {
        return
      }
      results[index] = await fn(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export interface Limiter {
  readonly activeCount: number
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, limit)
  let active = 0
  const waiters: Array<() => void> = []

  const acquire = (): Promise<void> => {
    if (active < max) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }

  const release = (): void => {
    const next = waiters.shift()
    if (next) {
      next()
      return
    }
    active -= 1
  }

  return {
    get activeCount(): number {
      return active
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
