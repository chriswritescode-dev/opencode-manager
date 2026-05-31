import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAssistantSessionLauncher } from './useAssistantSessionLauncher'
import { OpenCodeClient } from '@/api/opencode'
import { initializeAssistantMode } from '@/api/repos'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  sendPromptAsync: vi.fn(),
  initializeAssistantMode: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  initializeAssistantMode: mocks.initializeAssistantMode,
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    listSessions: mocks.listSessions,
    getSession: mocks.getSession,
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
    mocks.initializeAssistantMode.mockResolvedValue({ directory: '/assistant' })
  })

  it('opens the cached assistant session without listing sessions', async () => {
    localStorage.setItem('ocm:assistant:last-session:123:/assistant', 'cached')
    mocks.getSession.mockResolvedValue({ id: 'cached', directory: '/assistant', time: { updated: 20 } })
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(mocks.getSession).toHaveBeenCalledWith('cached')
    expect(mocks.listSessions).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('cached')
  })

  it('opens the latest root session in the assistant directory', async () => {
    mocks.listSessions.mockResolvedValue([
      { id: 'older', directory: '/assistant', time: { updated: 10 } },
      { id: 'newest-child', parentID: 'newest', directory: '/assistant', time: { updated: 40 } },
      { id: 'different-directory', directory: '/other', time: { updated: 50 } },
      { id: 'newest', directory: '/assistant', time: { updated: 30 } },
    ])
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(initializeAssistantMode).toHaveBeenCalledWith(123)
    expect(OpenCodeClient).toHaveBeenCalledWith('http://localhost:5551', '/assistant')
    expect(mocks.listSessions).toHaveBeenCalledWith({ limit: 1, roots: true })
    expect(onNavigate).toHaveBeenCalledWith('newest')
    expect(localStorage.getItem('ocm:assistant:last-session:123:/assistant')).toBe('newest')
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.sendPromptAsync).not.toHaveBeenCalled()
  })

  it('falls back to latest lookup when the cached session is stale', async () => {
    localStorage.setItem('ocm:assistant:last-session:123:/assistant', 'stale')
    mocks.getSession.mockRejectedValueOnce(new Error('not found'))
    mocks.listSessions.mockResolvedValue([
      { id: 'latest', directory: '/assistant', time: { updated: 30 } },
    ])
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(mocks.getSession).toHaveBeenCalledWith('stale')
    expect(mocks.listSessions).toHaveBeenCalledWith({ limit: 1, roots: true })
    expect(onNavigate).toHaveBeenCalledWith('latest')
    expect(localStorage.getItem('ocm:assistant:last-session:123:/assistant')).toBe('latest')
  })

  it('notifies an existing assistant session when some generated updates were preserved', async () => {
    mocks.initializeAssistantMode.mockResolvedValue({
      directory: '/assistant',
      warnings: [
        {
          code: 'assistant-agents-md-preserved',
          path: '/assistant/AGENTS.md',
          message: 'Some Assistant Mode instruction updates were not applied because AGENTS.md appears to contain customized legacy assistant instructions. To regenerate the default workspace explanation, manually delete AGENTS.md and initialize Assistant Mode again.',
        },
      ],
    })
    mocks.listSessions.mockResolvedValue([
      { id: 'existing', directory: '/assistant', time: { updated: 10 } },
    ])
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(onNavigate).toHaveBeenCalledWith('existing')
    expect(mocks.listSessions).toHaveBeenCalledWith({ limit: 1, roots: true })
    expect(mocks.sendPromptAsync).toHaveBeenCalledWith('existing', {
      parts: [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('some generated instruction changes were not applied'),
        }),
      ],
    })
    const promptText = mocks.sendPromptAsync.mock.calls[0][1].parts[0].text as string
    expect(promptText).toContain('manually delete AGENTS.md')
  })

  it('creates a session when the assistant directory has no root sessions', async () => {
    mocks.listSessions.mockResolvedValue([
      { id: 'other', directory: '/other', time: { updated: 50 } },
    ])
    mocks.createSession.mockResolvedValue({ id: 'created' })
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
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
    mocks.listSessions.mockResolvedValue([])
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
    mocks.listSessions.mockResolvedValue([])
    mocks.createSession.mockResolvedValue({ id: 'created' })
    mocks.sendPromptAsync.mockRejectedValueOnce(new Error('provider unavailable'))
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useAssistantSessionLauncher({
      repoId: 123,
      opcodeUrl: 'http://localhost:5551',
      onNavigate,
    }))

    await act(async () => {
      await result.current.openAssistant()
    })

    expect(onNavigate).toHaveBeenCalledWith('created')
    expect(mocks.sendPromptAsync).toHaveBeenCalled()
  })
})
