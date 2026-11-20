import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { renderWithProviders, type TestProviderOptions } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import { UsageSessionsTable } from './UsageSessionsTable'

const localOptions = {
  auth: false,
  theme: false,
  tts: false,
  initialEntries: ['/?usage=open'],
} satisfies Omit<TestProviderOptions, 'fetchRoutes'>

const zeroTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const spentTokens = { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } }

function assistantStep(id: string) {
  return {
    id,
    type: 'assistant' as const,
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude' },
    time: { created: 1000, streamed: 2000 },
    content: [],
    cost: 0.1,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function reposRoute(): FetchRoute {
  return {
    method: 'GET',
    path: '/api/repos',
    respond: () => ({ json: [makeRepo({ id: 1, fullPath: '/workspace/demo' })] }),
  }
}

function sessionsRoute(sessions: SessionInfo[], serverId = LOCAL_OPENCODE_SERVER_ID): FetchRoute {
  const path =
    serverId === LOCAL_OPENCODE_SERVER_ID
      ? '/api/opencode/api/session'
      : `/api/opencode/servers/${serverId}/api/session`
  return {
    method: 'GET',
    path,
    respond: () => ({ json: { data: sessions, cursor: {} } }),
  }
}

function messagesRoute(serverId = LOCAL_OPENCODE_SERVER_ID): FetchRoute {
  const path =
    serverId === LOCAL_OPENCODE_SERVER_ID
      ? '/api/opencode/api/session/:sessionID/message'
      : `/api/opencode/servers/${serverId}/api/session/:sessionID/message`
  return {
    method: 'GET',
    path,
    respond: (_request, params) => ({
      json: { data: [assistantStep(`msg_${params.sessionID}`)], cursor: {} },
    }),
  }
}

function rowTitles(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
}

function cellsFor(title: string): HTMLElement[] {
  const row = screen.getByText(title).closest('tr')
  if (!row) throw new Error(`No row for ${title}`)
  return within(row).getAllByRole('cell')
}

describe('UsageSessionsTable', () => {
  it('renders only sessions with spend or tokens, sorted by cost descending', async () => {
    const sessions = [
      makeSession({
        id: 'ses_low',
        title: 'Low spend',
        cost: 0.1,
        tokens: spentTokens,
        time: { created: 1000, updated: 2000 },
      }),
      makeSession({
        id: 'ses_high',
        title: 'High spend',
        cost: 0.9,
        tokens: spentTokens,
        time: { created: 1000, updated: 3000 },
      }),
      makeSession({
        id: 'ses_mid',
        title: 'Mid spend',
        cost: 0.5,
        tokens: zeroTokens,
        time: { created: 1000, updated: 4000 },
      }),
      makeSession({
        id: 'ses_free',
        title: 'Free session',
        cost: 0,
        tokens: zeroTokens,
        time: { created: 1000, updated: 5000 },
      }),
    ]

    renderWithProviders(<UsageSessionsTable serverId={LOCAL_OPENCODE_SERVER_ID} range={{ from: 0 }} />, {
      ...localOptions,
      fetchRoutes: [reposRoute(), sessionsRoute(sessions), messagesRoute()],
    })

    await screen.findByText('High spend')

    expect(rowTitles()).toEqual(['High spend', 'Mid spend', 'Low spend'])
    expect(screen.queryByText('Free session')).not.toBeInTheDocument()
  })

  it('renders step counts and average token throughput per session', async () => {
    const sessions = [
      makeSession({
        id: 'ses_demo',
        title: 'Demo session',
        cost: 0.4,
        tokens: spentTokens,
        time: { created: 1000, updated: 2000 },
      }),
    ]

    renderWithProviders(<UsageSessionsTable serverId={LOCAL_OPENCODE_SERVER_ID} range={{ from: 0 }} />, {
      ...localOptions,
      fetchRoutes: [reposRoute(), sessionsRoute(sessions), messagesRoute()],
    })

    await screen.findByText('Demo session')

    await waitFor(() => expect(cellsFor('Demo session')[1]).toHaveTextContent('1'))
    expect(cellsFor('Demo session')[5]).toHaveTextContent('50.0 tok/s')
  })

  it('links local sessions to a matching repo and leaves unmatched directories as plain text', async () => {
    const sessions = [
      makeSession({
        id: 'ses_demo',
        title: 'Demo session',
        cost: 0.4,
        tokens: spentTokens,
        time: { created: 1000, updated: 2000 },
        location: { directory: '/workspace/demo' },
      }),
      makeSession({
        id: 'ses_orphan',
        title: 'Orphan session',
        cost: 0.2,
        tokens: spentTokens,
        time: { created: 1000, updated: 2000 },
        location: { directory: '/workspace/elsewhere' },
      }),
    ]

    renderWithProviders(<UsageSessionsTable serverId={LOCAL_OPENCODE_SERVER_ID} range={{ from: 0 }} />, {
      ...localOptions,
      fetchRoutes: [reposRoute(), sessionsRoute(sessions), messagesRoute()],
    })

    const link = await screen.findByRole('link', { name: 'Demo session' })
    expect(link).toHaveAttribute('href', '/repos/1/sessions/ses_demo')
    expect(link.getAttribute('href')).not.toContain('usage')

    expect(screen.getByText('Orphan session').closest('a')).toBeNull()
  })

  it('links sessions on a remote server without requesting repos', async () => {
    const serverId = 'srv_kitchen'
    const sessions = [
      makeSession({
        id: 'ses_remote',
        title: 'Remote session',
        cost: 0.4,
        tokens: spentTokens,
        time: { created: 1000, updated: 2000 },
      }),
    ]

    const result = renderWithProviders(
      <UsageSessionsTable serverId={serverId} range={{ from: 0 }} />,
      {
        ...localOptions,
        fetchRoutes: [sessionsRoute(sessions, serverId), messagesRoute(serverId)],
      },
    )

    const link = await screen.findByRole('link', { name: 'Remote session' })
    expect(link).toHaveAttribute('href', '/servers/srv_kitchen/sessions/ses_remote')
    expect(result.fetchFake.findRequests('GET', '/api/repos')).toHaveLength(0)
  })

  it('shows ten rows initially and reveals the eleventh with Show more', async () => {
    const sessions = Array.from({ length: 11 }, (_, index) =>
      makeSession({
        id: `ses_${index + 1}`,
        title: `Session ${index + 1}`,
        cost: Number(((11 - index) * 0.01).toFixed(2)),
        tokens: spentTokens,
        time: { created: 1000, updated: 2000 },
      }),
    )

    const user = userEvent.setup()

    renderWithProviders(<UsageSessionsTable serverId={LOCAL_OPENCODE_SERVER_ID} range={{ from: 0 }} />, {
      ...localOptions,
      fetchRoutes: [reposRoute(), sessionsRoute(sessions), messagesRoute()],
    })

    await screen.findByText('Session 1')

    expect(screen.getAllByRole('row')).toHaveLength(11)
    expect(screen.queryByText('Session 11')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(12))
    expect(screen.getByText('Session 11')).toBeInTheDocument()
  })

  it('excludes sessions outside the range and sessions without spend or tokens', async () => {
    const sessions = [
      makeSession({
        id: 'ses_valid',
        title: 'Valid session',
        cost: 0.2,
        tokens: spentTokens,
        time: { created: 1000, updated: 5000 },
      }),
      makeSession({
        id: 'ses_old',
        title: 'Out of range',
        cost: 0.8,
        tokens: spentTokens,
        time: { created: 100, updated: 100 },
      }),
      makeSession({
        id: 'ses_empty',
        title: 'Empty session',
        cost: 0,
        tokens: zeroTokens,
        time: { created: 1000, updated: 5000 },
      }),
    ]

    renderWithProviders(
      <UsageSessionsTable
        serverId={LOCAL_OPENCODE_SERVER_ID}
        range={{ from: 1000, to: 6000 }}
      />,
      {
        ...localOptions,
        fetchRoutes: [reposRoute(), sessionsRoute(sessions), messagesRoute()],
      },
    )

    await screen.findByText('Valid session')

    expect(rowTitles()).toEqual(['Valid session'])
    expect(screen.queryByText('Out of range')).not.toBeInTheDocument()
    expect(screen.queryByText('Empty session')).not.toBeInTheDocument()
  })
})
