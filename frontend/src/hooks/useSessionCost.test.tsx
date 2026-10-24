import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageCompaction,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { useSessionCost } from './useSessionCost'
import { emptySessionTranscript } from '@/lib/session-projection'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'

const SESSION_ID = 'session-1'
const REMOTE_SERVER_ID = 'srv_remote'

const model = { id: 'claude-sonnet', providerID: 'anthropic' }

function assistantMessage(
  id: string,
  tokens: SessionMessageAssistant['tokens'],
  cost = 0,
): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model,
    content: [],
    time: { created: 1 },
    tokens,
    cost,
  }
}

function compactionMessage(id: string): SessionMessageCompaction {
  return {
    id,
    type: 'compaction',
    status: 'completed',
    reason: 'auto',
    summary: '',
    recent: '',
    time: { created: 1 },
  }
}

function seedTranscript(
  queryClient: QueryClient,
  messages: SessionMessageInfo[],
  serverId = LOCAL_OPENCODE_SERVER_ID,
) {
  queryClient.setQueryData(serverScopedKey(sessionTranscriptQueryKey(SESSION_ID), serverId), {
    transcript: { ...emptySessionTranscript, messages },
  })
}

function createWrapper(queryClient: QueryClient, serverId = LOCAL_OPENCODE_SERVER_ID) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <OpenCodeServerProvider serverId={serverId}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </OpenCodeServerProvider>
    )
  }
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useSessionCost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sums cost and tokens across every assistant message', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }, 0.01),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 2,
        cache: { read: 100, write: 50 },
      }, 0.02),
    ])

    const { result } = renderHook(() => useSessionCost(SESSION_ID), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBeCloseTo(0.03)
    expect(result.current.totalTokens).toBe(1147)
    expect(result.current.messageCount).toBe(2)
    expect(result.current.isLoading).toBe(false)
  })

  it('keeps the token total for free sessions with zero cost', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
    ])

    const { result } = renderHook(() => useSessionCost(SESSION_ID), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBe(0)
    expect(result.current.totalTokens).toBe(1015)
    expect(result.current.messageCount).toBe(1)
  })

  it('does not reset the total at a compaction boundary', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }, 0.01),
      compactionMessage('compaction-1'),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 0,
        cache: { read: 100, write: 50 },
      }, 0.02),
    ])

    const { result } = renderHook(() => useSessionCost(SESSION_ID), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBeCloseTo(0.03)
    expect(result.current.totalTokens).toBe(1145)
    expect(result.current.messageCount).toBe(2)
  })

  it('excludes assistants at or after the revert boundary', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }, 0.01),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 0,
        cache: { read: 100, write: 50 },
      }, 0.02),
    ])

    const { result } = renderHook(() => useSessionCost(SESSION_ID, 'assistant-2'), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBeCloseTo(0.01)
    expect(result.current.totalTokens).toBe(1015)
    expect(result.current.messageCount).toBe(1)
  })

  it('hides the total when the revert boundary is unknown', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }, 0.01),
    ])

    const { result } = renderHook(() => useSessionCost(SESSION_ID, 'missing-message'), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBe(0)
    expect(result.current.totalTokens).toBe(0)
    expect(result.current.messageCount).toBe(0)
  })

  it('returns an empty total for an empty transcript', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [])

    const { result } = renderHook(() => useSessionCost(SESSION_ID), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBe(0)
    expect(result.current.totalTokens).toBe(0)
    expect(result.current.messageCount).toBe(0)
  })

  it('skips assistants without tokens', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }, 0.01),
      assistantMessage('assistant-2', undefined, 0.02),
    ])

    const { result } = renderHook(() => useSessionCost(SESSION_ID), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.totalCost).toBeCloseTo(0.01)
    expect(result.current.messageCount).toBe(1)
  })

  it('reads the server-scoped transcript for a linked server', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }, 0.01),
    ], REMOTE_SERVER_ID)

    const { result } = renderHook(() => useSessionCost(SESSION_ID), {
      wrapper: createWrapper(queryClient, REMOTE_SERVER_ID),
    })

    expect(result.current.totalCost).toBeCloseTo(0.01)
    expect(result.current.totalTokens).toBe(1015)
    expect(result.current.messageCount).toBe(1)
  })
})
