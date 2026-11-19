import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { UserPreferences } from '@/api/types/settings'
import { MessageThread } from './MessageThread'
import { useUIState } from '@/stores/uiStateStore'
import { applySessionEvent, emptySessionTranscript } from '@/lib/session-projection'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import {
  SESSION_ID,
  compactionSequence,
  promptSequence,
  shellSequence,
} from '@/test/fixtures/session-projection'
import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  V2Event,
} from '@opencode-manager/shared/opencode'

let preferencesFixture: Partial<UserPreferences> = {}

const setupSettings = (preferences: Partial<UserPreferences>) => {
  preferencesFixture = preferences
}

const renderThread = (ui: ReactElement) => {
  const preferences = makeUserPreferences(preferencesFixture)
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['settings', 'default'], makeSettingsResponse({ preferences }))
  return renderWithProviders(ui, {
    tts: true,
    queryClient,
    fetchRoutes: [
      { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences }) }) },
      { method: 'GET', path: '/api/opencode/api/session/:sessionId', respond: () => ({ json: { id: 'test-session', projectID: 'proj_1', time: { created: 1, updated: 1 } } }) },
      { method: 'GET', path: '/api/opencode/api/agent', respond: () => ({ json: { data: [] } }) },
      { method: 'POST', path: '/api/opencode/api/session/:sessionId/interrupt', respond: () => ({ json: {} }) },
      { method: 'POST', path: '/api/opencode/api/experimental/session/:sessionId/wait', respond: () => ({ status: 204 }) },
      { method: 'POST', path: '/api/opencode/api/session/:sessionId/revert/stage', respond: () => ({ json: { messageID: '2' } }) },
      { method: 'POST', path: '/api/opencode/api/session/:sessionId/revert/commit', respond: () => ({ status: 204 }) },
      { method: 'POST', path: '/api/opencode/api/session/:sessionId/agent', respond: () => ({ status: 204 }) },
      { method: 'POST', path: '/api/opencode/api/session/:sessionId/model', respond: () => ({ status: 204 }) },
      {
        method: 'POST',
        path: '/api/opencode/api/session/:sessionId/prompt',
        respond: () => ({ json: { id: 'inbox_1', sessionID: 'test-session', type: 'user', payload: { text: '' }, time: { created: 1 } } }),
      },
    ],
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

