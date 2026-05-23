import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSendPrompt } from './useOpenCode'
import { FetchError } from '../api/fetchWrapper'

const mockSendPrompt = vi.fn()
const mockSendPromptAsync = vi.fn()

vi.mock('../api/opencode', async () => {
  const actual = await vi.importActual('../api/opencode')
  return {
    ...actual,
    OpenCodeClient: vi.fn().mockImplementation(() => ({
      sendPrompt: mockSendPrompt,
      sendPromptAsync: mockSendPromptAsync,
    })),
  }
})

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn(() => vi.fn()),
}))

vi.mock('../lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

vi.mock('../lib/opencode-errors', () => ({
  parseNetworkError: vi.fn((err) => ({
    title: 'Error',
    message: err.message,
    isRetryable: false,
  })),
}))

const mockClearError = vi.fn()
const mockSetError = vi.fn()

vi.mock('../stores/sendErrorStore', () => ({
  useSendErrorStore: {
    getState: () => ({
      clearError: mockClearError,
      setError: mockSetError,
      getError: vi.fn(),
    }),
  },
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

describe('useSendPrompt', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mockSendPrompt.mockResolvedValue({
      info: { id: 'test-response' },
      parts: [],
    })
    mockSendPromptAsync.mockResolvedValue(undefined)
  })

  const renderHookWithProviders = () =>
    renderHook(
      () => useSendPrompt('http://localhost:5551', '/test'),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      }
    )

  it('proceeds when no providers in cache', async () => {
    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'test-session',
        prompt: 'Hello',
        model: 'anthropic/claude-sonnet-4',
      })
    ).resolves.toBeDefined()

    expect(mockSendPrompt).toHaveBeenCalled()
  })

  it('throws FetchError with MODEL_UNAVAILABLE when model not in providers', async () => {
    queryClient.setQueryData(
      ['opencode', 'providers', 'http://localhost:5551', '/test'],
      {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-4': { id: 'gpt-4', name: 'GPT-4' },
            },
            isConnected: true,
          },
        ],
        connected: ['openai'],
        default: {},
      }
    )

    const { result } = renderHookWithProviders()

    let error: Error | undefined
    try {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        prompt: 'Hello',
        model: 'anthropic/claude-sonnet-4',
      })
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeInstanceOf(FetchError)
    expect((error as FetchError).code).toBe('MODEL_UNAVAILABLE')
    expect((error as FetchError).statusCode).toBe(409)
    expect(error!.message).toBe('Selected model is no longer available. Pick a different model.')
    expect(mockSendPrompt).not.toHaveBeenCalled()
  })

  it('proceeds when model exists in providers', async () => {
    queryClient.setQueryData(
      ['opencode', 'providers', 'http://localhost:5551', '/test'],
      {
        providers: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: {
              'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
            },
            isConnected: true,
          },
        ],
        connected: ['anthropic'],
        default: {},
      }
    )

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'test-session',
        prompt: 'Hello',
        model: 'anthropic/claude-sonnet-4',
      })
    ).resolves.toBeDefined()

    expect(mockSendPrompt).toHaveBeenCalled()
  })

  it('clears stored send error on successful queued retry', async () => {
    mockClearError.mockClear()

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-1',
        prompt: 'Hello',
        queued: true,
      })
    ).resolves.toEqual(expect.objectContaining({ queued: true }))

    expect(mockClearError).toHaveBeenCalledWith('session-1')
  })

  it('clears stored send error on successful non-queued response', async () => {
    mockClearError.mockClear()

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-2',
        prompt: 'Hello',
      })
    ).resolves.toBeDefined()

    expect(mockClearError).toHaveBeenCalledWith('session-2')
  })
})
