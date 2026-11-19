import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSendPrompt } from './useOpenCode'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { emptySessionTranscript } from '@/lib/session-projection'
import type { TranscriptCache } from '@/lib/session-projection'
import type { SessionInboxUser } from '@opencode-manager/shared/opencode'
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

const claudeModel = { providerID: 'anthropic', id: 'claude-sonnet-4' }
const gptModel = { providerID: 'openai', id: 'gpt-4' }

function inboxItem(sessionID: string, text: string): SessionInboxUser {
  return {
    id: `inbox_${text}`,
    sessionID,
    time: { created: 1000 },
    type: 'user',
    payload: { text },
    delivery: 'queue',
  }
}

function promptRoute(respond: FetchRoute['respond']): FetchRoute {
  return { method: 'POST', path: '/api/opencode/api/session/:sessionID/prompt', respond }
}

function switchRoutes(respond: FetchRoute['respond'] = () => ({ status: 204 })): FetchRoute[] {
  return [
    { method: 'POST', path: '/api/opencode/api/session/:sessionID/agent', respond },
    { method: 'POST', path: '/api/opencode/api/session/:sessionID/model', respond },
  ]
}

function renderSendPrompt(extraRoutes: FetchRoute[] = []) {
  const rendered = renderHookWithProviders(() => useSendPrompt('/test'), {
    ...hookProviders,
    fetchRoutes: [
      ...extraRoutes,
      promptRoute(() => ({ json: { data: inboxItem('test-session', 'Hello') } })),
      ...switchRoutes(),
    ],
  })
  rendered.queryClient.setQueryData(
    sessionKey,
    makeSession({ id: 'test-session', agent: 'build', model: claudeModel, location: { directory: '/test' } }),
  )
  return rendered
}

function modelRequests(fetchFake: ReturnType<typeof renderSendPrompt>['fetchFake']) {
  return fetchFake.findRequests('POST', '/api/opencode/api/session/:sessionID/model')
}

function agentRequests(fetchFake: ReturnType<typeof renderSendPrompt>['fetchFake']) {
  return fetchFake.findRequests('POST', '/api/opencode/api/session/:sessionID/agent')
}

