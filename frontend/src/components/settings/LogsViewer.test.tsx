import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ManagerLogEntry, ManagerLogsResponse } from '@opencode-manager/shared/schemas'
import { LogsViewer } from './LogsViewer'
import { renderWithProviders } from '@/test/render'
import { makeHealthResponse } from '@/test/fixtures/api'
import type { HealthResponse } from '@/hooks/useServerHealth'
import type { FetchRoute } from '@/test/fetchFake'

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

interface LogsServerOptions {
  entries?: ManagerLogEntry[]
  dropped?: number
  health?: Partial<HealthResponse>
}

function logsResponse(options: LogsServerOptions): ManagerLogsResponse {
  const captured = options.entries ?? entries
  return {
    entries: captured,
    instanceId: 'instance-1',
    latestSeq: captured.at(-1)?.seq ?? 0,
    oldestSeq: captured[0]?.seq ?? 0,
    dropped: options.dropped ?? 0,
    capacity: 1000,
  }
}

async function renderLogs(options: LogsServerOptions = {}) {
  const fetchRoutes: FetchRoute[] = [
    { method: 'GET', path: '/api/logs', respond: () => ({ json: logsResponse(options) }) },
    {
      method: 'GET',
      path: '/api/health',
      respond: () => ({ json: makeHealthResponse(options.health) }),
    },
  ]
  const result = renderWithProviders(<LogsViewer />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
  await screen.findByLabelText('Log level filter')
  return result
}

describe('LogsViewer', () => {
  it('does not render a server issue panel while OpenCode is healthy', async () => {
    await renderLogs({ health: { opencode: 'healthy', status: 'healthy' } })

    expect(await screen.findByText('Server started on port 5003')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the startup failure, attempted recovery and an errors-only shortcut', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderLogs({
      health: {
        opencode: 'unhealthy',
        status: 'unhealthy',
        opencodeLifecycle: {
          state: 'failed',
          healthy: false,
          port: 5551,
          version: null,
          minVersion: '2.0.15',
          versionSupported: false,
          lastError: 'OpenCode server exited with code 1: invalid config',
          activeRecoveryAction: null,
          attemptedRecoveryActions: ['restart', 'rollback_last_known_good'],
          nextRecoveryAction: null,
          failureCount: 3,
          watching: true,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('OpenCode server failed')
    expect(alert).toHaveTextContent('OpenCode server exited with code 1: invalid config')
    expect(alert).toHaveTextContent('Recovery attempted: restart, rollback last known good')

    await user.click(screen.getByRole('button', { name: 'Show errors only' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('GET', '/api/logs')?.searchParams.get('level')).toBe('error'),
    )
    expect(screen.queryByRole('button', { name: 'Show errors only' })).not.toBeInTheDocument()
  })

  it('renders entries with their message, level and source', async () => {
    await renderLogs()

    expect(await screen.findByText('Server started on port 5003')).toBeInTheDocument()
    expect(screen.getByText('Connection refused while dialing upstream')).toBeInTheDocument()
    expect(screen.getAllByText(/^(info|error)$/i)).toHaveLength(2)
    expect(screen.getByText('Manager')).toBeInTheDocument()
    expect(screen.getByText('OpenCode server')).toBeInTheDocument()
  })

  it('hides rows that do not match the search text', async () => {
    const user = userEvent.setup()
    await renderLogs()
    await screen.findByText('Server started on port 5003')

    await user.type(screen.getByLabelText('Search log messages'), 'refused')

    expect(screen.queryByText('Server started on port 5003')).not.toBeInTheDocument()
    expect(screen.getByText('Connection refused while dialing upstream')).toBeInTheDocument()
  })

  it('pauses live capture and switches the button to Resume', async () => {
    const user = userEvent.setup()
    await renderLogs()
    await screen.findByText('Server started on port 5003')

    await user.click(screen.getByRole('button', { name: /pause/i }))

    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
    expect(screen.getByText('Connection refused while dialing upstream')).toBeInTheDocument()
  })

  it('clears the displayed entries', async () => {
    const user = userEvent.setup()
    await renderLogs()
    await screen.findByText('Server started on port 5003')

    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(screen.getByText('No log entries captured yet.')).toBeInTheDocument()
    expect(screen.queryByText('Server started on port 5003')).not.toBeInTheDocument()
  })

  it('renders the empty-state copy when no entries are captured', async () => {
    await renderLogs({ entries: [] })

    expect(await screen.findByText('No log entries captured yet.')).toBeInTheDocument()
  })

  it('renders the dropped-entries note when entries were dropped', async () => {
    await renderLogs({ dropped: 3 })

    expect(await screen.findByText(/3 earlier entries dropped \(buffer holds \d+\)/)).toBeInTheDocument()
  })
})
