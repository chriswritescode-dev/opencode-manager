import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MessagePart } from './MessagePart'
import { getFileApiUrl } from '@/api/files'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { applySessionEvent, emptySessionTranscript } from '@/lib/session-projection'
import { promptSequence } from '@/test/fixtures/session-projection'
import type {
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  useMobile: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/hooks/useMobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useMobile')>()),
  useMobile: mocks.useMobile,
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
    mocks.useMobile.mockReturnValue(false)
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

  it('opens local markdown links in a text part through onFileClick and external links in a new tab', () => {
    const onFileClick = vi.fn()
    renderWithProviders(
      <MessagePart
        part={textPart('[recap](recaps/daily-overview.html)\n\n[site](https://example.com)')}
        onFileClick={onFileClick}
      />,
    )

    fireEvent.click(screen.getByRole('link', { name: 'recap' }))
    expect(onFileClick).toHaveBeenCalledWith('recaps/daily-overview.html')

    const external = screen.getByRole('link', { name: 'site' })
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('strips unsafe raw HTML from a text part and keeps safe HTML', () => {
    const { container } = renderWithProviders(
      <MessagePart
        part={textPart(
          'Reply\n\n<iframe srcdoc="&lt;script&gt;parent.document.documentElement.dataset.chatProbe = 1&lt;/script&gt;"></iframe>\n\n<details><summary>Notes</summary>Body</details>',
        )}
      />,
    )

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(document.documentElement.dataset.chatProbe).toBeUndefined()
    expect(container.querySelector('details summary')?.textContent).toBe('Notes')
  })

  it('renders null for an empty text part', () => {
    const { container } = renderWithProviders(<MessagePart part={textPart('   ')} />)

    expect(container.firstChild).toBeNull()
  })

  describe('markdown images', () => {
    it('loads a relative image through the raw file API resolved against the directory', () => {
      renderWithProviders(
        <MessagePart part={textPart('![shot](docs/shot.png)')} directory="/workspace/repos/app" />,
      )

      expect(screen.getByAltText('shot')).toHaveAttribute(
        'src',
        getFileApiUrl('/workspace/repos/app/docs/shot.png', { params: { raw: true } }),
      )
    })

    it('loads an absolute image through the raw file API without a directory', () => {
      renderWithProviders(<MessagePart part={textPart('![a](/workspace/x/a.png)')} />)

      expect(screen.getByAltText('a')).toHaveAttribute(
        'src',
        getFileApiUrl('/workspace/x/a.png', { params: { raw: true } }),
      )
    })

    it('keeps data image sources from markdown and raw HTML', () => {
      renderWithProviders(
        <MessagePart
          part={textPart('![d](data:image/png;base64,aGVsbG8=)\n\n<img src="data:image/png;base64,aGVsbG8=" alt="raw">')}
        />,
      )

      expect(screen.getByAltText('d')).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
      expect(screen.getByAltText('raw')).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
    })

    it('keeps an external image source', () => {
      renderWithProviders(<MessagePart part={textPart('![h](https://example.com/a.png)')} />)

      expect(screen.getByAltText('h')).toHaveAttribute('src', 'https://example.com/a.png')
    })

    it('does not render a non-image data source', () => {
      const { container } = renderWithProviders(
        <MessagePart part={textPart('![x](data:text/html,hello)')} />,
      )

      expect(container.querySelector('img')).toBeNull()
    })

    it('renders a linked image without a nested expand button', () => {
      renderWithProviders(
        <MessagePart part={textPart('[![logo](https://example.com/a.png)](https://example.com)')} />,
      )

      const link = screen.getByRole('link')
      expect(within(link).getByAltText('logo')).toHaveAttribute('src', 'https://example.com/a.png')
      expect(within(link).queryByRole('button')).toBeNull()
    })

    it('renders an expand button for an unlinked image', () => {
      renderWithProviders(<MessagePart part={textPart('![logo](https://example.com/a.png)')} />)

      expect(screen.getByRole('button', { name: 'Expand image: logo' })).toBeInTheDocument()
    })
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

      const preview = screen.getByRole('button', { name: 'Show shell details' })
      expect(screen.getByText('git status')).toBeInTheDocument()

      fireEvent.click(preview)

      expect(screen.getByText('Output:')).toBeInTheDocument()
      expect(document.querySelector('pre')?.textContent).toBe('clean tree')
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

      fireEvent.click(screen.getByRole('button', { name: 'Show shell details' }))

      expect(screen.getByText('Preparing tool call...')).toBeInTheDocument()
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

      const preview = screen.getByRole('button', { name: 'Show shell details' })
      expect(screen.getByText('bun test')).toBeInTheDocument()

      fireEvent.click(preview)

      expect(document.querySelector('pre')?.textContent).toBe('12 tests passed')
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

    it('renders an ocm show_artifact tool in simpleChatMode', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

      renderWithProviders(
        <MessagePart
          part={toolPart('ocm', {
            status: 'completed',
            input: { action: 'show_artifact', params: { title: 'Report', path: 'reports/summary.html' } },
            content: [{ type: 'text', text: 'Artifact shown' }],
          })}
          messageID="msg_1"
          directory="/repo"
        />,
      )

      const iframe = screen.getByTitle('Report')
      expect(iframe.tagName).toBe('IFRAME')
      expect(iframe).toHaveAttribute('src', getFileApiUrl('/repo/reports/summary.html', { params: { raw: true } }))
    })

    it('renders an ocm show_artifact tool with an absolute path', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

      renderWithProviders(
        <MessagePart
          part={toolPart('ocm', {
            status: 'completed',
            input: { action: 'show_artifact', params: { title: 'Report', path: '/tmp/artifacts/report.html' } },
            content: [{ type: 'text', text: 'Artifact shown' }],
          })}
          messageID="msg_1"
        />,
      )

      const iframe = screen.getByTitle('Report')
      expect(iframe.tagName).toBe('IFRAME')
      expect(iframe).toHaveAttribute('src', getFileApiUrl('/tmp/artifacts/report.html', { params: { raw: true } }))
    })

    it('passes the resolved metadata path and repo mapping through to the artifact frame', () => {
      setupSettings({
        simpleChatMode: true,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

      renderWithProviders(
        <MessagePart
          part={toolPart('ocm', {
            status: 'completed',
            input: { action: 'show_artifact', params: { title: 'Report', path: 'reports/summary.html' } },
            content: [{ type: 'text', text: 'Artifact shown' }],
            metadata: { path: '/workspace/repos/assistant/reports/summary.html' },
          })}
          messageID="msg_1"
          directory="/workspace/repos/assistant"
          repoFullPath="/workspace/repos/assistant"
          repoLocalPath="assistant"
        />,
      )

      const iframe = screen.getByTitle('Report')
      expect(iframe.tagName).toBe('IFRAME')
      expect(iframe).toHaveAttribute('src', getFileApiUrl('assistant/reports/summary.html', { params: { raw: true } }))
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

      await vi.waitFor(() => expect(writeText).toHaveBeenCalled())
      expect(writeText).toHaveBeenCalledWith(output)
    })
  })

  describe('file tools', () => {
    it('renders a linked-server file name as plain text', () => {
      const onFileClick = vi.fn()
      const queryClient = new QueryClient()
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OpenCodeServerProvider serverId="srv_kitchen">
              <MessagePart
                part={toolPart('read', {
                  status: 'completed',
                  input: { path: '/srv/app/src/a.ts' },
                  content: [{ type: 'text', text: 'file contents' }],
                  metadata: {},
                })}
                onFileClick={onFileClick}
              />
            </OpenCodeServerProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      )

      const fileName = screen.getByText('/srv/app/src/a.ts')
      expect(fileName.className).not.toContain('cursor-pointer')
      expect(fileName.className).not.toContain('text-primary')

      fireEvent.click(fileName)

      expect(onFileClick).not.toHaveBeenCalled()
    })

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

      const header = screen.getByRole('button', { name: /Edit \/test\/file\.txt/ })
      expect(within(header).getByText('←')).toBeInTheDocument()
      expect(screen.getByText('/test/file.txt')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
      expect(screen.getByText('-1')).toBeInTheDocument()
      expect(screen.getByText('old')).toBeInTheDocument()
      expect(screen.getByText('new')).toBeInTheDocument()
    })

    it('previews the first changed lines of a long patch until the diff is opened', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: false,
      })

      const changedLines = Array.from({ length: 20 }, (_, index) => `+line ${index + 1}`).join('\n')

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
                  patch: `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1,20 @@\n${changedLines}`,
                  additions: 20,
                  deletions: 0,
                  status: 'modified',
                },
              ],
            },
          })}
        />,
      )

      const header = screen.getByRole('button', { name: /Edit \/test\/file\.txt/ })
      expect(within(header).getByText('←')).toBeInTheDocument()

      const preview = screen.getByRole('button', { name: 'Show diff for /test/file.txt' })
      expect(within(preview).getByText('line 1')).toBeInTheDocument()
      expect(within(preview).getByText('line 8')).toBeInTheDocument()
      expect(within(preview).queryByText('line 9')).toBeNull()
      expect(within(preview).getByText('1')).toBeInTheDocument()
      expect(within(preview).getByText('8')).toBeInTheDocument()
      expect(within(preview).queryByText('9')).toBeNull()
      expect(screen.getByText('(12 more lines)')).toBeInTheDocument()
      expect(screen.queryByText('line 20')).toBeNull()

      fireEvent.click(preview)

      expect(screen.queryByRole('button', { name: 'Show diff for /test/file.txt' })).toBeNull()
      expect(screen.getByText('line 9')).toBeInTheDocument()
      expect(screen.getByText('line 20')).toBeInTheDocument()
      expect(screen.getByText('20')).toBeInTheDocument()
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

    it('makes legacy filePath read, write, and filediff edit calls clickable', () => {
      const onFileClick = vi.fn()
      const legacy = (name: string, metadata: Record<string, unknown>) =>
        toolPart(name, {
          status: 'completed',
          input: { filePath: `/test/${name}.html` },
          content: [{ type: 'text', text: 'ok' }],
          metadata,
        })

      renderWithProviders(
        <>
          <MessagePart part={legacy('read', {})} onFileClick={onFileClick} />
          <MessagePart part={legacy('write', {})} onFileClick={onFileClick} />
          <MessagePart
            part={legacy('edit', { filediff: { file: '/test/edit.html', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 } })}
            onFileClick={onFileClick}
          />
        </>,
      )

      fireEvent.click(screen.getByText('/test/read.html'))
      fireEvent.click(screen.getByText('/test/write.html'))
      fireEvent.click(screen.getByText('/test/edit.html'))

      expect(onFileClick.mock.calls.map(([filePath]) => filePath)).toEqual(['/test/read.html', '/test/write.html', '/test/edit.html'])
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('falls back to filePath when path is empty', () => {
      const onFileClick = vi.fn()
      renderWithProviders(
        <MessagePart
          part={toolPart('read', {
            status: 'completed',
            input: { path: '', filePath: '/test/fallback.html' },
            content: [{ type: 'text', text: 'ok' }],
            metadata: {},
          })}
          onFileClick={onFileClick}
        />,
      )

      fireEvent.click(screen.getByText('/test/fallback.html'))

      expect(onFileClick).toHaveBeenCalledWith('/test/fallback.html')
    })

    it('renders every file of a multi-file patch with per-file links', () => {
      setupSettings({
        simpleChatMode: false,
        showReasoning: false,
        expandToolCalls: false,
        expandDiffs: true,
      })

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

      expect(screen.getByRole('button', { name: /Patch src\/a\.ts/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Patch src\/b\.ts/ })).toBeInTheDocument()
      expect(screen.getByText('old-a')).toBeInTheDocument()
      expect(screen.getByText('old-b')).toBeInTheDocument()

      fireEvent.click(screen.getByText('src/a.ts'))
      expect(onFileClick).toHaveBeenCalledWith('src/a.ts')
      fireEvent.click(screen.getByText('src/b.ts'))
      expect(onFileClick).toHaveBeenCalledWith('src/b.ts')

      fireEvent.click(screen.getByRole('button', { name: /Patch src\/a\.ts/ }))

      expect(screen.getByRole('button', { name: 'Show diff for src/a.ts' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show diff for src/b.ts' })).toBeNull()
    })

    it('syntax highlights added rows with the themed diff tints', () => {
      const { container } = renderWithProviders(
        <MessagePart
          part={toolPart('edit', {
            status: 'completed',
            input: { path: '/test/file.ts' },
            content: [{ type: 'text', text: 'edited' }],
            metadata: {
              files: [
                {
                  file: '/test/file.ts',
                  patch: '@@ -1 +1,2 @@\n const value = 1\n+const added = 2',
                  additions: 1,
                  deletions: 0,
                  status: 'modified',
                },
              ],
            },
          })}
        />,
      )

      const addedRow = container.querySelector('[class*="bg-diff-add/15"]')
      expect(addedRow).not.toBeNull()
      expect(addedRow?.querySelector('.hljs-keyword')?.textContent).toBe('const')
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
