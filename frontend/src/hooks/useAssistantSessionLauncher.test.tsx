import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAssistantSessionLauncher } from './useAssistantSessionLauncher'
import { OpenCodeClient } from '@/api/opencode'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSessionsPage: vi.fn(),
  createSession: vi.fn(),
  sendPromptAsync: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    listSessions: mocks.listSessions,
    listSessionsPage: mocks.listSessionsPage,
    createSession: mocks.createSession,
    sendPromptAsync: mocks.sendPromptAsync,
  })),
}))

beforeEach(() => {
  mocks.sendPromptAsync.mockResolvedValue(undefined)
})

describe('useAssistantSessionLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('opens the latest root session in the assistant directory', async () => {
    mocks.listSessionsPage.mockResolvedValue({
      items: [
        { id: 'older', directory: '/assistant', time: { updated: 10 } },
        { id: 'newest-child', parentID: 'newest', directory: '/assistant', time: { updated: 40 } },
        { id: 'different-directory', directory: '/other', time: { updated: 50 } },
        { id: 'newest', directory: '/assistant', time: { updated: 30 } },
      ],
    })
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      directory: '/assistant',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(OpenCodeClient).toHaveBeenCalledWith('http://localhost:5551', '/assistant')
    expect(mocks.listSessionsPage).toHaveBeenCalledWith({ limit: 25, order: 'desc' })
    expect(mocks.listSessions).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('newest')
    expect(localStorage.getItem('ocm:assistant:last-session:123:/assistant')).toBe('newest')
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.sendPromptAsync).not.toHaveBeenCalled()
  })

  it('paginates assistant sessions instead of making an unbounded session list request', async () => {
    mocks.listSessionsPage
      .mockResolvedValueOnce({
        items: [
          { id: 'newest-child', parentID: 'newest', directory: '/assistant', time: { updated: 40 } },
        ],
        nextCursor: 'next-page',
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'newest', directory: '/assistant', time: { updated: 30 } },
        ],
      })
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      directory: '/assistant',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(mocks.listSessionsPage).toHaveBeenNthCalledWith(1, { limit: 25, order: 'desc' })
    expect(mocks.listSessionsPage).toHaveBeenNthCalledWith(2, { cursor: 'next-page' })
    expect(mocks.listSessions).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('newest')
  })

  it('navigates directly to the cached assistant session without querying OpenCode', async () => {
    localStorage.setItem('ocm:assistant:last-session:123:/assistant', 'cached')
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      directory: '/assistant',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(onNavigate).toHaveBeenCalledWith('cached')
    expect(OpenCodeClient).not.toHaveBeenCalled()
    expect(mocks.listSessionsPage).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.sendPromptAsync).not.toHaveBeenCalled()
  })

  it('creates a session when the assistant directory has no root sessions', async () => {
    mocks.listSessionsPage.mockResolvedValue({
      items: [
        { id: 'other', directory: '/other', time: { updated: 50 } },
      ],
    })
    mocks.createSession.mockResolvedValue({ id: 'created' })
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      directory: '/assistant',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(mocks.createSession).toHaveBeenCalledWith({ title: 'Assistant' })
    expect(mocks.sendPromptAsync).toHaveBeenCalledWith('created', {
      parts: [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Welcome to OpenCode Manager!'),
        }),
      ],
    })
    expect(onNavigate).toHaveBeenCalledWith('created')
    expect(localStorage.getItem('ocm:assistant:last-session:123:/assistant')).toBe('created')

    const promptCall = mocks.sendPromptAsync.mock.calls[0]
    const promptText = promptCall[1].parts[0].text as string
    expect(promptText).toContain('.opencode/agents/assistant.md')
    expect(promptText).toContain('AGENTS.md')
    expect(promptText).toContain('.opencode/skills/')
    expect(promptText).toContain('directory')
    expect(promptText).toContain('durable preferences')
    expect(promptText).toContain('self-editing rules')
    expect(promptText).not.toContain('v file')
    expect(promptText).not.toMatch(/AGENTS\.md contains workspace-level instructions, durable preferences, and self-editing rules/)
  })

  it('navigates after creating a session without waiting for the welcome prompt to complete', async () => {
    mocks.listSessionsPage.mockResolvedValue({ items: [] })
    let resolvePrompt: () => void
    const promptPromise = new Promise<void>((resolve) => {
      resolvePrompt = resolve
    })
    mocks.createSession.mockResolvedValue({ id: 'created' })
    mocks.sendPromptAsync.mockImplementation(() => promptPromise)
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      directory: '/assistant',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(onNavigate).toHaveBeenCalledWith('created')
    expect(mocks.sendPromptAsync).toHaveBeenCalledWith('created', {
      parts: [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Welcome to OpenCode Manager!'),
        }),
      ],
    })
    resolvePrompt!()
  })

  it('navigates even when welcome prompt fails', async () => {
    mocks.listSessionsPage.mockResolvedValue({ items: [] })
    mocks.createSession.mockResolvedValue({ id: 'created' })
    mocks.sendPromptAsync.mockRejectedValueOnce(new Error('provider unavailable'))
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      directory: '/assistant',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(onNavigate).toHaveBeenCalledWith('created')
    expect(mocks.sendPromptAsync).toHaveBeenCalled()
  })

  it('rejects when the assistant directory is unavailable', async () => {
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      onNavigate,
    }))

    await act(async () => {
      await expect(result.current.openAssistant()).rejects.toThrow('Assistant workspace directory is unavailable')
    })

    expect(OpenCodeClient).not.toHaveBeenCalled()
    expect(mocks.listSessionsPage).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
