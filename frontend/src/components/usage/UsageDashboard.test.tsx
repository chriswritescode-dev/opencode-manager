import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionStatsInfo } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import { UsageDashboard } from './UsageDashboard'

const providerOptions = { auth: false, theme: false, tts: false } as const

const statsPath = '/api/opencode/api/experimental/session/stats'

const statsFixture: SessionStatsInfo = {
  range: {
    from: new Date('2026-01-01T00:00:00').getTime(),
    to: new Date('2026-01-01T04:00:00').getTime(),
  },
  sessions: 3,
  subagents: 0,
  prompts: 9,
  steps: 12,
  tokens: { input: 1500, output: 500, reasoning: 0, cache: { read: 200, write: 0 } },
  cost: 1,
  tools: {
    mode: 'detail',
    totals: { calls: 2, succeeded: 1, failed: 1, unfinished: 0 },
    usage: [
      { name: 'bash', calls: 2, succeeded: 1, failed: 1, unfinished: 0, durationP50: 120 },
    ],
  },
  activeDays: 2,
  streak: 1,
  activity: [{ date: '2026-01-01', steps: 12 }],
  models: [
    {
      model: { providerID: 'anthropic', id: 'claude' },
      steps: 10,
      tokens: { input: 1000, output: 400, reasoning: 0, cache: { read: 200, write: 0 } },
      cost: 0.75,
    },
    {
      model: { providerID: 'openai', id: 'gpt-4o' },
      steps: 2,
      tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.25,
    },
  ],
}

const hiddenSectionsNote =
  'Prompts, streak, activity, tool reliability and sessions cannot be split per model, so they are hidden while a model filter is active.'

function statsRoute(path: string = statsPath): FetchRoute {
  return { method: 'GET', path, respond: () => ({ json: { data: statsFixture } }) }
}

function localSessionsRoute(): FetchRoute {
  return {
    method: 'GET',
    path: '/api/opencode/api/session',
    respond: () => ({
      json: {
        data: [
          makeSession({
            id: 'ses_1',
            title: 'Fix tests',
            location: { directory: '/workspace/demo' },
            cost: 0.4,
            tokens: {
              input: 100,
              output: 50,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: 1, updated: 2 },
          }),
        ],
        cursor: {},
      },
    }),
  }
}

function remoteSessionsRoute(serverId: string): FetchRoute {
  return {
    method: 'GET',
    path: `/api/opencode/servers/${serverId}/api/session`,
    respond: () => ({
      json: {
        data: [
          makeSession({
            id: 'ses_remote',
            title: 'Remote session',
            cost: 1,
            time: { created: 1, updated: 2 },
          }),
        ],
        cursor: {},
      },
    }),
  }
}

function reposRoute(): FetchRoute {
  return {
    method: 'GET',
    path: '/api/repos',
    respond: () => ({ json: [makeRepo({ id: 1, fullPath: '/workspace/demo' })] }),
  }
}

function sessionMessageFallback() {
  return { json: { data: [], cursor: {} } }
}

function statText(label: string): string {
  const grid = screen.getByText('Spend').parentElement?.parentElement
  if (!grid) throw new Error('Summary grid not found')
  const labelNode = within(grid).getByText(label)
  return labelNode.parentElement?.textContent ?? ''
}

function freezeNow(): void {
  vi.spyOn(Date, 'now').mockReturnValue(2_000)
}

async function openModelMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Filter by model' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeAll(() => {
  installPointerCapture()
})

