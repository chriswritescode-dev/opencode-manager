import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageCompaction,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import { useContextUsage } from './useContextUsage'
import { emptySessionTranscript } from '@/lib/session-projection'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'

const mocks = vi.hoisted(() => ({
  useProviders: vi.fn(),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: mocks.useProviders,
}))

const SESSION_ID = 'session-1'
const DIRECTORY = '/repo'

const model = { id: 'claude-sonnet', providerID: 'anthropic' }

function assistantMessage(id: string, tokens: SessionMessageAssistant['tokens']): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model,
    content: [],
    time: { created: 1 },
    tokens,
  }
}

function compactionMessage(id: string, status: 'running' | 'completed'): SessionMessageCompaction {
  const base = {
    id,
    type: 'compaction' as const,
    reason: 'auto' as const,
    summary: '',
    recent: '',
    time: { created: 1 },
  }
  return status === 'running'
    ? { ...base, status: 'running' }
    : { ...base, status: 'completed' }
}

function seedTranscript(queryClient: QueryClient, messages: SessionMessageInfo[]) {
  queryClient.setQueryData(sessionTranscriptQueryKey(SESSION_ID), {
    transcript: { ...emptySessionTranscript, messages },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useContextUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProviders.mockReturnValue({ data: { models: [] } })
  })

  it('counts cache.write in the total token usage', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('rounds the usage percentage against the model context limit', () => {
    mocks.useProviders.mockReturnValue({
      data: { models: [{ providerID: 'anthropic', id: 'claude-sonnet', limit: { context: 1000 } }] },
    })
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.usagePercentage).toBe(152)
  })

  it('reports the context limit measured against', () => {
    mocks.useProviders.mockReturnValue({
      data: { models: [{ providerID: 'anthropic', id: 'claude-sonnet', limit: { context: 1000 } }] },
    })
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.contextLimit).toBe(1000)
  })

  it('hides usage when the latest assistant has all-zero tokens even if an earlier one had usage', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      assistantMessage('assistant-2', {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current).toBeNull()
  })

  it('skips the latest assistant when tokens are undefined and uses the earlier assistant', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      assistantMessage('assistant-2', undefined),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('ignores assistants before the latest completed compaction', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      compactionMessage('compaction-1', 'completed'),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current).toBeNull()
  })

  it('uses an assistant that appears after the latest completed compaction', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      compactionMessage('compaction-1', 'completed'),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 0,
        cache: { read: 100, write: 50 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.totalTokens).toBe(180)
  })

  it('does not treat a running compaction as a boundary', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      compactionMessage('compaction-1', 'running'),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('ignores assistants at or after the revert boundary', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 0,
        cache: { read: 100, write: 50 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY, 'assistant-2'), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('hides usage when the revert boundary excludes every assistant', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 0,
        cache: { read: 100, write: 50 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY, 'assistant-1'), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current).toBeNull()
  })

  it('hides usage when the revert boundary is unknown', () => {
    const queryClient = createQueryClient()
    seedTranscript(queryClient, [
      assistantMessage('assistant-1', {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 1000, write: 500 },
      }),
    ])

    const { result } = renderHook(() => useContextUsage(SESSION_ID, DIRECTORY, 'missing-message'), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current).toBeNull()
  })
})
