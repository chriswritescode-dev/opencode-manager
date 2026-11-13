import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { installMatchMedia, installWindowSize } from '@/test/browserFakes'
import { connectTestEventStream } from '@/test/render'
import { renderSessionPage } from '@/test/sessionPage'
import type { FetchFake } from '@/test/fetchFake'

const SYNC_INTERVAL_MS = 30000
const SETTLE_MS = 1000

function pendingSyncRequests(fetchFake: FetchFake) {
  return fetchFake.findRequests('GET', '/api/opencode/api/permission/request').length
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('SessionDetail pending-actions polling', () => {
  beforeEach(() => {
    installMatchMedia(false)
    installWindowSize(900)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { name: 'polls every 30s while the stream is down and the session is active', connected: false, activeSessions: ['session-1'], expectedPolls: 1 },
    { name: 'stops polling while the stream is connected', connected: true, activeSessions: ['session-1'], expectedPolls: 0 },
    { name: 'stops polling while the stream is down and the session is idle', connected: false, activeSessions: [], expectedPolls: 0 },
  ])('$name', async ({ connected, activeSessions, expectedPolls }) => {
    const { fetchFake, eventStream } = renderSessionPage({ activeSessions })

    await waitFor(() => expect(pendingSyncRequests(fetchFake)).toBe(1))
    if (connected) await connectTestEventStream(eventStream)
    await advance(SETTLE_MS)
    const settledRequests = pendingSyncRequests(fetchFake)

    await advance(SYNC_INTERVAL_MS)

    expect(pendingSyncRequests(fetchFake) - settledRequests).toBe(expectedPolls)
  })
})
