import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLoadSkill } from '../useOpenCode'
import type { MessageWithParts } from '../../api/types'

import { showToast } from '../../lib/toast'

const mocks = vi.hoisted(() => ({
  sendCommand: vi.fn(),
}))

vi.mock('../../api/opencode', () => ({
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    sendCommand: mocks.sendCommand,
  })),
}))

vi.mock('../../lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useLoadSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls sendCommand with correct parameters when mutate is called', async () => {
    const mockResponse = {
      info: { id: 'asm_1', sessionID: 'test-session-id', role: 'assistant' },
      parts: []
    }
    mocks.sendCommand.mockResolvedValue(mockResponse)

    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mocks.sendCommand).toHaveBeenCalledTimes(1)
    expect(mocks.sendCommand).toHaveBeenCalledWith('test-session-id', {
      command: 'my-skill',
      arguments: '',
    })
  })

  it('throws error when sessionID is undefined', async () => {
    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', undefined, '/test/dir'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe('No active session')
  })

  it('throws error when client is not available', async () => {
    const { result } = renderHook(
      () => useLoadSkill(null, 'test-session-id', '/test/dir'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe('No OpenCode client available')
  })

  it('calls showToast.error when sendCommand fails', async () => {
    const testError = new Error('Command failed')
    mocks.sendCommand.mockRejectedValue(testError)

    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(showToast.error).toHaveBeenCalledTimes(1)
    expect(showToast.error).toHaveBeenCalledWith('Command failed')
  })

  it('calls showToast.error with default message for non-Error objects', async () => {
    mocks.sendCommand.mockRejectedValue('string error')

    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(showToast.error).toHaveBeenCalledTimes(1)
    expect(showToast.error).toHaveBeenCalledWith('Failed to load skill')
  })

  it('adds optimistic user message with skill name on mutate', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const messagesKey = ['opencode', 'messages', 'http://localhost:5551', 'test-session-id', '/test/dir']
    queryClient.setQueryData(messagesKey, [])

    mocks.sendCommand.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      const messages = queryClient.getQueryData<MessageWithParts[]>(messagesKey)
      expect(messages).toHaveLength(1)
      expect(messages?.[0].info.id).toMatch(/^optimistic_user_/)
      expect((messages?.[0].parts[0] as { text?: string }).text).toBe('Loading skill: my-skill')
    })
  })

  it('sets session status to busy on mutate and idle on error', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const testError = new Error('Command failed')
    mocks.sendCommand.mockRejectedValue(testError)

    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

  })

  it('removes optimistic message from cache on error', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const messagesKey = ['opencode', 'messages', 'http://localhost:5551', 'test-session-id', '/test/dir']
    queryClient.setQueryData(messagesKey, [])

    const testError = new Error('Command failed')
    mocks.sendCommand.mockRejectedValue(testError)

    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    const messages = queryClient.getQueryData<MessageWithParts[]>(messagesKey)
    expect(messages).toHaveLength(0)
  })

  it('replaces optimistic message with assistant response on success', async () => {
    const assistant = {
      info: { id: 'asm_skill_1', sessionID: 'test-session-id', role: 'assistant' },
      parts: [{ type: 'text', text: 'done' }]
    }
    mocks.sendCommand.mockResolvedValue(assistant)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    const { result } = renderHook(
      () => useLoadSkill('http://localhost:5551', 'test-session-id', '/test/dir'),
      { wrapper }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const messages = queryClient.getQueryData<MessageWithParts[]>(['opencode', 'messages', 'http://localhost:5551', 'test-session-id', '/test/dir'])
    expect(messages?.some(m => m.info.id === 'asm_skill_1')).toBe(true)
  })
})
