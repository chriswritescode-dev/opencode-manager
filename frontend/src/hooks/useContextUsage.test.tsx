import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageCompaction,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import { useContextUsage } from './useContextUsage'
import { emptySessionTranscript } from '@/lib/session-projection'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { renderHookWithProviders, createTestQueryClient } from '@/test/render'
import { makeCatalogModel } from '@/test/fixtures/api'
import type { QueryClient } from '@tanstack/react-query'
import type { ProviderCatalog } from '@/api/providers'

const SESSION_ID = 'session-1'
const DIRECTORY = '/repo'
const PROVIDERS_KEY = ['opencode', 'providers', DIRECTORY]
const TRANSCRIPT_KEY = sessionTranscriptQueryKey(SESSION_ID)

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const model = { id: 'claude-sonnet', providerID: 'anthropic' }

const usageTokens = {
  input: 10,
  output: 5,
  reasoning: 0,
  cache: { read: 1000, write: 500 },
}

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
  return status === 'running' ? { ...base, status: 'running' } : { ...base, status: 'completed' }
}

function providerCatalog(contextLimit?: number): ProviderCatalog {
  if (contextLimit === undefined) return { providers: [], models: [] }
  return {
    providers: [],
    models: [
      makeCatalogModel({
        providerID: model.providerID,
        id: model.id,
        modelID: model.id,
        limit: { context: contextLimit, output: 0 },
      }),
    ],
  }
}

function seedTranscript(queryClient: QueryClient, messages: SessionMessageInfo[]) {
  queryClient.setQueryData(TRANSCRIPT_KEY, {
    transcript: { ...emptySessionTranscript, messages },
  })
}

function renderUsage(
  messages: SessionMessageInfo[],
  options: { models?: ProviderCatalog, revertMessageID?: string } = {},
) {
  const queryClient = createTestQueryClient()
  seedTranscript(queryClient, messages)
  queryClient.setQueryData(PROVIDERS_KEY, options.models ?? providerCatalog())

  const rendered = renderHookWithProviders(
    () => useContextUsage(SESSION_ID, DIRECTORY, options.revertMessageID),
    { ...hookProviders, queryClient },
  )

  return { ...rendered, queryClient }
}

describe('useContextUsage', () => {
  it('reports the total tokens, usage percentage and context limit', () => {
    const { result } = renderUsage([assistantMessage('assistant-1', usageTokens)], {
      models: providerCatalog(1000),
    })

    expect(result.current).toEqual({ totalTokens: 1515, usagePercentage: 152, contextLimit: 1000 })
  })

  it('hides usage when the latest assistant has all-zero tokens even if an earlier one had usage', () => {
    const { result } = renderUsage([
      assistantMessage('assistant-1', usageTokens),
      assistantMessage('assistant-2', {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    ])

    expect(result.current).toBeNull()
  })

  it('skips the latest assistant when tokens are undefined and uses the earlier assistant', () => {
    const { result } = renderUsage([
      assistantMessage('assistant-1', usageTokens),
      assistantMessage('assistant-2', undefined),
    ])

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('ignores assistants before the latest completed compaction', () => {
    const { result } = renderUsage([
      assistantMessage('assistant-1', usageTokens),
      compactionMessage('compaction-1', 'completed'),
    ])

    expect(result.current).toBeNull()
  })

  it('uses an assistant that appears after the latest completed compaction', () => {
    const { result } = renderUsage([
      assistantMessage('assistant-1', usageTokens),
      compactionMessage('compaction-1', 'completed'),
      assistantMessage('assistant-2', {
        input: 20,
        output: 10,
        reasoning: 0,
        cache: { read: 100, write: 50 },
      }),
    ])

    expect(result.current?.totalTokens).toBe(180)
  })

  it('does not treat a running compaction as a boundary', () => {
    const { result } = renderUsage([
      assistantMessage('assistant-1', usageTokens),
      compactionMessage('compaction-1', 'running'),
    ])

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('ignores assistants at or after the revert boundary', () => {
    const { result } = renderUsage(
      [
        assistantMessage('assistant-1', usageTokens),
        assistantMessage('assistant-2', {
          input: 20,
          output: 10,
          reasoning: 0,
          cache: { read: 100, write: 50 },
        }),
      ],
      { revertMessageID: 'assistant-2' },
    )

    expect(result.current?.totalTokens).toBe(1515)
  })

  it('hides usage when the revert boundary excludes every assistant', () => {
    const { result } = renderUsage(
      [
        assistantMessage('assistant-1', usageTokens),
        assistantMessage('assistant-2', {
          input: 20,
          output: 10,
          reasoning: 0,
          cache: { read: 100, write: 50 },
        }),
      ],
      { revertMessageID: 'assistant-1' },
    )

    expect(result.current).toBeNull()
  })

  it('hides usage when the revert boundary is unknown', () => {
    const { result } = renderUsage([assistantMessage('assistant-1', usageTokens)], {
      revertMessageID: 'missing-message',
    })

    expect(result.current).toBeNull()
  })

  it('keeps the usage object identity across transcript updates that do not change the totals', () => {
    const { result, queryClient, rerender } = renderUsage([assistantMessage('assistant-1', usageTokens)])
    const firstUsage = result.current

    act(() => {
      seedTranscript(queryClient, [
        assistantMessage('assistant-1', usageTokens),
        assistantMessage('assistant-2', undefined),
      ])
    })
    rerender()

    expect(result.current).toBe(firstUsage)
    expect(result.current?.totalTokens).toBe(1515)
  })

  it('returns a new usage object when the token totals change', () => {
    const { result, queryClient, rerender } = renderUsage([assistantMessage('assistant-1', usageTokens)])
    const firstUsage = result.current

    act(() => {
      seedTranscript(queryClient, [
        assistantMessage('assistant-1', usageTokens),
        assistantMessage('assistant-2', {
          input: 20,
          output: 10,
          reasoning: 0,
          cache: { read: 100, write: 50 },
        }),
      ])
    })
    rerender()

    expect(result.current).not.toBe(firstUsage)
    expect(result.current?.totalTokens).toBe(180)
  })

  it('returns a new usage object when only the measurable context limit changes', () => {
    const { result, queryClient, rerender } = renderUsage([assistantMessage('assistant-1', usageTokens)])
    const firstUsage = result.current

    act(() => {
      queryClient.setQueryData(PROVIDERS_KEY, providerCatalog(1000))
    })
    rerender()

    expect(result.current).not.toBe(firstUsage)
    expect(result.current?.contextLimit).toBe(1000)
    expect(result.current?.usagePercentage).toBe(152)
  })
})
