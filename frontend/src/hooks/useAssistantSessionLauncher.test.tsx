import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAssistantSessionLauncher } from './useAssistantSessionLauncher'
import { OpenCodeClient } from '@/api/opencode'
import { initializeAssistantMode } from '@/api/repos'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  sendPrompt: vi.fn(),
  initializeAssistantMode: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  initializeAssistantMode: mocks.initializeAssistantMode,
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    listSessions: mocks.listSessions,
    createSession: mocks.createSession,
    sendPrompt: mocks.sendPrompt,
  })),
}))

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
    expect(mocks.sendPrompt).toHaveBeenCalledWith('created', {
      parts: [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Welcome to OpenCode Manager!'),
        }),
      ],
    })
    expect(onNavigate).toHaveBeenCalledWith('created')
  })
})