describe('UsageDashboard', () => {
  it('renders the default 4h summary, composition, models, tools, sessions, and range without a chart', async () => {
    freezeNow()

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Last 4 hours')

    await screen.findByText('Fix tests')

    expect(
      screen.getByText('Jan 1, 2026 00:00 – Jan 1, 2026 04:00'),
    ).toBeInTheDocument()
    expect(statText('Spend')).toContain('$1.00')
    expect(statText('Tokens')).toContain('2k')
    expect(statText('Steps')).toContain('12')
    expect(statText('Prompts')).toContain('9')
    expect(statText('Active days')).toContain('2')
    expect(statText('Streak')).toContain('1')

    expect(screen.getByRole('heading', { name: 'Token composition' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByText('anthropic/claude')).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('75.0%')).toBeInTheDocument()
    expect(screen.getByText('25.0%')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Sessions by spend' })).toBeInTheDocument()
    expect(screen.getByText('Fix tests')).toBeInTheDocument()

    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument()
  })

  it('shows the activity chart for a whole-day range', async () => {
    window.localStorage.setItem('oc:usage:range', JSON.stringify({ preset: '7d' }))

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Last 7 days')

    expect(
      await screen.findByRole('img', { name: '2026-01-01: 12 steps' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
  })

  it('persists a changed range and restores it on the next open', async () => {
    const user = userEvent.setup()

    const first = renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    await screen.findByRole('heading', { name: 'Sessions by spend' })

    await user.click(screen.getByRole('combobox', { name: 'Range' }))
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }))

    expect(JSON.parse(window.localStorage.getItem('oc:usage:range') ?? 'null')).toEqual({
      preset: '7d',
    })

    first.unmount()

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Last 7 days')
  })

  it('filters summaries and models to a single selected model and hides unsplittable sections', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    await screen.findByRole('heading', { name: 'Sessions by spend' })

    await openModelMenu(user)
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'anthropic/claude' }))

    expect(statText('Spend')).toContain('$0.7500')
    expect(statText('Tokens')).toContain('2k')
    expect(statText('Steps')).toContain('10')

    expect(screen.getByText(hiddenSectionsNote)).toBeInTheDocument()

    expect(screen.queryByText('Prompts')).not.toBeInTheDocument()
    expect(screen.queryByText('Active days')).not.toBeInTheDocument()
    expect(screen.queryByText('Streak')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sessions by spend')).not.toBeInTheDocument()

    expect(screen.queryByText('openai/gpt-4o')).not.toBeInTheDocument()
    expect(screen.getAllByText('anthropic/claude').length).toBeGreaterThan(0)
  })

  it('shows the remaining count when two models are selected', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    await screen.findByRole('heading', { name: 'Sessions by spend' })

    await openModelMenu(user)
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'anthropic/claude' }))
    await openModelMenu(user)
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'openai/gpt-4o' }))

    expect(screen.getByRole('button', { name: 'Filter by model' })).toHaveTextContent('+1 more')
  })

  it('resets filters back to all models and the default range', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    await screen.findByRole('heading', { name: 'Sessions by spend' })

    await openModelMenu(user)
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'anthropic/claude' }))
    await openModelMenu(user)
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'openai/gpt-4o' }))

    await user.click(screen.getByRole('button', { name: 'Reset filters' }))

    expect(screen.getByRole('button', { name: 'Filter by model' })).toHaveTextContent('All models')
    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Last 4 hours')
    expect(statText('Prompts')).toContain('9')
    expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument()
    expect(screen.queryByText(hiddenSectionsNote)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('oc:usage:models')).toBe('[]')
  })

  it('prunes stored models that are missing from the loaded stats', async () => {
    window.localStorage.setItem(
      'oc:usage:models',
      JSON.stringify(['anthropic/claude', 'ghost/model']),
    )

    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('oc:usage:models') ?? '[]')).toEqual([
        'anthropic/claude',
      ]),
    )
  })

  it('renders an error banner when the stats request fails', async () => {
    renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [
        {
          method: 'GET',
          path: statsPath,
          respond: () => ({ status: 500, json: { error: 'boom' } }),
        },
      ],
      fetchFallback: sessionMessageFallback,
    })

    expect(await screen.findByText('Usage unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('This OpenCode server could not return usage statistics.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Last 4 hours')
  })

  it('loads a linked server and links its sessions to the server route', async () => {
    freezeNow()
    const serverId = 'srv_kitchen'
    const remoteStatsPath = `/api/opencode/servers/${serverId}/api/experimental/session/stats`

    const result = renderWithProviders(<UsageDashboard serverId={serverId} />, {
      ...providerOptions,
      fetchRoutes: [
        statsRoute(remoteStatsPath),
        remoteSessionsRoute(serverId),
      ],
      fetchFallback: sessionMessageFallback,
    })

    const link = await screen.findByRole('link', { name: 'Remote session' })
    expect(link).toHaveAttribute('href', '/servers/srv_kitchen/sessions/ses_remote')

    expect(result.fetchFake.findRequests('GET', remoteStatsPath)).toHaveLength(1)
    expect(screen.getAllByText('Spend').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tokens').length).toBeGreaterThan(0)
    expect(result.fetchFake.findRequests('GET', '/api/repos')).toHaveLength(0)
  })

  it('asks for a custom range instead of loading stats when the range is incomplete', async () => {
    window.localStorage.setItem(
      'oc:usage:range',
      JSON.stringify({ preset: 'custom', from: null, to: null }),
    )

    const result = renderWithProviders(<UsageDashboard serverId={LOCAL_OPENCODE_SERVER_ID} />, {
      ...providerOptions,
      fetchRoutes: [statsRoute(), localSessionsRoute(), reposRoute()],
      fetchFallback: sessionMessageFallback,
    })

    expect(
      screen.getByText('Choose a start and end time to see usage for a custom range.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Loading usage…')).not.toBeInTheDocument()
    expect(result.fetchFake.findRequests('GET', statsPath)).toHaveLength(0)
  })
})
