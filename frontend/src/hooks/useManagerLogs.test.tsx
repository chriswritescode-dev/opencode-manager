import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagerLogEntry, ManagerLogsResponse } from '@opencode-manager/shared/schemas'
import { DEFAULTS } from '@/config'
import { useManagerLogs } from './useManagerLogs'
import type { UseManagerLogsOptions } from './useManagerLogs'
import { createFetchFake, type FetchRoute } from '@/test/fetchFake'
import { createTestQueryClient } from '@/test/render'

const POLL_INTERVAL_MS = DEFAULTS.LOGS.POLL_INTERVAL_MS

function makeEntry(seq: number, level: ManagerLogEntry['level'] = 'info', instanceId = 'instance-1'): ManagerLogEntry {
  return { seq, timestamp: `t-${seq}`, level, source: 'manager', message: `${instanceId}-${seq}` }
}

interface LogServerOptions {
  pageSize?: number
  overlap?: boolean
}

interface LogServer {
  route: FetchRoute
  requests: URLSearchParams[]
  setEntries: (entries: ManagerLogEntry[]) => void
  addEntries: (entries: ManagerLogEntry[]) => void
  setInstance: (instanceId: string) => void
  setLatestSeq: (seq: number | undefined) => void
}

function createLogServer(options: LogServerOptions = {}): LogServer {
  const pageSize = options.pageSize ?? DEFAULTS.LOGS.DEFAULT_PAGE_SIZE
  let entries: ManagerLogEntry[] = []
  let instanceId = 'instance-1'
  let latestSeqOverride: number | undefined
  const requests: URLSearchParams[] = []

  const route: FetchRoute = {
    method: 'GET',
    path: '/api/logs',
    respond: (request) => {
      requests.push(request.searchParams)
      const rawAfterSeq = request.searchParams.get('afterSeq')
      const afterSeq = rawAfterSeq === null ? undefined : Number(rawAfterSeq)
      const level = request.searchParams.get('level') ?? undefined
      const latestSeq = latestSeqOverride ?? (entries.length > 0 ? entries[entries.length - 1].seq : 0)
      const response = (page: ManagerLogEntry[]): ManagerLogsResponse => ({
        entries: page,
        instanceId,
        latestSeq,
        oldestSeq: page.length > 0 ? page[0].seq : latestSeq,
        dropped: 0,
        capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
      })

      if (afterSeq !== undefined && latestSeq < afterSeq) {
        return { json: response([]) }
      }

      const overlapping = options.overlap === true
      const matching = entries.filter((entry) => {
        const afterCursor = afterSeq === undefined
          ? true
          : overlapping ? entry.seq >= afterSeq : entry.seq > afterSeq
        return afterCursor && (level === undefined || entry.level === level)
      })
      return { json: response(matching.slice(0, pageSize)) }
    },
  }

  return {
    route,
    requests,
    setEntries: (next) => {
      entries = next
    },
    addEntries: (next) => {
      entries = [...entries, ...next]
    },
    setInstance: (next) => {
      instanceId = next
    },
    setLatestSeq: (next) => {
      latestSeqOverride = next
    },
  }
}

function renderLogs(server: LogServer, options: UseManagerLogsOptions = {}) {
  const queryClient = createTestQueryClient()
  const fetchFake = createFetchFake([server.route])
  fetchFake.install()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const rendered = renderHook((props: UseManagerLogsOptions) => useManagerLogs(props), {
    initialProps: options,
    wrapper,
  })
  return { ...rendered, queryClient, fetchFake }
}

