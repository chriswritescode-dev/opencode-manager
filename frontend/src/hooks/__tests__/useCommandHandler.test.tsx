import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCommandHandler } from '../useCommandHandler'
import { ensureSSEConnected } from '@/lib/sseManager'
import { showToast } from '@/lib/toast'

const mocks = vi.hoisted(() => ({
  sendCommand: vi.fn(),
  summarizeSession: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('@/lib/sseManager', () => ({
  ensureSSEConnected: vi.fn().mockResolvedValue(true),
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

  it('themes command awaits ensureSSEConnected before sendCommand', async () => {
    mocks.sendCommand.mockResolvedValue({ info: { id: 'asm_1' }, parts: [] })

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const themesCommand = { name: 'themes' as const }

    await result.current.executeCommand(themesCommand, '')

    const sseCallOrder = (ensureSSEConnected as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const sendCallOrder = mocks.sendCommand.mock.invocationCallOrder[0]
    expect(sseCallOrder).toBeLessThan(sendCallOrder)
    expect(mocks.sendCommand).toHaveBeenCalledWith('test-session-id', {
      command: 'themes',
      arguments: '',
      agent: 'test-agent',
      model: 'test-provider/test-model',
    })
  })

  it('compact command awaits ensureSSEConnected before summarizeSession', async () => {
    mocks.summarizeSession.mockResolvedValue(undefined)

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const compactCommand = { name: 'compact' as const }

    await result.current.executeCommand(compactCommand, '')

    const sseCallOrder = (ensureSSEConnected as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const summarizeCallOrder = mocks.summarizeSession.mock.invocationCallOrder[0]
    expect(sseCallOrder).toBeLessThan(summarizeCallOrder)
    expect(mocks.summarizeSession).toHaveBeenCalledWith(
      'test-session-id',
      'test-provider',
      'test-model'
    )
  })

  it('unknown command (default) awaits ensureSSEConnected before sendCommand', async () => {
    mocks.sendCommand.mockResolvedValue({ info: { id: 'asm_1' }, parts: [] })

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const unknownCommand = { name: 'myskill' as const }

    await result.current.executeCommand(unknownCommand, '')

    const sseCallOrder = (ensureSSEConnected as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const sendCallOrder = mocks.sendCommand.mock.invocationCallOrder[0]
    expect(sseCallOrder).toBeLessThan(sendCallOrder)
    expect(mocks.sendCommand).toHaveBeenCalledWith('test-session-id', {
      command: 'myskill',
      arguments: '',
      agent: 'test-agent',
      model: 'test-provider/test-model',
    })
  })

  it('sessions command does NOT call ensureSSEConnected or sendCommand', async () => {
    const onShowSessionsDialog = vi.fn()
    const { result } = renderHook(() =>
      useCommandHandler({ ...baseProps, onShowSessionsDialog })
    )
    const sessionsCommand = { name: 'sessions' as const }

    await result.current.executeCommand(sessionsCommand, '')

    expect(ensureSSEConnected).not.toHaveBeenCalled()
    expect(mocks.sendCommand).not.toHaveBeenCalled()
    expect(onShowSessionsDialog).toHaveBeenCalled()
  })

  it('shows error toast when ensureSSEConnected fails', async () => {
    ;(ensureSSEConnected as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)

    const { result } = renderHook(() => useCommandHandler(baseProps))
    const themesCommand = { name: 'themes' as const }

    await result.current.executeCommand(themesCommand, '')

    expect(showToast.error).toHaveBeenCalledWith('Unable to connect. Please try again.')
    expect(mocks.sendCommand).not.toHaveBeenCalled()
  })
})
