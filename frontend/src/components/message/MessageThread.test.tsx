import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageThread } from './MessageThread'
import { useUIState } from '@/stores/uiStateStore'

const mocks = vi.hoisted(() => ({
  useSessionStatus: vi.fn(),
  useSessionTodos: vi.fn(),
  useSettings: vi.fn(),
  usePermissions: vi.fn(),
  useQuestions: vi.fn(),
  useRefreshMessage: vi.fn(),
  useSessionAgent: vi.fn(),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatusForSession: () => mocks.useSessionStatus(),
}))

vi.mock('@/stores/sessionTodosStore', () => ({
  useSessionTodos: mocks.useSessionTodos,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => mocks.usePermissions(),
  useQuestions: () => mocks.useQuestions(),
}))

vi.mock('@/hooks/useRemoveMessage', () => ({
  useRefreshMessage: () => mocks.useRefreshMessage(),
}))

vi.mock('@/hooks/useSessionAgent', () => ({
  useSessionAgent: () => mocks.useSessionAgent(),
}))

interface MockSettingsReturn {
  preferences: {
    simpleChatMode: boolean
    showReasoning: boolean
  } | undefined
}

const setupSettings = (preferences: MockSettingsReturn['preferences']) => {
  mocks.useSettings.mockReturnValue({
    preferences,
    isLoading: false,
    updateSettings: vi.fn(),
    isUpdating: false,
  })
}

const createTextPart = (text: string, messageId: string) => ({
  type: 'text' as const,
  text,
  sessionID: 'test-session',
  messageID: messageId,
  id: 'part-1',
})

const createTaskToolPart = (description: string, sessionId: string | undefined, messageId: string) => ({
  type: 'tool' as const,
  tool: 'task',
  sessionID: 'test-session',
  messageID: messageId,
  id: 'part-2',
  callID: 'call-1',
  metadata: sessionId ? { sessionId } : undefined,
  state: {
    status: 'completed' as const,
    input: { description },
    output: 'done',
    title: 'Task',
    metadata: {},
    time: { start: Date.now(), end: Date.now() + 100 },
  },
})

const createSubtaskPart = (description: string, messageId: string) => ({
  type: 'subtask' as const,
  prompt: 'Please review this',
  description,
  agent: 'reviewer',
  sessionID: 'test-session',
  messageID: messageId,
  id: 'part-3',
})

const createStepFinishPart = (messageId: string) => ({
  type: 'step-finish' as const,
  sessionID: 'test-session',
  messageID: messageId,
  id: 'part-4',
  reason: 'stop',
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
})

const createReasoningPart = (text: string, messageId: string) => ({
  type: 'reasoning' as const,
  text,
  sessionID: 'test-session',
  messageID: messageId,
  id: 'part-5',
})

const createAssistantMessage = (
  id: string,
  parts: unknown[],
  modelID?: string
) => ({
  info: {
    id,
    role: 'assistant' as const,
    sessionID: 'test-session',
    parentID: 'parent-1',
    providerID: 'test-provider',
    mode: 'build',
    time: {
      created: Date.now(),
      completed: Date.now() + 100,
    },
    modelID: modelID || 'test-model',
  },
  parts,
})

const createUserMessage = (id: string, text: string) => ({
  info: {
    id,
    role: 'user' as const,
    sessionID: 'test-session',
    agent: 'test-agent',
    model: 'test-model',
    time: {
      created: Date.now(),
    },
  },
  parts: [createTextPart(text, id)],
})

