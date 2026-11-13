import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import type { ManagerLogEntry } from '@opencode-manager/shared/schemas'
import { SettingsDialog } from './SettingsDialog'
import { DEFAULTS } from '@/config'
import { renderWithProviders } from '@/test/render'
import { makeHealthResponse } from '@/test/fixtures/api'
import { installMatchMedia, installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'

const POLL_INTERVAL_MS = DEFAULTS.LOGS.POLL_INTERVAL_MS

function makeEntry(seq: number): ManagerLogEntry {
  return {
    seq,
    timestamp: new Date(Date.UTC(2026, 0, 1, 12, 0, seq)).toISOString(),
    level: 'info',
    source: 'manager',
    message: `captured-line-${seq}`,
  }
}

function createLogsServer(initialEntries: ManagerLogEntry[] = [makeEntry(1), makeEntry(2)]) {
  let entries = initialEntries
  let polls = 0

  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/logs',
      respond: () => {
        polls += 1
        const seqs = entries.map((entry) => entry.seq)
        return {
          json: {
            entries,
            instanceId: 'instance-1',
            latestSeq: seqs.length > 0 ? seqs[seqs.length - 1] : 0,
            oldestSeq: seqs.length > 0 ? seqs[0] : 0,
            dropped: 0,
            capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
          },
        }
      },
    },
    { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse({ opencode: 'healthy' }) }) },
  ]

  return {
    routes,
    pollCount: () => polls,
    setEntries: (next: ManagerLogEntry[]) => {
      entries = next
    },
  }
}

function renderLogsSettings(desktop: boolean, fetchRoutes: FetchRoute[]) {
  installMatchMedia(desktop)
  installPointerCapture()
  return renderWithProviders(<SettingsDialog />, {
    initialEntries: ['/?settings=open&settingsTab=logs'],
    fetchRoutes,
  })
}

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('SettingsDialog live Logs view integration', () => {
  it.each([
    { label: 'desktop', desktop: true },
    { label: 'mobile', desktop: false },
  ])('mounts exactly one live Logs viewer on $label and renders the first polled response', async ({ desktop }) => {
    vi.useFakeTimers()
    try {
      const server = createLogsServer()
      renderLogsSettings(desktop, server.routes)

      await settle(0)

      expect(server.pollCount()).toBe(1)
      expect(screen.getAllByText('captured-line-2')).toHaveLength(1)
      expect(screen.queryByText('No log entries captured yet.')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops polling while Pause is active and resumes without gaps', async () => {
    vi.useFakeTimers()
    try {
      const server = createLogsServer([])
      renderLogsSettings(true, server.routes)

      await settle(0)
      expect(server.pollCount()).toBe(1)

      fireEvent.click(screen.getByRole('button', { name: /pause/i }))
      await settle(POLL_INTERVAL_MS * 2)
      expect(server.pollCount()).toBe(1)

      server.setEntries([makeEntry(3)])
      fireEvent.click(screen.getByRole('button', { name: /resume/i }))
      await settle(POLL_INTERVAL_MS)

      expect(server.pollCount()).toBe(2)
      expect(screen.getByText('captured-line-3')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
