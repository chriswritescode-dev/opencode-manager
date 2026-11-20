import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import type { SessionStatsInfo } from '@opencode-manager/shared/opencode'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { useUsageDialog } from '@/hooks/useUsageDialog'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import type { FetchRoute } from '@/test/fetchFake'
import { UsageDialog } from './UsageDialog'

const STATS_PATH = '/api/opencode/api/experimental/session/stats'

const statsFixture: SessionStatsInfo = {
  range: { from: 0, to: 1000 },
  sessions: 0,
  subagents: 0,
  prompts: 0,
  steps: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0,
  tools: { mode: 'none' },
  activeDays: 0,
  streak: 0,
  activity: [],
  models: [],
}

function dialogFetchRoutes(): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [] } }) },
    { method: 'GET', path: '/api/opencode-servers/status', respond: () => ({ json: { statuses: [] } }) },
    { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
    { method: 'GET', path: '/api/opencode/api/session', respond: () => ({ json: { data: [], cursor: {} } }) },
    { method: 'GET', path: STATS_PATH, respond: () => ({ json: { data: statsFixture } }) },
  ]
}

const providerOptions = { auth: false, theme: false, tts: false } as const

const fetchFallback = () => ({ json: { data: [], cursor: {} } })

function UsageHarness() {
  const { open, close } = useUsageDialog()
  const navigate = useNavigate()

  return (
    <div>
      <button onClick={() => open()}>Open usage</button>
      <button onClick={close}>Close usage</button>
      <button onClick={() => navigate(-1)}>Go back</button>
      <UsageDialog />
    </div>
  )
}

describe('UsageDialog', () => {
  it('stays closed and requests no stats by default', () => {
    const result = renderWithProviders(<UsageDialog />, {
      ...providerOptions,
      initialEntries: ['/'],
      fetchRoutes: dialogFetchRoutes(),
      fetchFallback,
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(result.fetchFake.findRequests('GET', STATS_PATH)).toHaveLength(0)
  })

  it('renders the dashboard for the open URL param', async () => {
    const result = renderWithProviders(<UsageDialog />, {
      ...providerOptions,
      initialEntries: ['/?usage=open'],
      fetchRoutes: dialogFetchRoutes(),
      fetchFallback,
    })

    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Range' })).toBeInTheDocument()
    await waitFor(() => expect(result.fetchFake.findRequests('GET', STATS_PATH)).toHaveLength(1))
  })

  it('closes through the close button and drops the usage param', async () => {
    const user = userEvent.setup()
    const capturedSearch = { current: '' }

    renderWithProviders(
      <>
        <LocationCatcher capturedSearch={capturedSearch} />
        <UsageDialog />
      </>,
      {
        ...providerOptions,
        initialEntries: ['/?usage=open'],
        fetchRoutes: dialogFetchRoutes(),
        fetchFallback,
      },
    )

    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(capturedSearch.current).not.toContain('usage'))
  })

  it('opens and closes through the hook while restoring the previous search', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const capturedSearch = { current: '' }
    const capturedPathname = { current: '' }

    renderWithProviders(
      <>
        <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
        <UsageHarness />
      </>,
      {
        ...providerOptions,
        initialEntries: ['/?keep=1'],
        fetchRoutes: dialogFetchRoutes(),
        fetchFallback,
      },
    )

    await user.click(screen.getByRole('button', { name: 'Open usage' }))
    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    await waitFor(() => expect(capturedSearch.current).toContain('usage=open'))

    await user.click(screen.getByRole('button', { name: 'Close usage', hidden: true }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(capturedSearch.current).toBe('?keep=1'))
    expect(capturedPathname.current).toBe('/')
  })

  it('closes when the browser goes back after opening', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const capturedSearch = { current: '' }

    renderWithProviders(
      <>
        <LocationCatcher capturedSearch={capturedSearch} />
        <UsageHarness />
      </>,
      {
        ...providerOptions,
        initialEntries: ['/?keep=1'],
        fetchRoutes: dialogFetchRoutes(),
        fetchFallback,
      },
    )

    await user.click(screen.getByRole('button', { name: 'Open usage' }))
    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go back', hidden: true }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(capturedSearch.current).toBe('?keep=1'))
  })

  it('requests stats from the selected linked server only', async () => {
    const serverId = 'srv_kitchen'
    const linkedStatsPath = `/api/opencode/servers/${serverId}/api/experimental/session/stats`
    const linkedSessionsPath = `/api/opencode/servers/${serverId}/api/session`

    useSidebarServerStore.getState().selectServer(serverId)

    const result = renderWithProviders(<UsageDialog />, {
      ...providerOptions,
      initialEntries: ['/?usage=open'],
      fetchRoutes: [
        ...dialogFetchRoutes(),
        { method: 'GET', path: linkedStatsPath, respond: () => ({ json: { data: statsFixture } }) },
        { method: 'GET', path: linkedSessionsPath, respond: () => ({ json: { data: [], cursor: {} } }) },
      ],
      fetchFallback,
    })

    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument()

    await waitFor(() => expect(result.fetchFake.findRequests('GET', linkedStatsPath)).toHaveLength(1))
    expect(result.fetchFake.findRequests('GET', STATS_PATH)).toHaveLength(0)
  })
})
