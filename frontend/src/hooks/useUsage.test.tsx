import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { SessionStatsInfo } from '@opencode-manager/shared/opencode'
import {
  sessionUsageQueryKey,
  usageStatsQueryKey,
  useSessionUsage,
  useSessionUsageQueries,
  useUsageStats,
} from './useUsage'
import { renderHookWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

const statsPath = '/api/opencode/api/experimental/session/stats'

const remoteStatsPath = '/api/opencode/servers/srv_kitchen/api/experimental/session/stats'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const stats: SessionStatsInfo = {
  range: { from: 1, to: 2 },
  sessions: 2,
  subagents: 0,
  prompts: 3,
  steps: 4,
  tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0.25,
  tools: {
    mode: 'detail',
    totals: { calls: 1, succeeded: 1, failed: 0, unfinished: 0 },
    usage: [],
  },
  activeDays: 1,
  streak: 1,
  activity: [],
  models: [],
}

function assistantMessage(id: string, created: number) {
  return {
    id,
    type: 'assistant' as const,
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude' },
    time: { created },
    content: [],
  }
}

function userMessage(id: string, created: number) {
  return { id, type: 'user', time: { created }, text: 'Run the tests' }
}

function statsRoute(path: string = statsPath): FetchRoute {
  return { method: 'GET', path, respond: () => ({ json: { data: stats } }) }
}

function messagesRoute(sessionID: string, messages: object[]): FetchRoute {
  return {
    method: 'GET',
    path: `/api/opencode/api/session/${sessionID}/message`,
    respond: () => ({ json: { data: messages, cursor: {} } }),
  }
}

describe('usage query keys', () => {
  it('scopes the stats key by selection, timezone, and server', () => {
    expect(usageStatsQueryKey({ preset: '4h' }, 'Europe/Berlin', LOCAL_OPENCODE_SERVER_ID)).toEqual([
      'opencode',
      'usage',
      'stats',
      { preset: '4h' },
      'Europe/Berlin',
    ])
    expect(usageStatsQueryKey({ preset: '4h' }, 'Europe/Berlin', 'srv_kitchen')).toEqual([
      'opencode',
      'usage',
      'stats',
      { preset: '4h' },
      'Europe/Berlin',
      'srv_kitchen',
    ])
  })

  it('scopes the session usage key by server', () => {
    expect(sessionUsageQueryKey('ses_1', LOCAL_OPENCODE_SERVER_ID)).toEqual([
      'opencode',
      'session-usage',
      'ses_1',
    ])
    expect(sessionUsageQueryKey('ses_1', 'srv_kitchen')).toEqual([
      'opencode',
      'session-usage',
      'ses_1',
      'srv_kitchen',
    ])
  })
})

describe('useUsageStats', () => {
  it('requests the 4h stats range for the browser timezone', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useUsageStats({ preset: '4h' }, LOCAL_OPENCODE_SERVER_ID),
      { ...hookProviders, fetchRoutes: [statsRoute()] },
    )

    await waitFor(() => expect(result.current.data).toEqual(stats))

    const requests = fetchFake.findRequests('GET', statsPath)
    expect(requests).toHaveLength(1)
    const request = fetchFake.lastRequest('GET', statsPath)
    expect(request?.searchParams.get('tools')).toBe('detail')
    expect(request?.searchParams.get('timezone')).toBe(timezone)
    expect(Number(request?.searchParams.get('to')) - Number(request?.searchParams.get('from'))).toBe(
      14_400_000,
    )
  })

  it('stays idle without requesting stats for an incomplete custom range', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useUsageStats({ preset: 'custom', from: 1000, to: null }, LOCAL_OPENCODE_SERVER_ID),
      { ...hookProviders, fetchRoutes: [statsRoute()] },
    )

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchFake.findRequests('GET', statsPath)).toHaveLength(0)
    expect(result.current.isError).toBe(false)
  })

  it('requests stats from the linked server route', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useUsageStats({ preset: '1h' }, 'srv_kitchen'),
      { ...hookProviders, fetchRoutes: [statsRoute(remoteStatsPath)] },
    )

    await waitFor(() => expect(result.current.data).toEqual(stats))

    expect(fetchFake.findRequests('GET', remoteStatsPath)).toHaveLength(1)
    expect(fetchFake.findRequests('GET', statsPath)).toHaveLength(0)
  })
})

describe('useSessionUsage', () => {
  it('does not request messages without a session id', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionUsage(undefined, LOCAL_OPENCODE_SERVER_ID),
      { ...hookProviders, fetchRoutes: [messagesRoute('ses_1', [])] },
    )

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))

    expect(fetchFake.findRequests('GET', '/api/opencode/api/session/ses_1/message')).toHaveLength(0)
  })

  it('loads assistant steps for a session', async () => {
    const assistant = assistantMessage('msg_1', 1000)
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionUsage('ses_1', LOCAL_OPENCODE_SERVER_ID),
      { ...hookProviders, fetchRoutes: [messagesRoute('ses_1', [userMessage('msg_2', 2000), assistant])] },
    )

    await waitFor(() => expect(result.current.data).toEqual({ steps: [assistant], truncated: false }))

    const request = fetchFake.lastRequest('GET', '/api/opencode/api/session/ses_1/message')
    expect(request?.searchParams.toString()).toBe('limit=200&order=desc&type=assistant')
  })
})

describe('useSessionUsageQueries', () => {
  it('loads usage for every requested session', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionUsageQueries(['ses_1', 'ses_2'], LOCAL_OPENCODE_SERVER_ID),
      {
        ...hookProviders,
        fetchRoutes: [
          messagesRoute('ses_1', [assistantMessage('msg_1', 1000)]),
          messagesRoute('ses_2', [assistantMessage('msg_2', 2000)]),
        ],
      },
    )

    await waitFor(() =>
      expect(result.current.map((query) => query.data?.steps.map((step) => step.id))).toEqual([
        ['msg_1'],
        ['msg_2'],
      ]),
    )

    expect(fetchFake.findRequests('GET', '/api/opencode/api/session/ses_1/message')).toHaveLength(1)
    expect(fetchFake.findRequests('GET', '/api/opencode/api/session/ses_2/message')).toHaveLength(1)
  })
})
