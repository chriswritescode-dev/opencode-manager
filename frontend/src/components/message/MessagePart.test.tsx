import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessagePart } from './MessagePart'
import type { MessagePart as MessagePartType } from '@/api/types'

const mocks = vi.hoisted(() => ({
  useTTS: vi.fn(),
  useSettings: vi.fn(),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: mocks.useTTS,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

interface MockTTSReturn {
  speakMessage: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  activeMessageId: string | null
  isPlaying: boolean
  isLoading: boolean
  isEnabled: boolean
}

interface MockSettingsReturn {
  preferences: {
    simpleChatMode: boolean
    showReasoning: boolean
    expandToolCalls: boolean
    expandDiffs: boolean
    autoScroll: boolean
    theme: 'dark' | 'light' | 'system'
    mode: 'plan' | 'build'
  } | undefined
  isLoading: boolean
  updateSettings: ReturnType<typeof vi.fn>
  isUpdating: boolean
}

describe('MessagePart', () => {
  const mockSpeakMessage = vi.fn()
  const mockStop = vi.fn()

  beforeEach(() => {
    mockSpeakMessage.mockClear()
    mockStop.mockClear()
    mocks.useSettings.mockReturnValue({
      preferences: {
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark' as const,
        mode: 'build' as const,
      },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
  })

  const setup = (options: {
    ttsEnabled?: boolean
    autoPlay?: boolean
    activeMessageId?: string | null
    isPlaying?: boolean
    isLoading?: boolean
  } = {}) => {
    const mockTTS: MockTTSReturn = {
      speakMessage: mockSpeakMessage,
      stop: mockStop,
      activeMessageId: options.activeMessageId ?? null,
      isPlaying: options.isPlaying ?? false,
      isLoading: options.isLoading ?? false,
      isEnabled: options.ttsEnabled ?? true,
    }
    mocks.useTTS.mockReturnValue(mockTTS)
  }

  const setupSettings = (preferences: MockSettingsReturn['preferences']) => {
    mocks.useSettings.mockReturnValue({
      preferences,
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
  }

  const createStepFinishPart = (messageID: string): MessagePartType => ({
    type: 'step-finish',
    messageID,
    sessionID: 'test-session',
    cost: 0.01,
    tokens: {
      input: 100,
      output: 50,
      cache: { read: 0, write: 0 },
    },
    time: {
      start: Date.now(),
      end: Date.now() + 100,
    },
  })

  const TEST_MESSAGE_ID = 'message-1'
  const TEST_CONTENT = 'Test message content'

  it('renders TTS button for step-finish part with message text', () => {
    setup()
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByTitle('Read aloud')).toBeInTheDocument()
  })

  it('does not render TTS button when message text is empty', () => {
    setup()
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent=""
      />
    )
    
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not render TTS button when TTS is disabled', () => {
    setup({ ttsEnabled: false })
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('calls speakMessage with message id on tap when idle', () => {
    setup()
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    const button = screen.getByRole('button')
    fireEvent.click(button)
    
    expect(mockSpeakMessage).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).toHaveBeenCalledWith(TEST_MESSAGE_ID, TEST_CONTENT)
  })

  it('calls stop on tap when this message is active', () => {
    const mockTTSForTest: MockTTSReturn = {
      speakMessage: mockSpeakMessage,
      stop: mockStop,
      activeMessageId: TEST_MESSAGE_ID,
      isPlaying: true,
      isLoading: false,
      isEnabled: true,
    }
    mocks.useTTS.mockReturnValue(mockTTSForTest)
    
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    const button = screen.getByRole('button')
    fireEvent.click(button)
    
    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('shows active state when this message is playing', () => {
    setup({ activeMessageId: TEST_MESSAGE_ID, isPlaying: true })
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-red-500/20')
    expect(button).toHaveClass('text-red-500')
  })

  it('shows active state when this message is loading', () => {
    setup({ activeMessageId: TEST_MESSAGE_ID, isLoading: true })
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-red-500/20')
  })

  it('does not show active state when different message is playing', () => {
    setup({ activeMessageId: 'other-message', isPlaying: true })
    const part = createStepFinishPart(TEST_MESSAGE_ID)
    
    render(
      <MessagePart
        part={part}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    const button = screen.getByRole('button')
    expect(button).not.toHaveClass('bg-red-500/20')
  })

  it('tracks playback by message id not text', () => {
    setup({ activeMessageId: TEST_MESSAGE_ID, isPlaying: true })
    const part1 = createStepFinishPart(TEST_MESSAGE_ID)
    const part2 = createStepFinishPart('message-2')
    
    const { rerender } = render(
      <MessagePart
        part={part1}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    expect(screen.getByRole('button')).toHaveClass('bg-red-500/20')
    
    rerender(
      <MessagePart
        part={part2}
        messageTextContent={TEST_CONTENT}
      />
    )
    
    expect(screen.getByRole('button')).not.toHaveClass('bg-red-500/20')
  })

  describe('simpleChatMode', () => {
    const createToolPart = (): MessagePartType => ({
      type: 'tool',
      tool: 'edit',
      sessionID: 'test-session',
      state: {
        status: 'completed',
        input: { filePath: '/test/file.txt' },
        time: { start: Date.now(), end: Date.now() + 100 },
      },
    })

    const createPatchPart = (): MessagePartType => ({
      type: 'patch',
      hash: 'abc123',
      files: ['/test/file.txt'],
      sessionID: 'test-session',
    })

    const createReasoningPart = (): MessagePartType => ({
      type: 'reasoning',
      text: 'This is the reasoning text',
      sessionID: 'test-session',
    })

    const createSnapshotPart = (): MessagePartType => ({
      type: 'snapshot',
      snapshot: 'snapshot-data',
      sessionID: 'test-session',
    })

    const createAgentPart = (): MessagePartType => ({
      type: 'agent',
      name: 'test-agent',
      sessionID: 'test-session',
    })

    const createStepFinishPart = (): MessagePartType => ({
      type: 'step-finish',
      messageID: 'test-message',
      sessionID: 'test-session',
      cost: 0.01,
      tokens: {
        input: 100,
        output: 50,
        cache: { read: 0, write: 0 },
      },
      time: {
        start: Date.now(),
        end: Date.now() + 100,
      },
    })

    const createTextPart = (): MessagePartType => ({
      type: 'text',
      text: 'Hello, this is a text message',
      sessionID: 'test-session',
    })

    it('renders null for tool part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createToolPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders null for patch part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createPatchPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders null for reasoning part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: true,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createReasoningPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders null for snapshot part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createSnapshotPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders null for agent part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createAgentPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders text part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createTextPart()
      render(<MessagePart part={part} />)
      
      expect(screen.getByText('Hello, this is a text message')).toBeInTheDocument()
    })

    it('renders tool part when simpleChatMode is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createToolPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).not.toBeNull()
    })

    it('renders patch part when simpleChatMode is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createPatchPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).not.toBeNull()
    })

    it('renders snapshot part when simpleChatMode is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createSnapshotPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).not.toBeNull()
    })

    it('renders agent part when simpleChatMode is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createAgentPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).not.toBeNull()
    })

    it('renders null for step-finish part when simpleChatMode is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createStepFinishPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders step-finish part when simpleChatMode is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createStepFinishPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).not.toBeNull()
    })
  })

  describe('showReasoning', () => {
    const createReasoningPart = (): MessagePartType => ({
      type: 'reasoning',
      text: 'This is the reasoning text',
      sessionID: 'test-session',
    })

    it('renders null for reasoning part when showReasoning is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createReasoningPart()
      const { container } = render(<MessagePart part={part} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders reasoning part when showReasoning is true', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: true,
        expandToolCalls: false,
        expandDiffs: true,
        autoScroll: true,
        theme: 'dark',
        mode: 'build',
      })
      
      const part = createReasoningPart()
      render(<MessagePart part={part} />)
      
      expect(screen.getByText('This is the reasoning text')).toBeInTheDocument()
      expect(screen.getByText('Reasoning')).toBeInTheDocument()
    })
  })
})
