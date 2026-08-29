import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ManagerLogEntry, ManagerLogsResponse } from '@opencode-manager/shared/schemas'
import { DEFAULTS } from '@/config'
import { logsApi } from '@/api/logs'
import { useManagerLogs } from './useManagerLogs'
import type { UseManagerLogsOptions } from './useManagerLogs'

vi.mock('@/api/logs', () => ({
  logsApi: {
    getManagerLogs: vi.fn(),
  },
}))

const getManagerLogs = vi.mocked(logsApi.getManagerLogs)

const POLL_INTERVAL_MS = DEFAULTS.LOGS.POLL_INTERVAL_MS

function makeEntry(seq: number, message = `log-${seq}`): ManagerLogEntry {
  return { seq, timestamp: `t-${seq}`, level: 'info', source: 'manager', message }
}

function makeResponse(
  entries: ManagerLogEntry[],
  instanceId = 'instance-1',
  latestSeqOverride?: number
): ManagerLogsResponse {
  const seqs = entries.map((entry) => entry.seq)
  const latestSeq = latestSeqOverride ?? (seqs.length > 0 ? seqs[seqs.length - 1] : 0)
  return {
    entries,
    instanceId,
    latestSeq,
    oldestSeq: seqs.length > 0 ? seqs[0] : 0,
    dropped: 0,
    capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient = createQueryClient()) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
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
    vi.resetAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns entries from the first response', async () => {
    getManagerLogs.mockResolvedValue(makeResponse([makeEntry(1), makeEntry(2)]))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)

    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2)])
    expect(result.current.isLoading).toBe(false)
    expect(getManagerLogs).toHaveBeenCalledTimes(1)
  })

  it('appends entries from subsequent polls and advances the cursor to the last seq', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(3)]))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    await settleTime(POLL_INTERVAL_MS)

    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2), makeEntry(3)])
    expect(getManagerLogs).toHaveBeenCalledTimes(2)
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: 2,
      level: undefined,
      source: undefined,
    })
  })

  it('does not duplicate entries already seen by the cursor', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(2), makeEntry(3)]))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    await settleTime(POLL_INTERVAL_MS)

    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2), makeEntry(3)])
  })

  it('clears accumulated entries and restarts the cursor when the level filter changes', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(5, 'error-5')]))

    const { result, rerender } = renderHook(
      (props: UseManagerLogsOptions) => useManagerLogs(props),
      { initialProps: {}, wrapper: createWrapper() }
    )

    await settleTime(0)
    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2)])

    rerender({ level: 'error' })
    await settleTime(0)

    expect(result.current.entries).toEqual([makeEntry(5, 'error-5')])
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: undefined,
      level: 'error',
      source: undefined,
    })
  })

  it('stops polling entirely while paused and resumes from the stored cursor', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(2)]))

    const { result, rerender } = renderHook(
      (props: UseManagerLogsOptions) => useManagerLogs(props),
      { initialProps: { paused: true }, wrapper: createWrapper() }
    )

    await settleTime(0)
    expect(result.current.entries).toEqual([makeEntry(1)])
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    await settleTime(POLL_INTERVAL_MS * 2)
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    rerender({ paused: false })
    await settleTime(POLL_INTERVAL_MS)

    expect(getManagerLogs).toHaveBeenCalledTimes(2)
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: 1,
      level: undefined,
      source: undefined,
    })
    expect(result.current.entries).toEqual([makeEntry(1), makeEntry(2)])
  })

  it('drains a burst larger than the default page size over successive polls without sequence gaps', async () => {
    const burstSize = DEFAULTS.LOGS.DEFAULT_PAGE_SIZE + 2
    const store: ManagerLogEntry[] = [makeEntry(1)]
    getManagerLogs.mockImplementation(async ({ afterSeq }: { afterSeq?: number }) => {
      const matched = store.filter((entry) => entry.seq > (afterSeq ?? 0))
      return makeResponse(matched.slice(0, DEFAULTS.LOGS.DEFAULT_PAGE_SIZE), 'instance-1', store[store.length - 1].seq)
    })

    const { result, rerender } = renderHook(
      (props: UseManagerLogsOptions) => useManagerLogs(props),
      { initialProps: { paused: true }, wrapper: createWrapper() }
    )

    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1])

    for (let i = 2; i <= burstSize + 1; i++) {
      store.push(makeEntry(i))
    }
    await settleTime(POLL_INTERVAL_MS * 2)
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    rerender({ paused: false })
    for (let i = 0; i < 4; i++) {
      await settleTime(POLL_INTERVAL_MS)
    }

    const drained = result.current.entries
    expect(drained).toHaveLength(burstSize + 1)
    drained.forEach((entry, index) => {
      expect(entry.seq).toBe(index + 1)
    })
  })

  it('reconstructs the full tail on remount instead of replaying the cached incremental page', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2), makeEntry(3)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(4)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(2), makeEntry(3), makeEntry(4)]))

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const first = renderHook(() => useManagerLogs(), { wrapper })
    await settleTime(0)
    await settleTime(POLL_INTERVAL_MS)
    expect(first.result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])
    expect(getManagerLogs).toHaveBeenCalledTimes(2)

    first.unmount()

    const second = renderHook(() => useManagerLogs(), { wrapper })
    expect(second.result.current.entries).toEqual([])

    await settleTime(0)

    expect(second.result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4])
    expect(getManagerLogs).toHaveBeenCalledTimes(3)
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: undefined,
      level: undefined,
      source: undefined,
    })
  })

  it('reconstructs the full tail when switching back to a previously used filter key', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2), makeEntry(3)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(4)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(5, 'error-5')]))
      .mockResolvedValueOnce(makeResponse([makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)]))

    const { result, rerender } = renderHook(
      (props: UseManagerLogsOptions) => useManagerLogs(props),
      { initialProps: {}, wrapper: createWrapper() }
    )

    await settleTime(0)
    await settleTime(POLL_INTERVAL_MS)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])

    rerender({ level: 'error' })
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([5])

    rerender({})
    await settleTime(0)

    expect(result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5])
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: undefined,
      level: undefined,
      source: undefined,
    })
  })

  it('rejects a cached cursorless page from a previous mount and adopts the new cursorless response', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2), makeEntry(3)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)]))

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const first = renderHook(() => useManagerLogs(), { wrapper })
    await settleTime(0)
    expect(first.result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    first.unmount()

    const second = renderHook(() => useManagerLogs(), { wrapper })
    await settleTime(0)

    expect(second.result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5])
    expect(getManagerLogs).toHaveBeenCalledTimes(2)
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: undefined,
      level: undefined,
      source: undefined,
    })
  })

  it('rejects a cached cursorless page when switching back to a previously used filter', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2), makeEntry(3)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(5, 'error-5')]))
      .mockResolvedValueOnce(makeResponse([makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)]))

    const { result, rerender } = renderHook(
      (props: UseManagerLogsOptions) => useManagerLogs(props),
      { initialProps: {}, wrapper: createWrapper() }
    )

    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    rerender({ level: 'error' })
    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([5])
    expect(getManagerLogs).toHaveBeenCalledTimes(2)

    rerender({})
    await settleTime(0)

    expect(result.current.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5])
    expect(getManagerLogs).toHaveBeenCalledTimes(3)
    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: undefined,
      level: undefined,
      source: undefined,
    })
  })

  it('clear() empties entries without rewinding the cursor', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(1), makeEntry(2)]))
      .mockResolvedValueOnce(makeResponse([makeEntry(3)]))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    expect(result.current.entries).toHaveLength(2)

    act(() => {
      result.current.clear()
    })
    expect(result.current.entries).toEqual([])

    await settleTime(POLL_INTERVAL_MS)

    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: 2,
      level: undefined,
      source: undefined,
    })
    expect(result.current.entries).toEqual([makeEntry(3)])
  })

  it('advances the cursor to latestSeq when an accepted response has no entries', async () => {
    const emptyResponse: ManagerLogsResponse = {
      entries: [],
      instanceId: 'instance-1',
      latestSeq: 200,
      oldestSeq: 200,
      dropped: 0,
      capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
    }
    getManagerLogs
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(makeResponse([makeEntry(201)]))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    expect(result.current.entries).toEqual([])

    await settleTime(POLL_INTERVAL_MS)

    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: 200,
      level: undefined,
      source: undefined,
    })
    expect(result.current.entries).toEqual([makeEntry(201)])
  })

  it('sends afterSeq 0 after an accepted empty response whose latestSeq is 0', async () => {
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([]))
      .mockResolvedValueOnce(makeResponse([makeEntry(1)]))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    expect(result.current.entries).toEqual([])

    await settleTime(POLL_INTERVAL_MS)

    expect(getManagerLogs).toHaveBeenLastCalledWith({
      afterSeq: 0,
      level: undefined,
      source: undefined,
    })
    expect(result.current.entries).toEqual([makeEntry(1)])
  })

  it('re-establishes a cursorless tail when the server watermark moves behind the requested cursor', async () => {
    const restartedResponse: ManagerLogsResponse = {
      entries: [],
      instanceId: 'instance-restarted',
      latestSeq: 5,
      oldestSeq: 5,
      dropped: 0,
      capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
    }
    getManagerLogs
      .mockResolvedValueOnce(makeResponse([makeEntry(100)]))
      .mockResolvedValueOnce(restartedResponse)
      .mockResolvedValueOnce(
        makeResponse([makeEntry(1), makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)], 'instance-restarted')
      )

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([100])

    await settleTime(POLL_INTERVAL_MS)

    expect(getManagerLogs).toHaveBeenNthCalledWith(2, {
      afterSeq: 100,
      level: undefined,
      source: undefined,
    })
    expect(getManagerLogs).toHaveBeenNthCalledWith(3, {
      afterSeq: undefined,
      level: undefined,
      source: undefined,
    })
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('discards old-process entries and refetches cursorlessly when the backend instanceId changes even if latestSeq is not behind the cursor', async () => {
    getManagerLogs
      .mockResolvedValueOnce(
        makeResponse([makeEntry(98), makeEntry(99), makeEntry(100)], 'instance-a')
      )
      .mockResolvedValueOnce(
        makeResponse([makeEntry(101), makeEntry(102)], 'instance-b', 150)
      )
      .mockResolvedValueOnce(
        makeResponse([makeEntry(101), makeEntry(102), makeEntry(103)], 'instance-b', 150)
      )

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([98, 99, 100])

    await settleTime(POLL_INTERVAL_MS)

    expect(getManagerLogs).toHaveBeenNthCalledWith(2, {
      afterSeq: 100,
      level: undefined,
      source: undefined,
    })
    expect(getManagerLogs).toHaveBeenNthCalledWith(3, {
      afterSeq: undefined,
      level: undefined,
      source: undefined,
    })
    expect(result.current.entries.map((entry) => entry.seq)).toEqual([101, 102, 103])
  })

  it('never accumulates more entries than the buffer capacity', async () => {
    const first = Array.from({ length: 50 }, (_, i) => makeEntry(i + 1))
    const second = Array.from({ length: DEFAULTS.LOGS.BUFFER_CAPACITY + 100 }, (_, i) =>
      makeEntry(first.length + i + 1)
    )
    getManagerLogs
      .mockResolvedValueOnce(makeResponse(first))
      .mockResolvedValueOnce(makeResponse(second))

    const { result } = renderHook(() => useManagerLogs(), { wrapper: createWrapper() })

    await settleTime(0)
    await settleTime(POLL_INTERVAL_MS)

    expect(result.current.entries).toHaveLength(DEFAULTS.LOGS.BUFFER_CAPACITY)
    expect(result.current.entries[0].seq).toBe(first.length + second.length - DEFAULTS.LOGS.BUFFER_CAPACITY + 1)
    expect(result.current.entries[result.current.entries.length - 1].seq).toBe(
      first.length + second.length
    )
  })
})