describe('useSendPrompt', () => {
  it('sends a V2 prompt without switching when the model and agent match the session', async () => {
    const { result, fetchFake } = renderSendPrompt()

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: claudeModel,
        agent: 'build',
      })
    })

    expect(modelRequests(fetchFake)).toHaveLength(0)
    expect(agentRequests(fetchFake)).toHaveLength(0)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toEqual({
      text: 'Hello',
      metadata: { ocmClient: 'desktop' },
    })
  })

  it('switches the model before prompting when the selection changed', async () => {
    const { result, fetchFake } = renderSendPrompt()

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: { ...gptModel, variant: 'v1' },
        agent: 'build',
      })
    })

    expect(modelRequests(fetchFake).map((request) => request.body)).toEqual([
      { model: { providerID: 'openai', id: 'gpt-4', variant: 'v1' } },
    ])
    expect(agentRequests(fetchFake)).toHaveLength(0)

    const paths = fetchFake.requests.map((request) => request.path)
    expect(paths.indexOf('/api/opencode/api/session/test-session/model')).toBeLessThan(
      paths.indexOf('/api/opencode/api/session/test-session/prompt'),
    )
  })

  it('switches the agent before prompting when the selection changed', async () => {
    const { result, fetchFake } = renderSendPrompt()

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: claudeModel,
        agent: 'plan',
      })
    })

    expect(agentRequests(fetchFake).map((request) => request.body)).toEqual([{ agent: 'plan' }])
    expect(modelRequests(fetchFake).map((request) => request.body)).toEqual([{ model: claudeModel }])

    const paths = fetchFake.requests.map((request) => request.path)
    expect(paths.indexOf('/api/opencode/api/session/test-session/agent')).toBeLessThan(
      paths.indexOf('/api/opencode/api/session/test-session/model'),
    )
  })

  it('switches the agent before the model when both changed', async () => {
    const { result, fetchFake } = renderSendPrompt()

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: gptModel,
        agent: 'plan',
      })
    })

    expect(agentRequests(fetchFake).map((request) => request.body)).toEqual([{ agent: 'plan' }])
    expect(modelRequests(fetchFake).map((request) => request.body)).toEqual([{ model: gptModel }])

    const paths = fetchFake.requests.map((request) => request.path)
    expect(paths.indexOf('/api/opencode/api/session/test-session/agent')).toBeLessThan(
      paths.indexOf('/api/opencode/api/session/test-session/model'),
    )
  })

  it('switches back to a previously cached model after an intermediate switch', async () => {
    const { result, fetchFake } = renderSendPrompt()

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'test-session', text: 'first', model: gptModel })
      await result.current.mutateAsync({ sessionID: 'test-session', text: 'second', model: claudeModel })
    })

    expect(modelRequests(fetchFake).map((request) => request.body)).toEqual([
      { model: gptModel },
      { model: claudeModel },
    ])
  })

  it('switches back to a previously cached agent after an intermediate switch', async () => {
    const { result, fetchFake } = renderSendPrompt()

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'test-session', text: 'first', agent: 'plan' })
      await result.current.mutateAsync({ sessionID: 'test-session', text: 'second', agent: 'build' })
    })

    expect(agentRequests(fetchFake).map((request) => request.body)).toEqual([
      { agent: 'plan' },
      { agent: 'build' },
    ])
  })

  it('keeps the cached selection when a switch fails', async () => {
    const failingSwitch: FetchRoute = {
      method: 'POST',
      path: '/api/opencode/api/session/test-session/model',
      respond: () => ({ status: 400, json: { message: 'switch failed' } }),
    }
    const { result, queryClient } = renderSendPrompt([failingSwitch])

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          sessionID: 'test-session',
          text: 'Hello',
          model: gptModel,
        }),
      ).rejects.toThrow('switch failed')
    })

    expect(queryClient.getQueryData(sessionKey)).toMatchObject({ model: claudeModel })
  })

  it('keeps a successful agent switch when the following model switch fails', async () => {
    const failingSwitch: FetchRoute = {
      method: 'POST',
      path: '/api/opencode/api/session/test-session/model',
      respond: () => ({ status: 400, json: { message: 'model switch failed' } }),
    }
    const { result, queryClient } = renderSendPrompt([failingSwitch])

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          sessionID: 'test-session',
          text: 'Hello',
          model: gptModel,
          agent: 'plan',
        }),
      ).rejects.toThrow('model switch failed')
    })

    expect(queryClient.getQueryData(sessionKey)).toMatchObject({ agent: 'plan', model: claudeModel })
  })

  it('does not switch the session model when the variant matches the durable selection', async () => {
    const { result, queryClient, fetchFake } = renderSendPrompt()
    queryClient.setQueryData(
      sessionKey,
      makeSession({
        id: 'test-session',
        agent: 'build',
        model: { ...claudeModel, variant: 'high' },
        location: { directory: '/test' },
      }),
    )

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: { ...claudeModel, variant: 'high' },
        agent: 'build',
      })
    })

    expect(modelRequests(fetchFake)).toHaveLength(0)
    expect(agentRequests(fetchFake)).toHaveLength(0)
  })

  it('adds the returned inbox item to the transcript pending state immediately', async () => {
    const transcriptKey = sessionTranscriptQueryKey('test-session')
    const { result, queryClient } = renderSendPrompt([
      promptRoute(() => ({ json: { data: inboxItem('test-session', 'queued prompt') } })),
    ])
    queryClient.setQueryData(transcriptKey, { transcript: emptySessionTranscript })

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'queued prompt',
        delivery: 'queue',
      })
    })

    const cached = queryClient.getQueryData<TranscriptCache>(transcriptKey)
    expect(cached?.transcript.pending.map((item) => item.id)).toEqual(['inbox_queued prompt'])
  })

  it('clears the stored send error on success', async () => {
    const { result } = renderSendPrompt()
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Network error',
      kind: 'network',
    })

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
      })
    })

    expect(useSendErrorStore.getState().getError('test-session')).toBeNull()
  })

  it('stores the failed prompt for restoration on network failure', async () => {
    const { result } = renderSendPrompt([
      promptRoute(() => {
        throw new TypeError('Failed to fetch')
      }),
    ])
    useSessionStatus.getState().setOptimisticActive('session-lost')

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          sessionID: 'session-lost',
          text: 'keep this prompt',
        }),
      ).rejects.toThrow('Failed to fetch')
    })

    expect(useSessionStatus.getState().getStatus('session-lost')).toEqual({ type: 'idle' })
    expect(useSendErrorStore.getState().getError('session-lost')).toMatchObject({
      sessionID: 'session-lost',
      failedPrompt: 'keep this prompt',
      kind: 'network',
    })
  })

  it('surfaces no error on gateway timeout (524)', async () => {
    const { result } = renderSendPrompt([
      promptRoute(() => ({ status: 524, json: { message: 'Gateway timeout' } })),
    ])
    useSessionStatus.getState().setOptimisticActive('session-524')

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          sessionID: 'session-524',
          text: 'long running prompt',
        }),
      ).rejects.toThrow()
    })

    expect(useSessionStatus.getState().getStatus('session-524')).toEqual({ type: 'busy' })
    expect(useSendErrorStore.getState().getError('session-524')).toBeNull()
  })

  it('does not refetch the event-driven transcript after a successful send', async () => {
    const transcriptKey = sessionTranscriptQueryKey('test-session')
    const { result, queryClient } = renderSendPrompt()
    queryClient.setQueryData(transcriptKey, { transcript: emptySessionTranscript })

    await act(async () => {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
      })
    })

    expect(queryClient.getQueryState(transcriptKey)?.isInvalidated).toBe(false)
  })
})
