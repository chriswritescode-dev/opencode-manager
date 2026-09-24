import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageThread } from './MessageThread'
import { useUIState } from '@/stores/uiStateStore'
import { applySessionEvent, emptySessionTranscript } from '@/lib/session-projection'
import {
  SESSION_ID,
  compactionSequence,
  promptSequence,
  shellSequence,
} from '@/lib/session-projection/fixtures'
import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  V2Event,
} from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  useRefreshMessage: vi.fn(),
  useSessionAgent: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/hooks/useRemoveMessage', () => ({
  useRefreshMessage: () => mocks.useRefreshMessage(),
}))

vi.mock('@/hooks/useSessionAgent', () => ({
  useSessionAgent: () => mocks.useSessionAgent(),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: () => ({
    speakMessage: vi.fn(),
    stop: vi.fn(),
    isEnabled: false,
    isPlaying: false,
    isLoading: false,
    activeMessageId: null,
  }),
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

const project = (events: V2Event[]): SessionMessageInfo[] =>
  events.reduce(applySessionEvent, emptySessionTranscript).messages

const assistantMessage = (
  id: string,
  content: SessionMessageAssistant['content'],
  extra: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'test-agent',
  model: { providerID: 'test-provider', id: 'test-model' },
  content,
  time: { created: Date.now(), completed: Date.now() + 100 },
  ...extra,
})

const userMessage = (id: string, text: string): SessionMessageUser => ({
  id,
  type: 'user',
  text,
  time: { created: Date.now() },
})

const subagentTool = (description: string, sessionID?: string): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 'tool_subagent',
  name: 'subagent',
  state: {
    status: 'completed',
    input: { description },
    content: [{ type: 'text', text: 'done' }],
    metadata: sessionID ? { sessionID } : {},
  },
  time: { created: Date.now(), completed: Date.now() + 100 },
})

const textPart = (text: string): SessionMessageAssistant['content'][number] => ({ type: 'text', text })

const reasoningPart = (text: string): SessionMessageAssistant['content'][number] => ({ type: 'reasoning', text })

const shellTool = (command: string): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 'tool_shell',
  name: 'shell',
  state: {
    status: 'completed',
    input: { command },
    content: [{ type: 'text', text: 'ok' }],
    metadata: {},
  },
  time: { created: Date.now(), completed: Date.now() + 100 },
})

describe('MessageThread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useRefreshMessage.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    })
    mocks.useSessionAgent.mockReturnValue({ agent: 'test-agent' })
    useUIState.getState().setIsEditingMessage(false)
  })

  it('renders assistant message with only a subagent part as standalone row without header', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [subagentTool('Review changes', 'child-session')]),
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
    )

    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()
    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
  })

  it('renders a subagent row that links to the child session', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const onChildSessionClick = vi.fn()
    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [subagentTool('Explore codebase structure', 'child-session')]),
    ]

    const { container } = render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
        onChildSessionClick={onChildSessionClick}
      />,
    )

    expect(screen.getByText('Explore codebase structure')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()

    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onChildSessionClick).toHaveBeenCalledWith('child-session')
  })

  it('renders assistant message with text normally with header', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [textPart('This is a response')]),
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
    )

    expect(screen.getByText('This is a response')).toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('renders assistant message with text and subagent normally with header', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [
        textPart('Here is the analysis'),
        subagentTool('Review changes', 'child-session'),
      ]),
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
    )

    expect(screen.getByText('Here is the analysis')).toBeInTheDocument()
    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('renders reasoning, shell, and subagent entries in order for a textless assistant', () => {
    setupSettings({ simpleChatMode: false, showReasoning: true })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [
        reasoningPart('Thinking it over'),
        shellTool('bun test'),
        subagentTool('Review changes', 'child-session'),
      ]),
    ]

    const { container } = render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
    )

    expect(screen.getByText('Thinking it over')).toBeInTheDocument()
    expect(screen.getByText('bun test')).toBeInTheDocument()
    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('sub-agent')).toBeInTheDocument()

    const text = container.textContent ?? ''
    expect(text.indexOf('Thinking it over')).toBeLessThan(text.indexOf('bun test'))
    expect(text.indexOf('bun test')).toBeLessThan(text.indexOf('Review changes'))
  })

  it('keeps an assistant error visible after a subagent call', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [subagentTool('Review changes', 'child-session')], {
        error: { type: 'provider.auth', message: 'invalid key' },
      }),
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
    )

    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('Provider authentication failed')).toBeInTheDocument()
    expect(screen.getByText('invalid key')).toBeInTheDocument()
  })

  it('keeps an assistant retry visible after a subagent call', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [subagentTool('Review changes', 'child-session')], {
        retry: {
          attempt: 2,
          at: Date.now() + 60000,
          error: { type: 'provider.rate-limit', message: 'slow down' },
        },
      }),
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
    )

    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText('Retry attempt 2')).toBeInTheDocument()
    expect(screen.getByText('slow down')).toBeInTheDocument()
  })

  it('renders user messages normally', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    render(
      <MessageThread
        sessionID="test-session"
        messages={[userMessage('1', 'Hello')]}
        pending={[]}
      />,
    )

    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('renders a projected shell message from the fixtures', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    render(
      <MessageThread
        sessionID={SESSION_ID}
        messages={project(shellSequence)}
        pending={[]}
      />,
    )

    expect(screen.getByText('bun test')).toBeInTheDocument()
    expect(screen.getByText('12 tests passed')).toBeInTheDocument()
  })

  it('renders a projected compaction banner from the fixtures', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    render(
      <MessageThread
        sessionID={SESSION_ID}
        messages={project(compactionSequence)}
        pending={[]}
      />,
    )

    expect(screen.getByText('Session compacted')).toBeInTheDocument()
    expect(screen.getByText('Summarizing the previous turn.')).toBeInTheDocument()
  })

  it('renders a projected assistant transcript from the fixtures', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    render(
      <MessageThread
        sessionID={SESSION_ID}
        messages={project(promptSequence)}
        pending={[]}
      />,
    )

    expect(screen.getByText('Run the tests')).toBeInTheDocument()
    expect(screen.getByText('Running the tests now.')).toBeInTheDocument()
  })

  it('renders queued prompts before delivery', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const pending: SessionInboxUser[] = [
      {
        id: 'inbox_1',
        sessionID: 'test-session',
        type: 'user',
        payload: { text: 'Wait for me' },
        delivery: 'queue',
        time: { created: Date.now() },
      },
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={[userMessage('1', 'Hello')]}
        pending={pending}
      />,
    )

    expect(screen.getByText('Wait for me')).toBeInTheDocument()
    expect(screen.getByText('QUEUED')).toBeInTheDocument()
  })

  it('shows the empty state when there are no messages or pending prompts', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    render(
      <MessageThread
        sessionID="test-session"
        messages={[]}
        pending={[]}
      />,
    )

    expect(screen.getByText('No messages yet. Start a conversation below.')).toBeInTheDocument()
  })

  it('keeps global editing state active when edit textarea blurs', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [textPart('This is a response')]),
    ]

    const { unmount } = render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
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
    setupSettings({ simpleChatMode: false, showReasoning: false })
    const mutate = vi.fn()
    mocks.useRefreshMessage.mockReturnValue({
      isPending: false,
      mutate,
    })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [textPart('This is a response')]),
    ]

    render(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
      />,
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
