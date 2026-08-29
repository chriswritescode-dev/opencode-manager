import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LogsViewer } from './LogsViewer'
import { useManagerLogs } from '@/hooks/useManagerLogs'
import type { ManagerLogEntry } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useManagerLogs')

const entries: ManagerLogEntry[] = [
  {
    seq: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    source: 'manager',
    message: 'Server started on port 5003',
  },
  {
    seq: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    level: 'error',
    source: 'opencode',
    message: 'Connection refused while dialing upstream',
  },
]

function mockLogs(overrides: Partial<ReturnType<typeof useManagerLogs>> = {}) {
  vi.mocked(useManagerLogs).mockReturnValue({
    entries,
    dropped: 0,
    isLoading: false,
    error: null,
    clear: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useManagerLogs>)
}

describe('LogsViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogs()
  })

  it('renders entries with their message, level and source', () => {
    render(<LogsViewer />)

    expect(screen.getByText('Server started on port 5003')).toBeInTheDocument()
    expect(screen.getByText('Connection refused while dialing upstream')).toBeInTheDocument()
    expect(screen.getAllByText(/^(info|error)$/i)).toHaveLength(2)
    expect(screen.getByText('Manager')).toBeInTheDocument()
    expect(screen.getByText('OpenCode server')).toBeInTheDocument()
  })

  it('hides rows that do not match the search text', async () => {
    const user = userEvent.setup()
    render(<LogsViewer />)

    await user.type(screen.getByLabelText('Search log messages'), 'refused')

    expect(screen.queryByText('Server started on port 5003')).not.toBeInTheDocument()
    expect(screen.getByText('Connection refused while dialing upstream')).toBeInTheDocument()
  })

  it('re-invokes the hook paused and switches the button to Resume', async () => {
    const user = userEvent.setup()
    render(<LogsViewer />)

    await user.click(screen.getByRole('button', { name: /pause/i }))

    expect(vi.mocked(useManagerLogs).mock.lastCall?.[0]).toMatchObject({ paused: true })
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
  })

  it('clears the displayed entries through the hook', async () => {
    const user = userEvent.setup()
    const clear = vi.fn()
    mockLogs({ clear })
    render(<LogsViewer />)

    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(clear).toHaveBeenCalled()
  })

  it('renders the empty-state copy when no entries are captured', () => {
    mockLogs({ entries: [] })
    render(<LogsViewer />)

    expect(screen.getByText('No log entries captured yet.')).toBeInTheDocument()
  })

  it('renders the dropped-entries note when entries were dropped', () => {
    mockLogs({ dropped: 3 })
    render(<LogsViewer />)

    expect(screen.getByText(/3 earlier entries dropped \(buffer holds \d+\)/)).toBeInTheDocument()
  })
})
