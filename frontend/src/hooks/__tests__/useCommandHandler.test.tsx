import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCommandHandler } from '../useCommandHandler'

const mocks = vi.hoisted(() => ({
  sendCommand: vi.fn(),
  summarizeSession: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  createOpenCodeClient: vi.fn().mockImplementation(() => ({
    sendCommand: mocks.sendCommand,
    summarizeSession: mocks.summarizeSession,
  })),
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useCreateSession: vi.fn(() => ({
    mutateAsync: vi.fn(),
  })),
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({
    model: { providerID: 'test-provider', modelID: 'test-model' },
    modelString: 'test-provider/test-model',
  })),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn((selector) => selector({ setStatus: mocks.setStatus })),
}))

describe('useCommandHandler', () => {
  const baseProps = {
    opcodeUrl: 'http://localhost:5551',
    sessionID: 'test-session-id',
    directory: '/test/dir',
    currentAgent: 'test-agent',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('themes command sends command', async () => {
    mocks.sendCommand.mockResolvedValue({ info: { id: 'asm_1' }, parts: [] })

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const themesCommand = { name: 'themes' as const }

    await result.current.executeCommand(themesCommand, '')

    expect(mocks.sendCommand).toHaveBeenCalledWith('test-session-id', {
      command: 'themes',
      arguments: '',
      agent: 'test-agent',
      model: 'test-provider/test-model',
    })
  })

  it('compact command summarizes session', async () => {
    mocks.summarizeSession.mockResolvedValue(undefined)

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const compactCommand = { name: 'compact' as const }

    await result.current.executeCommand(compactCommand, '')

    expect(mocks.summarizeSession).toHaveBeenCalledWith(
      'test-session-id',
      'test-provider',
      'test-model'
    )
  })

  it('unknown command sends command', async () => {
    mocks.sendCommand.mockResolvedValue({ info: { id: 'asm_1' }, parts: [] })

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const unknownCommand = { name: 'myskill' as const }

    await result.current.executeCommand(unknownCommand, '')

    expect(mocks.sendCommand).toHaveBeenCalledWith('test-session-id', {
      command: 'myskill',
      arguments: '',
      agent: 'test-agent',
      model: 'test-provider/test-model',
    })
  })

  it('sessions command opens sessions dialog without sending command', async () => {
    const onShowSessionsDialog = vi.fn()
    const { result } = renderHook(() =>
      useCommandHandler({ ...baseProps, onShowSessionsDialog })
    )
    const sessionsCommand = { name: 'sessions' as const }

    await result.current.executeCommand(sessionsCommand, '')

    expect(mocks.sendCommand).not.toHaveBeenCalled()
    expect(onShowSessionsDialog).toHaveBeenCalled()
  })
})
