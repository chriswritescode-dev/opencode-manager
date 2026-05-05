import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAssistantSessionLauncher } from './useAssistantSessionLauncher'
import { OpenCodeClient } from '@/api/opencode'
import { initializeAssistantMode } from '@/api/repos'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
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
    mocks.initializeAssistantMode.mockResolvedValue({ directory: '/assistant' })
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
    expect(onNavigate).toHaveBeenCalledWith('newest')
    expect(mocks.createSession).not.toHaveBeenCalled()
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

    const promptCall = mocks.sendPromptAsync.mock.calls[0]
    const promptText = promptCall[1].parts[0].text as string
    expect(promptText).toContain('.opencode/agents/assistant.md')
    expect(promptText).toContain('AGENTS.md')
    expect(promptText).toContain('.opencode/skills/')
    expect(promptText).not.toContain('v file')
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
