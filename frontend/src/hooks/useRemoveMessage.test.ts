import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRefreshMessage } from './useRemoveMessage'
import { renderHookWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const sessionKey = ['opencode', 'session', 'test-session', '/test'] as const

const sessionRoutes: FetchRoute[] = [
  {
    method: 'POST',
    path: '/api/opencode/api/session/test-session/interrupt',
    respond: () => ({ json: { data: {} } }),
  },
  {
    method: 'POST',
    path: '/api/opencode/api/experimental/session/test-session/wait',
    respond: () => ({ status: 204 }),
  },
  {
    method: 'POST',
    path: '/api/opencode/api/session/test-session/revert/stage',
    respond: () => ({ json: { data: {} } }),
  },
  {
    method: 'POST',
    path: '/api/opencode/api/session/test-session/revert/commit',
    respond: () => ({ status: 204 }),
  },
  {
    method: 'POST',
    path: '/api/opencode/api/session/test-session/model',
    respond: () => ({ status: 204 }),
  },
  {
    method: 'POST',
    path: '/api/opencode/api/session/test-session/agent',
    respond: () => ({ status: 204 }),
  },
  {
    method: 'POST',
    path: '/api/opencode/api/session/test-session/prompt',
    respond: () => ({
      json: {
        data: {
          id: 'inbox_1',
          sessionID: 'test-session',
          time: { created: 1 },
          type: 'user',
          payload: { text: 'edited text' },
          delivery: 'queue',
        },
      },
    }),
  },
]

function renderRefresh(model: { providerID: string; id: string; variant?: string } = {
  providerID: 'anthropic',
  id: 'claude-sonnet-4',
}) {
  const rendered = renderHookWithProviders(() => useRefreshMessage({ sessionId: 'test-session', directory: '/test' }), {
    ...hookProviders,
    fetchRoutes: sessionRoutes,
  })
  rendered.queryClient.setQueryData(
    sessionKey,
    makeSession({ id: 'test-session', agent: 'build', model, location: { directory: '/test' } }),
  )
  return rendered
}

function requestPaths(fetchFake: ReturnType<typeof renderRefresh>['fetchFake']) {
  return fetchFake.requests.map((request) => `${request.method} ${request.path}`)
}

describe('useRefreshMessage', () => {
  it('resends the edited text without synthesizing an agent attachment or unchanged switches', async () => {
    const { result, fetchFake } = renderRefresh()

    await act(async () => {
      await result.current.mutateAsync({
        assistantMessageID: 'assistant-1',
        userMessageContent: 'edited text',
        model: 'anthropic/claude-sonnet-4',
        agent: 'build',
      })
    })

    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/revert/stage')?.body).toEqual({
      messageID: 'assistant-1',
    })
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/model')).toHaveLength(0)
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/agent')).toHaveLength(0)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toEqual({
      text: 'edited text',
      metadata: { ocmClient: 'desktop' },
    })
    expect(requestPaths(fetchFake)).toEqual([
      'POST /api/opencode/api/session/test-session/interrupt',
      'POST /api/opencode/api/experimental/session/test-session/wait',
      'POST /api/opencode/api/session/test-session/revert/stage',
      'POST /api/opencode/api/session/test-session/revert/commit',
      'POST /api/opencode/api/session/test-session/prompt',
    ])
  })

  it('preserves the session variant when resending with the same full ref', async () => {
    const { result, fetchFake } = renderRefresh({ providerID: 'anthropic', id: 'claude-sonnet-4', variant: 'high' })

    await act(async () => {
      await result.current.mutateAsync({
        assistantMessageID: 'assistant-1',
        userMessageContent: 'edited text',
        model: 'anthropic/claude-sonnet-4#high',
        agent: 'build',
      })
    })

    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/model')).toHaveLength(0)
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/agent')).toHaveLength(0)
  })

  it('switches the model before resending when the edited message model changed', async () => {
    const { result, fetchFake } = renderRefresh()

    await act(async () => {
      await result.current.mutateAsync({
        assistantMessageID: 'assistant-1',
        userMessageContent: 'edited text',
        model: 'openai/gpt-4',
        agent: 'build',
      })
    })

    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/model')?.body).toEqual({
      model: { providerID: 'openai', id: 'gpt-4' },
    })
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/agent')).toHaveLength(0)

    const paths = requestPaths(fetchFake)
    expect(paths.indexOf('POST /api/opencode/api/session/test-session/model')).toBeLessThan(
      paths.indexOf('POST /api/opencode/api/session/test-session/prompt'),
    )
  })

  it('switches the agent before resending when the selected agent changed', async () => {
    const { result, fetchFake } = renderRefresh()

    await act(async () => {
      await result.current.mutateAsync({
        assistantMessageID: 'assistant-1',
        userMessageContent: 'edited text',
        model: 'anthropic/claude-sonnet-4',
        agent: 'plan',
      })
    })

    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/agent')?.body).toEqual({
      agent: 'plan',
    })
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/model')?.body).toEqual({
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    })

    const paths = requestPaths(fetchFake)
    expect(paths.indexOf('POST /api/opencode/api/session/test-session/agent')).toBeLessThan(
      paths.indexOf('POST /api/opencode/api/session/test-session/model'),
    )
    expect(paths.indexOf('POST /api/opencode/api/session/test-session/model')).toBeLessThan(
      paths.indexOf('POST /api/opencode/api/session/test-session/prompt'),
    )
  })
})