describe('MessageThread', () => {
  beforeEach(() => {
    mocks.useSessionStatus.mockReturnValue({ type: 'idle' })
    mocks.useSessionTodos.mockReturnValue({ setTodos: vi.fn() })
    mocks.usePermissions.mockReturnValue({
      getForCallID: vi.fn(() => null),
    })
    mocks.useQuestions.mockReturnValue({
      getForCallID: vi.fn(() => null),
    })
    mocks.useRefreshMessage.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    })
    mocks.useSessionAgent.mockReturnValue({ agent: 'test-agent' })
    useUIState.getState().setIsEditingMessage(false)
  })

  it('renders assistant message with only subtask part as standalone row without header', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [createSubtaskPart('Review changes', '2')]),
    ]

    const onChildSessionClick = vi.fn()

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
        onChildSessionClick={onChildSessionClick}
      />
    )

    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
  })

  it('renders assistant message with only task tool part as standalone row without header', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [createTaskToolPart('Do something', 'child-session', '2')]),
    ]

    const onChildSessionClick = vi.fn()

    const { container } = render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
        onChildSessionClick={onChildSessionClick}
      />
    )

    expect(screen.getByText('Do something')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
    
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    fireEvent.click(buttons[buttons.length - 1])
    expect(onChildSessionClick).toHaveBeenCalledWith('child-session')
  })

  it('renders assistant task message with empty text and step finish as standalone row', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [
        createTextPart('   ', '2'),
        createTaskToolPart('Explore codebase structure', 'child-session', '2'),
        createStepFinishPart('2'),
      ]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('Explore codebase structure')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
  })

  it('renders assistant task message with hidden reasoning as standalone row', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [
        createReasoningPart('I should use the explore agent', '2'),
        createTextPart('\n\n', '2'),
        createTaskToolPart('Explore codebase structure', 'child-session', '2'),
        createStepFinishPart('2'),
      ]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('Explore codebase structure')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
    expect(screen.queryByText('I should use the explore agent')).not.toBeInTheDocument()
  })

  it('renders assistant task message with simple-chat reasoning setting as standalone row', () => {
    setupSettings({
      simpleChatMode: true,
      showReasoning: true,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [
        createReasoningPart('I should use the explore agent', '2'),
        createTextPart('\n\n', '2'),
        createTaskToolPart('Explore codebase structure', 'child-session', '2'),
        createStepFinishPart('2'),
      ]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('Explore codebase structure')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
    expect(screen.queryByText('I should use the explore agent')).not.toBeInTheDocument()
  })

  it('renders assistant task message with visible reasoning as standalone row when no text exists', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: true,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [
        createReasoningPart('I should use the explore agent', '2'),
        createTextPart('\n\n', '2'),
        createTaskToolPart('Explore codebase structure', 'child-session', '2'),
        createStepFinishPart('2'),
      ]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('Explore codebase structure')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('I should use the explore agent')).not.toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
  })

  it('renders assistant message with text normally with header', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [createTextPart('This is a response', '2')]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('This is a response')).toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('renders assistant message with text and subtask normally with header', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [
        createTextPart('Here is the analysis', '2'),
        createSubtaskPart('Review changes', '2'),
      ]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('Here is the analysis')).toBeInTheDocument()
    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('renders user messages normally', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('keeps global editing state active when edit textarea blurs', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [createTextPart('This is a response', '2')]),
    ]

    const { unmount } = render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    fireEvent.click(screen.getByTitle('Edit message'))
    const textarea = screen.getByPlaceholderText('Edit your message...')
    fireEvent.focus(textarea)
    expect(useUIState.getState().isEditingMessage).toBe(true)

    fireEvent.blur(textarea)
    expect(useUIState.getState().isEditingMessage).toBe(true)

    unmount()
    expect(useUIState.getState().isEditingMessage).toBe(false)
  })

  it('resends an edited prompt after the edit textarea blurs', () => {
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
    })
    const mutate = vi.fn()
    mocks.useRefreshMessage.mockReturnValue({
      isPending: false,
      mutate,
    })

    const messages = [
      createUserMessage('1', 'Hello'),
      createAssistantMessage('2', [createTextPart('This is a response', '2')]),
    ]

    render(
      <MessageThread
        opcodeUrl="http://localhost:5551"
        sessionID="test-session"
        messages={messages as any}
      />
    )

    fireEvent.click(screen.getByTitle('Edit message'))
    const textarea = screen.getByPlaceholderText('Edit your message...')
    fireEvent.change(textarea, { target: { value: 'Updated prompt' } })
    fireEvent.blur(textarea)
    fireEvent.click(screen.getByRole('button', { name: /resend/i }))

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageID: '2',
        userMessageContent: 'Updated prompt',
      }),
      expect.any(Object),
    )
  })
})
