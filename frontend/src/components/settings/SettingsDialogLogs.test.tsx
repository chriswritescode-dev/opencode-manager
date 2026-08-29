import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ManagerLogEntry } from '@opencode-manager/shared/schemas'
import { SettingsDialog } from './SettingsDialog'
import { logsApi } from '@/api/logs'
import { DEFAULTS } from '@/config'
import { DESKTOP_MEDIA_QUERY } from '@/hooks/useMediaQuery'

vi.mock('@/api/logs', () => ({
  logsApi: {
    getManagerLogs: vi.fn(),
  },
}))

vi.mock('@/hooks/useMobile', () => ({
  useSwipeBack: vi.fn(() => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  })),
}))

const getManagerLogs = vi.mocked(logsApi.getManagerLogs)

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

function makeResponse(entries: ManagerLogEntry[]) {
  const seqs = entries.map((entry) => entry.seq)
  return {
    entries,
    instanceId: 'instance-1',
    latestSeq: seqs.length > 0 ? seqs[seqs.length - 1] : 0,
    oldestSeq: seqs.length > 0 ? seqs[0] : 0,
    dropped: 0,
    capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
  }
}

function stubMatchMedia(matches: boolean): void {
  const listeners = new Set<() => void>()
  const mediaQueryList = {
    media: DESKTOP_MEDIA_QUERY,
    matches,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mediaQueryList,
  })
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={['/?settings=open&settingsTab=logs']}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
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

describe('SettingsDialog live Logs view integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    getManagerLogs.mockResolvedValue(makeResponse([makeEntry(1), makeEntry(2)]))
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    vi.useRealTimers()
  })

  it('mounts exactly one live LogsViewer on desktop and renders the first polled response', async () => {
    stubMatchMedia(true)
    render(<SettingsDialog />, { wrapper: createWrapper() })

    await settleTime(0)

    expect(getManagerLogs).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('captured-line-2')).toHaveLength(1)
    expect(screen.getAllByText('Manager')).toHaveLength(2)
    expect(screen.queryByText('No log entries captured yet.')).not.toBeInTheDocument()
  })

  it('mounts exactly one live LogsViewer on mobile and renders the first polled response', async () => {
    stubMatchMedia(false)
    render(<SettingsDialog />, { wrapper: createWrapper() })

    await settleTime(0)

    expect(getManagerLogs).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('captured-line-2')).toHaveLength(1)
  })

  it('stops all /api/logs polling while Pause is active and resumes without gaps', async () => {
    stubMatchMedia(false)
    getManagerLogs.mockImplementation(async () => makeResponse([]))
    render(<SettingsDialog />, { wrapper: createWrapper() })

    await settleTime(0)
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    await settleTime(POLL_INTERVAL_MS * 2)
    expect(getManagerLogs).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    getManagerLogs.mockResolvedValue(makeResponse([makeEntry(3)]))
    await settleTime(POLL_INTERVAL_MS)
    expect(getManagerLogs).toHaveBeenCalledTimes(2)
    expect(screen.getByText('captured-line-3')).toBeInTheDocument()
  })
})