const readTool = (id: string, path: string): SessionMessageAssistantTool => ({
  type: 'tool',
  id,
  name: 'read',
  state: { status: 'completed', input: { path }, content: [{ type: 'text', text: 'contents' }], metadata: {} },
  time: { created: Date.now(), ran: Date.now(), completed: Date.now() + 100 },
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
    useUIState.getState().setIsEditingMessage(false)
  })

  it('collapses consecutive exploration tools into one expandable summary', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })
    const messages = [
      assistantMessage('1', [readTool('r1', '/repo/a.ts'), readTool('r2', '/repo/b.ts'), shellTool('pnpm test')]),
    ]

    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    const summary = screen.getByRole('button', { name: /Explored: 2 reads/ })
    expect(screen.queryByText('/repo/a.ts')).not.toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()

    fireEvent.click(summary)

    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('/repo/a.ts')).toBeInTheDocument()
    expect(screen.getByText('/repo/b.ts')).toBeInTheDocument()
  })

  it('renders exploration tools individually when grouping is disabled', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false, groupToolCalls: false })
    const messages = [assistantMessage('1', [readTool('r1', '/repo/a.ts'), readTool('r2', '/repo/b.ts')])]

    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    expect(screen.queryByText(/Explored/)).not.toBeInTheDocument()
    expect(screen.getByText('/repo/a.ts')).toBeInTheDocument()
  })

  it('renders instruction updates as a single notice line without the instruction body', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages: SessionMessageInfo[] = [
      { id: 'sys-1', type: 'system', text: '# Code Mode\nfull instruction body', time: { created: Date.now() } },
      {
        id: 'sys-2',
        type: 'system',
        text: 'agents body',
        description: 'Instructions updated: AGENTS.md',
        time: { created: Date.now() },
      },
    ]

    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    expect(screen.getByText(/Instructions updated$/)).toBeInTheDocument()
    expect(screen.getByText(/Instructions updated: AGENTS\.md/)).toBeInTheDocument()
    expect(screen.queryByText(/full instruction body/)).not.toBeInTheDocument()
    expect(screen.queryByText(/agents body/)).not.toBeInTheDocument()
  })

  it('renders background completion notices as status lines instead of raw payloads', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const onChildSessionClick = vi.fn()
    const messages: SessionMessageInfo[] = [
      {
        id: 'syn-shell',
        type: 'synthetic',
        text: '<shell id="job-1" state="error" command="pnpm test">\nboom\n</shell>',
        description: 'pnpm   test',
        metadata: { source: 'shell', state: 'error' },
        time: { created: Date.now() },
      },
      {
        id: 'syn-subagent',
        type: 'synthetic',
        text: '<subagent sessionID="child-1" state="completed" description="Explore">\ndone\n</subagent>',
        description: 'Explore',
        metadata: { source: 'subagent', state: 'completed', childID: 'child-1', agent: 'explore' },
        time: { created: Date.now() },
      },
    ]

    renderThread(
      <MessageThread
        sessionID="test-session"
        messages={messages}
        pending={[]}
        onChildSessionClick={onChildSessionClick}
      />,
    )

    expect(screen.getByText('! Shell failed')).toBeInTheDocument()
    expect(screen.getByText('· pnpm test')).toBeInTheDocument()
    expect(screen.queryByText(/<shell/)).not.toBeInTheDocument()
    expect(screen.queryByText(/<subagent/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('↳ Explore finished'))
    expect(onChildSessionClick).toHaveBeenCalledWith('child-1')
  })

  it('resolves a background shell tool from its completion notice', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages: SessionMessageInfo[] = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [
        {
          type: 'tool',
          id: 'tool_shell',
          name: 'shell',
          state: {
            status: 'completed',
            input: { command: 'npm run dev' },
            content: [{ type: 'text', text: 'started in the background' }],
            metadata: { status: 'running', shellID: 'sh_notice' },
          },
          time: { created: Date.now(), completed: Date.now() + 100 },
        },
      ]),
      {
        id: 'syn-shell',
        type: 'synthetic',
        text: '',
        metadata: { source: 'shell', shellID: 'sh_notice', state: 'completed', exit: 0 },
        time: { created: Date.now() },
      },
    ]

    const { container } = renderThread(
      <MessageThread sessionID="test-session" messages={messages} pending={[]} />,
    )

    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('renders a synthetic message that only carries text', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages: SessionMessageInfo[] = [
      { id: 'syn-text', type: 'synthetic', text: 'Background task finished', time: { created: Date.now() } },
    ]

    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    expect(screen.getByText(/Background task finished/)).toBeInTheDocument()
  })

  it('renders assistant message with only a subagent part as standalone row without header', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [subagentTool('Review changes', 'child-session')]),
    ]

    renderThread(
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

    const { container } = renderThread(
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

    renderThread(
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

    renderThread(
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

    const { container } = renderThread(
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

    renderThread(
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

    renderThread(
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

    renderThread(
      <MessageThread
        sessionID="test-session"
        messages={[userMessage('1', 'Hello')]}
        pending={[]}
      />,
    )

    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('renders the assistant footer with agent, model, and duration', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    renderThread(
      <MessageThread
        sessionID="test-session"
        messages={[
          assistantMessage('2', [textPart('Done')], {
            agent: 'build',
            time: { created: 0, completed: 93_000 },
          }),
        ]}
        pending={[]}
      />,
    )

    expect(screen.getByText('Build')).toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()
    expect(screen.getByText('1m 33s')).toBeInTheDocument()
  })

  it('exposes the message id on a rendered user message', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const { container } = renderThread(
      <MessageThread
        sessionID="test-session"
        messages={[userMessage('user-42', 'Hello')]}
        pending={[]}
      />,
    )

    expect(container.querySelector('[data-message-id="user-42"]')).not.toBeNull()
  })

  it('renders image attachments as thumbnails and other files as chips', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages: SessionMessageInfo[] = [
      {
        id: 'user-attachments',
        type: 'user',
        text: 'Look at these',
        files: [
          { data: 'aGVsbG8=', mime: 'image/png', source: { type: 'inline' }, name: 'shot.png' },
          { data: 'dGV4dA==', mime: 'text/plain', source: { type: 'inline' }, name: 'notes.txt' },
        ],
        time: { created: Date.now() },
      },
    ]

    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    const image = screen.getByAltText('shot.png')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
    expect(screen.getByText('@')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('renders a projected shell message from the fixtures', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    renderThread(
      <MessageThread
        sessionID={SESSION_ID}
        messages={project(shellSequence)}
        pending={[]}
      />,
    )

    expect(screen.getByText('bun test')).toBeInTheDocument()
    expect(screen.getByText('12 tests passed')).toBeInTheDocument()
  })

  it('collapses a long shell output behind the preview and reveals it on click', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const lines = Array.from({ length: 25 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}`)
    const output = lines.join('\n')
    const messages: SessionMessageInfo[] = [
      {
        id: 'shell-long',
        type: 'shell',
        shellID: 'sh_long',
        command: 'seq 25',
        status: 'exited',
        exit: 0,
        output: { output, cursor: output.length, size: output.length, truncated: false },
        time: { created: Date.now() },
      },
    ]

    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    expect(screen.getByText('(15 earlier lines)')).toBeInTheDocument()
    expect(screen.getByText(/line-25/)).toBeInTheDocument()
    expect(screen.queryByText(/line-01/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show shell details' }))

    expect(screen.getByText(/line-01/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy output' })).toBeInTheDocument()
  })

  it('renders a projected compaction banner from the fixtures', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    renderThread(
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

    renderThread(
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

    renderThread(
      <MessageThread
        sessionID="test-session"
        messages={[userMessage('1', 'Hello')]}
        pending={pending}
      />,
    )

    expect(screen.getByText('Wait for me')).toBeInTheDocument()
    expect(screen.getByText('QUEUED')).toBeInTheDocument()
  })

  it('renders step file changes from the assistant snapshot and opens clicked files', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })
    const onFileClick = vi.fn()

    renderThread(
      <MessageThread
        sessionID="test-session"
        messages={[
          assistantMessage('2', [textPart('Updated files')], {
            snapshot: { start: 'aaa', end: 'bbbbbbbbcccc', files: ['/workspace/repos/app/src/a.ts'] },
          }),
        ]}
        pending={[]}
        onFileClick={onFileClick}
      />,
    )

    expect(screen.getByText('File Changes (1 file)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('app/src/a.ts'))
    expect(onFileClick).toHaveBeenCalledWith('/workspace/repos/app/src/a.ts')
  })

  it('hides step file changes in simple chat mode', () => {
    setupSettings({ simpleChatMode: true, showReasoning: false })

    renderThread(
      <MessageThread
        sessionID="test-session"
        messages={[
          assistantMessage('2', [textPart('Updated files')], {
            snapshot: { files: ['/workspace/repos/app/src/a.ts'] },
          }),
        ]}
        pending={[]}
      />,
    )

    expect(screen.queryByText(/File Changes/)).not.toBeInTheDocument()
  })

  it('omits the agent name from the assistant footer in simple chat mode', () => {
    const messages = [assistantMessage('2', [textPart('Updated files')], { agent: 'build' })]

    setupSettings({ simpleChatMode: true, showReasoning: false })
    const simple = renderThread(
      <MessageThread sessionID="test-session" messages={messages} pending={[]} />,
    )

    expect(screen.queryByText('Build')).not.toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()

    simple.unmount()

    setupSettings({ simpleChatMode: false, showReasoning: false })
    renderThread(<MessageThread sessionID="test-session" messages={messages} pending={[]} />)

    expect(screen.getByText('Build')).toBeInTheDocument()
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('shows the empty state when there are no messages or pending prompts', () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    renderThread(
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

    const { unmount } = renderThread(
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

  it('resends an edited prompt after the edit textarea blurs', async () => {
    setupSettings({ simpleChatMode: false, showReasoning: false })

    const messages = [
      userMessage('1', 'Hello'),
      assistantMessage('2', [textPart('This is a response')]),
    ]

    const { fetchFake } = renderThread(
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

    await waitFor(() => {
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
        text: 'Updated prompt',
      })
    })
  })
})
