import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MessagePart } from './MessagePart'
import { applySessionEvent, emptySessionTranscript } from '@/lib/session-projection'
import { promptSequence } from '@/test/fixtures/session-projection'
import type {
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

interface MockSettingsReturn {
  preferences: {
    simpleChatMode: boolean
    showReasoning: boolean
    expandToolCalls: boolean
    expandDiffs: boolean
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

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const textPart = (text: string): SessionMessageAssistantText => ({ type: 'text', text })

const reasoningPart = (text: string): SessionMessageAssistantReasoning => ({ type: 'reasoning', text })

const toolPart = (
  name: string,
  state: SessionMessageAssistantTool['state'],
  time: SessionMessageAssistantTool['time'] = { created: Date.now() },
): SessionMessageAssistantTool => ({
  type: 'tool',
  id: `tool_${name}`,
  name,
  state,
  time,
})

const completedShell = (
  input: Record<string, unknown>,
  content: string,
  metadata: Record<string, unknown> = {},
): SessionMessageAssistantTool =>
  toolPart('shell', {
    status: 'completed',
    input,
    content: [{ type: 'text', text: content }],
    metadata,
  })

describe('MessagePart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupSettings({
      simpleChatMode: false,
      showReasoning: false,
      expandToolCalls: false,
      expandDiffs: true,
    })
  })

  it('renders a text part', () => {
    renderWithProviders(<MessagePart part={textPart('Hello, this is a text message')} />)

    expect(screen.getByText('Hello, this is a text message')).toBeInTheDocument()
  })

  it('renders null for an empty text part', () => {
    const { container } = renderWithProviders(<MessagePart part={textPart('   ')} />)

    expect(container.firstChild).toBeNull()
  })

  describe('reasoning', () => {
    it('renders null when showReasoning is false', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

      const { container } = renderWithProviders(<MessagePart part={reasoningPart('This is the reasoning text')} />)

      expect(container.firstChild).toBeNull()
    })

    it('renders the reasoning part when showReasoning is true', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: true,
        expandToolCalls: false,
        expandDiffs: true,
      })

      renderWithProviders(<MessagePart part={reasoningPart('This is the reasoning text')} />)

      expect(screen.getByText('Reasoning')).toBeInTheDocument()
      expect(screen.getByText('This is the reasoning text')).toBeInTheDocument()
    })

    it('renders null in simpleChatMode even when showReasoning is true', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: true,
        expandToolCalls: false,
        expandDiffs: true,
      })

      const { container } = renderWithProviders(<MessagePart part={reasoningPart('This is the reasoning text')} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('tool parts', () => {
    it('renders a completed shell tool with its output', () => {
      renderWithProviders(<MessagePart part={completedShell({ command: 'git status' }, 'clean tree')} />)

      expect(screen.getByText('shell')).toBeInTheDocument()
      expect(screen.getByText('git status')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('clean tree')).toBeInTheDocument()
    })

    it('renders a running shell tool with its command', () => {
      renderWithProviders(
        <MessagePart
          part={toolPart('shell', { status: 'running', input: { command: 'bun test' }, metadata: {} })}
        />,
      )

      expect(screen.getByText('bun test')).toBeInTheDocument()
    })

    it('renders a streaming tool with a preparing state', () => {
      renderWithProviders(<MessagePart part={toolPart('shell', { status: 'streaming', input: '' })} />)

      expect(screen.getByText('shell')).toBeInTheDocument()
    })

    it('renders an error tool with the error message', () => {
      renderWithProviders(
        <MessagePart
          part={toolPart('shell', {
            status: 'error',
            input: { command: 'bun test' },
            error: { type: 'tool.failed', message: 'command exited 1' },
          })}
        />,
      )

      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('command exited 1')).toBeInTheDocument()
    })

    it('renders a tool part projected from the shared fixtures', () => {
      const transcript = promptSequence.reduce(applySessionEvent, emptySessionTranscript)
      const assistant = transcript.messages.find((message) => message.type === 'assistant')
      const projected = assistant?.type === 'assistant'
        ? assistant.content.find((part) => part.type === 'tool')
        : undefined

      expect(projected).toBeDefined()

      renderWithProviders(<MessagePart part={projected!} />)

      expect(screen.getByText('shell')).toBeInTheDocument()
      expect(screen.getByText('bun test')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('12 tests passed')).toBeInTheDocument()
    })

    it('renders null for a non-subagent tool in simpleChatMode', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

      const { container } = renderWithProviders(
        <MessagePart part={completedShell({ command: 'git status' }, 'clean')} />,
      )

      expect(container.firstChild).toBeNull()
    })

    it('renders the subagent tool in simpleChatMode', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

      const onChildSessionClick = vi.fn()
      renderWithProviders(
        <MessagePart
          part={toolPart('subagent', {
            status: 'completed',
            input: { description: 'Review changes' },
            content: [{ type: 'text', text: 'done' }],
            metadata: { sessionID: 'child-session' },
          })}
          onChildSessionClick={onChildSessionClick}
        />,
      )

      expect(screen.getByText('Review changes')).toBeInTheDocument()
      expect(screen.getByText('sub-agent')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button'))
      expect(onChildSessionClick).toHaveBeenCalledWith('child-session')
    })
  })

  describe('sandbox indicator', () => {
    const wrapped =
      "'/usr/local/bin/msb' exec ocm-workspace --no-tty -q -u '1001:1001' -w '/workspace/repos/ai-test' --timeout 600s -- sh -c 'git status'"

    it('shows the sandbox badge for a completed shell call the sandbox plugin marked', () => {
      renderWithProviders(<MessagePart part={completedShell({ command: 'git status' }, 'ok', { sandbox: true })} />)

      expect(screen.getByText('sandbox')).toBeInTheDocument()
      expect(screen.getByText('git status')).toBeInTheDocument()
    })

    it('shows the sandbox badge and unwrapped command for a legacy recorded sandbox call', () => {
      renderWithProviders(<MessagePart part={completedShell({ command: wrapped }, 'ok')} />)

      expect(screen.getByText('sandbox')).toBeInTheDocument()
      expect(screen.getByText('git status')).toBeInTheDocument()
      expect(screen.queryByText(/msb/)).toBeNull()
    })

    it('omits the sandbox badge for a host shell call', () => {
      renderWithProviders(<MessagePart part={completedShell({ command: 'git status' }, 'ok')} />)

      expect(screen.queryByText('sandbox')).toBeNull()
      expect(screen.getByText('git status')).toBeInTheDocument()
    })
  })

  describe('tool output clamping', () => {
    const expandTool = () => {
      fireEvent.click(screen.getByRole('button'))
    }

    it('renders small output in full without omission marker', () => {
      const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
      renderWithProviders(<MessagePart part={completedShell({ command: 'echo big' }, output)} />)

      expandTool()

      expect(output).not.toContain('omitted')
      const pre = document.querySelector('pre')!
      expect(pre.textContent).toBe(output)
      expect(screen.queryByText(/omitted/)).toBeNull()
    })

    it('clamps very large output with a marker and keeps head and tail', () => {
      const lines: string[] = []
      for (let i = 0; lines.join('\n').length < 200_000; i++) {
        lines.push(`line-${i} ${'x'.repeat(80)} marker-start-${i === 0 ? 'FIRST' : ''}${i === 0 ? 'FIRST-marker-end' : ''}`)
      }
      const output = lines.join('\n')
      const startMarker = 'marker-start-FIRST'
      const endContent = `line-${lines.length - 1}`

      renderWithProviders(<MessagePart part={completedShell({ command: 'echo big' }, output)} />)

      expandTool()

      expect(screen.queryByText(/omitted/)).not.toBeNull()
      const pre = document.querySelector('pre')!
      const rendered = pre.textContent ?? ''
      expect(rendered).toContain('omitted — use the copy button for the full output')
      expect(rendered.length).toBeLessThan(35_000)
      expect(output.startsWith(rendered.split('\n')[0])).toBe(true)
      expect(rendered).toContain(endContent)
      expect(rendered).toContain(startMarker)
    })

    it('copies the full unclamped output via the copy button', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      const lines: string[] = []
      for (let i = 0; lines.join('\n').length < 200_000; i++) {
        lines.push(`line-${i} ${'y'.repeat(80)}`)
      }
      const output = lines.join('\n')

      renderWithProviders(<MessagePart part={completedShell({ command: 'echo big' }, output)} />)

      expandTool()

      const copyButton = screen.getByTitle('Copy output')
      fireEvent.click(copyButton)

      await expect(vi.waitFor(() => writeText.mock.calls[0]?.[0])).resolves.toBe(output)
    })
  })

  describe('file tools', () => {
    it('renders an edit tool diff', () => {
      renderWithProviders(
        <MessagePart
          part={toolPart('edit', {
            status: 'completed',
            input: { path: '/test/file.txt' },
            content: [{ type: 'text', text: 'edited' }],
            metadata: {
              files: [
                {
                  file: '/test/file.txt',
                  patch: '@@ -1 +1 @@\n-old\n+new',
                  additions: 1,
                  deletions: 1,
                  status: 'modified',
                },
              ],
            },
          })}
        />,
      )

      expect(screen.getByText('/test/file.txt')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
      expect(screen.getByText('-1')).toBeInTheDocument()
    })

    it('renders a write tool with its file path', () => {
      renderWithProviders(
        <MessagePart
          part={toolPart('write', {
            status: 'completed',
            input: { path: '/test/file.txt', content: 'hello' },
            content: [{ type: 'text', text: 'Wrote file successfully' }],
            metadata: {},
          })}
        />,
      )

      expect(screen.getByText('/test/file.txt')).toBeInTheDocument()
    })

    it('renders every file of a multi-file patch with per-file links', () => {
      const onFileClick = vi.fn()
      renderWithProviders(
        <MessagePart
          part={toolPart('patch', {
            status: 'completed',
            input: { patchText: '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch' },
            content: [{ type: 'text', text: 'Success. Updated the following files:\nM src/a.ts\nM src/b.ts' }],
            metadata: {
              files: [
                { file: 'src/a.ts', patch: '@@ -1 +1 @@\n-old-a\n+new-a', additions: 1, deletions: 1, status: 'modified' },
                { file: 'src/b.ts', patch: '@@ -1 +1 @@\n-old-b\n+new-b', additions: 2, deletions: 3, status: 'modified' },
              ],
            },
          })}
          onFileClick={onFileClick}
        />,
      )

      expect(screen.getByText('src/a.ts')).toBeInTheDocument()
      expect(screen.getByText('src/b.ts')).toBeInTheDocument()

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
      fireEvent.click(buttons[0])
      fireEvent.click(buttons[1])

      expect(screen.getByText('+new-a')).toBeInTheDocument()
      expect(screen.getByText('+new-b')).toBeInTheDocument()

      fireEvent.click(screen.getByText('src/a.ts'))
      expect(onFileClick).toHaveBeenCalledWith('src/a.ts')
      fireEvent.click(screen.getByText('src/b.ts'))
      expect(onFileClick).toHaveBeenCalledWith('src/b.ts')
    })

    it('falls back to the generic tool output when a patch has no diff metadata', () => {
      renderWithProviders(
        <MessagePart
          part={toolPart('patch', {
            status: 'completed',
            input: { patchText: 'not a patch' },
            content: [{ type: 'text', text: 'patch verification failed' }],
            metadata: {},
          })}
        />,
      )

      expect(screen.getByText('patch')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('patch verification failed')).toBeInTheDocument()
    })
  })
})
