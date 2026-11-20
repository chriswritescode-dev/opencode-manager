import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JsonObject } from '@opencode-manager/shared/utils'
import { createFetchFake, type FetchFake, type FetchRoute } from '@/test/fetchFake'
import {
  SESSION_USAGE_MAX_PAGES,
  SESSION_USAGE_PAGE_LIMIT,
  getSessionStats,
  loadSessionUsageMessages,
} from './usage'

const localStatsUrl = '/api/opencode/api/experimental/session/stats'

const remoteStatsUrl = '/api/opencode/servers/srv_kitchen/api/experimental/session/stats'

const messagesUrl = '/api/opencode/api/session/ses_1/message'

const statsQuery = 'from=1700000000000&to=1700086400000&timezone=UTC&tools=detail'

const statsInput = { from: 1700000000000, to: 1700086400000, timezone: 'UTC', tools: 'detail' as const }

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

function fullPage(page: number): ReturnType<typeof assistantMessage>[] {
  return Array.from({ length: SESSION_USAGE_PAGE_LIMIT }, (_, index) =>
    assistantMessage(`msg_${page}_${index}`, page * 10_000 + index),
  )
}

function userMessage(id: string, created: number) {
  return { id, type: 'user', time: { created }, payload: { text: 'Run the tests' } }
}

function shellMessage(id: string, created: number) {
  return { id, type: 'shell', time: { created }, command: 'ls' }
}

function installRoutes(routes: FetchRoute[]): FetchFake {
  const fetchFake = createFetchFake(routes)
  fetchFake.install()
  return fetchFake
}

function respondTo(method: FetchRoute['method'], path: string, json: JsonObject): FetchRoute {
  return { method, path, respond: () => ({ json }) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usage api', () => {
  it('caps session usage paging at 200 messages per page and five pages', () => {
    expect(SESSION_USAGE_PAGE_LIMIT).toBe(200)
    expect(SESSION_USAGE_MAX_PAGES).toBe(5)
  })

  it('requests local session stats with the range, timezone, and tool detail', async () => {
    const stats = { sessions: 3, steps: 40, cost: 12 }
    const fetchFake = installRoutes([respondTo('GET', localStatsUrl, { data: stats })])

    const result = await getSessionStats(statsInput)

    expect(fetchFake.lastRequest('GET', localStatsUrl)?.searchParams.toString()).toBe(statsQuery)
    expect(result).toEqual(stats)
  })

  it('requests session stats from a remote server route', async () => {
    const stats = { sessions: 1, steps: 9, cost: 2 }
    const fetchFake = installRoutes([respondTo('GET', remoteStatsUrl, { data: stats })])

    const result = await getSessionStats(statsInput, 'srv_kitchen')

    expect(fetchFake.lastRequest('GET', remoteStatsUrl)?.searchParams.toString()).toBe(statsQuery)
    expect(fetchFake.findRequests('GET', localStatsUrl)).toHaveLength(0)
    expect(result).toEqual(stats)
  })

  it('pages through assistant messages with a descending first page and cursor continuations', async () => {
    const fetchFake = installRoutes([
      {
        method: 'GET',
        path: messagesUrl,
        respond: (request) =>
          request.searchParams.get('cursor') === 'cursor_1'
            ? { json: { data: [assistantMessage('msg_1', 1000)], cursor: {} } }
            : { json: { data: fullPage(2), cursor: { next: 'cursor_1' } } },
      },
    ])

    await loadSessionUsageMessages('ses_1')

    expect(fetchFake.findRequests('GET', messagesUrl).map((request) => request.searchParams.toString())).toEqual([
      'limit=200&order=desc&type=assistant',
      'limit=200&cursor=cursor_1&type=assistant',
    ])
  })

  it('stops after a short page even when the server still returns a cursor', async () => {
    const fetchFake = installRoutes([
      {
        method: 'GET',
        path: messagesUrl,
        respond: () => ({
          json: {
            data: [assistantMessage('msg_2', 2000), assistantMessage('msg_1', 1000)],
            cursor: { next: 'cursor_1' },
          },
        }),
      },
    ])

    const result = await loadSessionUsageMessages('ses_1')

    expect(result.steps.map((step) => step.id)).toEqual(['msg_1', 'msg_2'])
    expect(result.truncated).toBe(false)
    expect(fetchFake.findRequests('GET', messagesUrl).map((request) => request.searchParams.toString())).toEqual([
      'limit=200&order=desc&type=assistant',
    ])
  })

  it('keeps only assistant steps and joins pages oldest-first', async () => {
    const olderShells = Array.from({ length: SESSION_USAGE_PAGE_LIMIT - 3 }, (_, index) =>
      shellMessage(`msg_shell_${index}`, 100 + index),
    )
    const fetchFake = installRoutes([
      {
        method: 'GET',
        path: messagesUrl,
        respond: (request) =>
          request.searchParams.get('cursor') === 'cursor_1'
            ? {
                json: {
                  data: [shellMessage('msg_2', 2000), assistantMessage('msg_1', 1000)],
                  cursor: {},
                },
              }
            : {
                json: {
                  data: [
                    assistantMessage('msg_5', 5000),
                    userMessage('msg_4', 4000),
                    assistantMessage('msg_3', 3000),
                    ...olderShells,
                  ],
                  cursor: { next: 'cursor_1' },
                },
              },
      },
    ])

    const result = await loadSessionUsageMessages('ses_1')

    expect(result.steps.map((step) => step.id)).toEqual(['msg_1', 'msg_3', 'msg_5'])
    expect(result.truncated).toBe(false)
    expect(fetchFake.findRequests('GET', messagesUrl)).toHaveLength(2)
  })

  const truncationCases: Array<{ title: string; fifthPageLength: number; truncated: boolean }> = [
    {
      title: 'reports truncation when five full pages still leave a cursor',
      fifthPageLength: SESSION_USAGE_PAGE_LIMIT,
      truncated: true,
    },
    {
      title: 'reports no truncation when the fifth page is short',
      fifthPageLength: SESSION_USAGE_PAGE_LIMIT - 1,
      truncated: false,
    },
  ]

  it.each(truncationCases)('$title', async ({ fifthPageLength, truncated }) => {
    let page = 0
    const fetchFake = installRoutes([
      {
        method: 'GET',
        path: messagesUrl,
        respond: () => {
          page += 1
          const current = page
          const messages =
            current < SESSION_USAGE_MAX_PAGES
              ? fullPage(current)
              : fullPage(current).slice(0, fifthPageLength)
          return { json: { data: messages, cursor: { next: `cursor_${current}` } } }
        },
      },
    ])

    const result = await loadSessionUsageMessages('ses_1')

    expect(fetchFake.findRequests('GET', messagesUrl)).toHaveLength(5)
    expect(result.steps).toHaveLength(
      (SESSION_USAGE_MAX_PAGES - 1) * SESSION_USAGE_PAGE_LIMIT + fifthPageLength,
    )
    expect(result.truncated).toBe(truncated)
  })
})