async function settleTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('useManagerLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
  })

  it('returns entries from the first response', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(1), makeEntry(2)])

    const { result } = renderLogs(server)
    await settleTime(0)

    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2)])
    expect(result.current.isLoading).toBe(false)
    expect(server.requests).toHaveLength(1)
  })

  it('appends entries from subsequent polls and advances the cursor to the last seq', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(1), makeEntry(2)])

    const { result } = renderLogs(server)
    await settleTime(0)
    server.addEntries([makeEntry(3)])
    await settleTime(POLL_INTERVAL_MS)

    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2), makeEntry(3)])
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1].get('afterSeq')).toBe('2')
  })

  it('does not duplicate entries already seen by the cursor', async () => {
    const server = createLogServer({ overlap: true })
    server.setEntries([makeEntry(1), makeEntry(2)])

    const { result } = renderLogs(server)
    await settleTime(0)
    server.addEntries([makeEntry(3)])
    await settleTime(POLL_INTERVAL_MS)

    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2), makeEntry(3)])
  })

  it('clears accumulated entries and restarts the cursor when the level filter changes', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(1), makeEntry(2)])

    const { result, rerender } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2)])

    server.addEntries([makeEntry(5, 'error')])
    rerender({ level: 'error' })
    await settleTime(0)

    expect(result.current.entries).toEqual([makeEntry(5, 'error')])
    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBeNull()
    expect(server.requests[server.requests.length - 1].get('level')).toBe('error')
  })

  it('stops polling entirely while paused and resumes from the stored cursor', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(1)])

    const { result, rerender } = renderLogs(server, { paused: true })
    await settleTime(0)
    expect(result.current.entries).toEqual([makeEntry(1)])
    expect(server.requests).toHaveLength(1)

    await settleTime(POLL_INTERVAL_MS * 2)
    expect(server.requests).toHaveLength(1)

    server.addEntries([makeEntry(2)])
    rerender({ paused: false })
    await settleTime(POLL_INTERVAL_MS)

    expect(server.requests).toHaveLength(2)
    expect(server.requests[1].get('afterSeq')).toBe('1')
    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2)])
  })

  it('drains a burst larger than the default page size over successive polls without sequence gaps', async () => {
    vi.useFakeTimers()
    const burstSize = DEFAULTS.LOGS.DEFAULT_PAGE_SIZE + 2
    const server = createLogServer()
    server.setEntries([makeEntry(1)])

    const { result, rerender } = renderLogs(server, { paused: true })
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1])

    server.addEntries(Array.from({ length: burstSize }, (_, index) => makeEntry(index + 2)))
    await settleTime(POLL_INTERVAL_MS * 2)
    expect(server.requests).toHaveLength(1)

    rerender({ paused: false })
    for (let poll = 0; poll < 4; poll += 1) {
      await settleTime(POLL_INTERVAL_MS)
    }

    const drained = result.current.entries
    expect(drained).toHaveLength(burstSize + 1)
    drained.forEach((entry, index) => {
      expect(entry.seq).toBe(index + 1)
    })
  })

  it('reconstructs the full tail on remount instead of replaying the cached incremental page', async () => {
    const server = createLogServer()
    server.setEntries([1, 2, 3, 4].map((seq) => makeEntry(seq)))

    const { result, unmount } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])
    unmount()

    server.setEntries([2, 3, 4].map((seq) => makeEntry(seq)))
    const remounted = renderLogs(server)
    expect(remounted.result.current.entries).toEqual([])

    await settleTime(0)

    expect(remounted.result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4])
    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBeNull()
  })

  it('reconstructs the full tail when switching back to a previously used filter key', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(1), makeEntry(2), makeEntry(3), makeEntry(4)])

    const { result, rerender } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])

    server.addEntries([makeEntry(5, 'error')])
    rerender({ level: 'error' })
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([5])

    server.setEntries([makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)])
    rerender({})
    await settleTime(0)

    expect(result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5])
    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBeNull()
  })

  it('rejects a cached cursorless page from a previous mount and adopts the new cursorless response', async () => {
    const server = createLogServer()
    server.setEntries([1, 2, 3].map((seq) => makeEntry(seq)))

    const first = renderLogs(server)
    await settleTime(0)
    expect(first.result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    first.unmount()

    server.setEntries([2, 3, 4, 5].map((seq) => makeEntry(seq)))
    const second = renderLogs(server)
    await settleTime(0)

    expect(second.result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5])
    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBeNull()
  })

  it('clear() empties entries without rewinding the cursor', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(1), makeEntry(2)])

    const { result } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries).toHaveLength(2)

    act(() => {
      result.current.clear()
    })
    expect(result.current.entries).toEqual([])

    server.addEntries([makeEntry(3)])
    await settleTime(POLL_INTERVAL_MS)

    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBe('2')
    expect(result.current.entries).toEqual([makeEntry(3)])
  })

  it('advances the cursor to latestSeq when an accepted response has no entries', async () => {
    const server = createLogServer()
    server.setLatestSeq(200)

    const { result } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries).toEqual([])

    server.setLatestSeq(undefined)
    server.addEntries([makeEntry(201)])
    await settleTime(POLL_INTERVAL_MS)

    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBe('200')
    expect(result.current.entries).toEqual([makeEntry(201)])
  })

  it('sends afterSeq 0 after an accepted empty response whose latestSeq is 0', async () => {
    const server = createLogServer()

    const { result } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries).toEqual([])

    server.addEntries([makeEntry(1)])
    await settleTime(POLL_INTERVAL_MS)

    expect(server.requests[server.requests.length - 1].get('afterSeq')).toBe('0')
    expect(result.current.entries).toEqual([makeEntry(1)])
  })

  it('re-establishes a cursorless tail when the server watermark moves behind the requested cursor', async () => {
    const server = createLogServer()
    server.setEntries([makeEntry(100)])

    const { result } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([100])

    server.setEntries([1, 2, 3, 4, 5].map((seq) => makeEntry(seq, 'info', 'instance-restarted')))
    server.setInstance('instance-restarted')
    await settleTime(POLL_INTERVAL_MS)

    expect(server.requests[1].get('afterSeq')).toBe('100')
    expect(server.requests[2].get('afterSeq')).toBeNull()
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('discards old-process entries and refetches cursorlessly when the backend instanceId changes even if latestSeq is not behind the cursor', async () => {
    const server = createLogServer()
    server.setEntries([98, 99, 100].map((seq) => makeEntry(seq, 'info', 'instance-a')))

    const { result } = renderLogs(server)
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([98, 99, 100])

    server.setInstance('instance-b')
    server.setLatestSeq(150)
    server.setEntries([
      makeEntry(101, 'info', 'instance-b'),
      makeEntry(102, 'info', 'instance-b'),
      makeEntry(103, 'info', 'instance-b'),
    ])
    await settleTime(POLL_INTERVAL_MS)

    expect(server.requests[1].get('afterSeq')).toBe('100')
    expect(server.requests[2].get('afterSeq')).toBeNull()
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([101, 102, 103])
  })

  it('never accumulates more entries than the buffer capacity', async () => {
    const server = createLogServer({ pageSize: DEFAULTS.LOGS.BUFFER_CAPACITY * 2 })
    const first = Array.from({ length: 50 }, (_, index) => makeEntry(index + 1))
    server.setEntries(first)

    const { result } = renderLogs(server)
    await settleTime(0)

    const second = Array.from(
      { length: DEFAULTS.LOGS.BUFFER_CAPACITY + 100 },
      (_, index) => makeEntry(first.length + index + 1),
    )
    server.addEntries(second)
    await settleTime(POLL_INTERVAL_MS)

    expect(result.current.entries).toHaveLength(DEFAULTS.LOGS.BUFFER_CAPACITY)
    expect(result.current.entries[0].seq).toBe(first.length + second.length - DEFAULTS.LOGS.BUFFER_CAPACITY + 1)
    expect(result.current.entries[result.current.entries.length - 1].seq).toBe(first.length + second.length)
  })
})
