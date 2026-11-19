import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { FormInfo, PermissionRequest, SessionInfo, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import type { JsonObject, JsonValue } from '@opencode-manager/shared/utils'
import { ToolCallPart } from './ToolCallPart'
import { getFileApiUrl } from '@/api/files'
import type { ShellInfo } from '@/api/opencode'
import { useUserBash } from '@/stores/userBashStore'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { connectTestEventStream, renderWithProviders } from '@/test/render'
import { makeRepo, makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { permissionAsked } from '@/test/fixtures/events'
import { appRoutes } from '@/test/fixtures/appRoutes'
import type { FetchRoute } from '@/test/fetchFake'

interface RenderOptions {
  expandToolCalls?: boolean
  shells?: ShellInfo[]
  sessions?: SessionInfo[]
  permission?: PermissionRequest
  form?: FormInfo
}

const repo = makeRepo({ id: 1, fullPath: '/repo' })

async function renderTool(ui: ReactElement, options: RenderOptions = {}) {
  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/settings',
      respond: () => ({
        json: makeSettingsResponse({
          preferences: makeUserPreferences({ expandToolCalls: options.expandToolCalls ?? false }),
        }),
      }),
    },
    ...appRoutes({
      repos: [repo],
      shells: options.shells ?? [],
      sessions: options.sessions ?? [],
    }),
  ]
  const events = options.permission !== undefined || options.form !== undefined
  const result = renderWithProviders(ui, {
    auth: events ? 'authenticated' : false,
    theme: false,
    toaster: events,
    events,
    fetchRoutes: routes,
  })
  if (events) {
    await connectTestEventStream(result.eventStream)
    act(() => {
      if (options.permission) {
        result.eventStream?.message(permissionAsked(options.permission, { directory: repo.fullPath }))
      }
      if (options.form) {
        result.eventStream?.message({
          id: 'evt_form',
          created: 1,
          type: 'form.created',
          data: { form: options.form },
          directory: repo.fullPath,
        })
      }
    })
    await act(async () => {
      await Promise.resolve()
    })
  }
  return result
}

const runningShell = (): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 'call_1',
  name: 'shell',
  time: { created: 1, ran: 2 },
  state: { status: 'running', input: { command: 'git status' }, metadata: {} },
})

const permissionFor = (source: PermissionRequest['source']): PermissionRequest => ({
  id: 'permission_1',
  sessionID: 'ses_1',
  action: 'shell',
  resources: ['git status'],
  source,
})

describe('ToolCallPart permission indicator', () => {
  it('shows the waiting permission state for a matching tool call', async () => {
    await renderTool(<ToolCallPart part={runningShell()} messageID="msg_1" />, {
      expandToolCalls: true,
      permission: permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_1' }),
    })

    expect(await screen.findByText('awaiting permission')).toBeInTheDocument()
    expect(await screen.findByText('Waiting for permission...')).toBeInTheDocument()
  })

  it.each([
    { name: 'without a pending permission', permission: undefined },
    {
      name: 'for another tool call id',
      permission: permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_other' }),
    },
    {
      name: 'for another message',
      permission: permissionFor({ type: 'tool', messageID: 'msg_other', id: 'call_1' }),
    },
  ])('does not show the waiting permission state $name', async ({ permission }) => {
    await renderTool(<ToolCallPart part={runningShell()} messageID="msg_1" />, { permission })

    expect(screen.queryByText('awaiting permission')).not.toBeInTheDocument()
    expect(screen.queryByText('Waiting for permission...')).not.toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('does not show the waiting permission state while the tool call is still streaming', async () => {
    await renderTool(
      <ToolCallPart
        part={{ ...runningShell(), state: { status: 'streaming', input: '' } }}
        messageID="msg_1"
      />,
      { permission: permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_1' }) },
    )

    expect(screen.queryByText('awaiting permission')).not.toBeInTheDocument()
  })
})

describe('ToolCallPart background indicator', () => {
  const completedShell = (metadata: JsonObject): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_2',
    name: 'shell',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { command: 'npm run dev' },
      content: [{ type: 'text', text: 'Command moved to the background (shell ID: sh_1).' }],
      metadata,
    },
  })

  const completedSubagent = (metadata: JsonObject): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_3',
    name: 'subagent',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { description: 'Explore' },
      content: [{ type: 'text', text: 'Task moved to the background (session ID: ses_child).' }],
      metadata,
    },
  })

  function shellRecord(overrides: JsonObject = {}): JsonObject {
    return {
      id: 'sh_1',
      status: 'running',
      command: 'npm run dev',
      cwd: '/repo',
      shell: 'zsh',
      file: '/tmp/sh_1.log',
      metadata: { sessionID: 'ses_1' },
      time: { started: 1 },
      ...overrides,
    }
  }

  it('marks a shell call that returned while its command keeps running', async () => {
    await renderTool(<ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_1' })} messageID="msg_1" />)

    expect(await screen.findByText('background')).toBeInTheDocument()
  })

  it('does not mark a shell call that finished normally', async () => {
    await renderTool(<ToolCallPart part={completedShell({ status: 'completed', shellID: 'sh_1' })} messageID="msg_1" />)

    expect(await screen.findByText('completed')).toBeInTheDocument()
    expect(screen.queryByText('background')).not.toBeInTheDocument()
  })

  it('marks a backgrounded user-bash command with a background indicator', async () => {
    useUserBash.setState({ userBashCommands: new Map([['npm run dev', Date.now()]]) })

    await renderTool(<ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_1' })} messageID="msg_1" />)

    expect(await screen.findByText('background')).toBeInTheDocument()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('clears the background badge once the live shell completes', async () => {
    await renderTool(
      <ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_1' })} messageID="msg_1" directory="/repo" />,
      { shells: [shellRecord({ status: 'exited', exit: 0, time: { started: 1, completed: 2 } })] },
    )

    await waitFor(() => expect(screen.queryByText('background')).not.toBeInTheDocument())
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('shows a background shell missing from a loaded list as a non-spinning unavailable icon', async () => {
    const { container } = await renderTool(
      <ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_missing' })} messageID="msg_1" directory="/repo" />,
      { shells: [shellRecord()] },
    )

    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('completes a background shell missing from the list from its notice', async () => {
    const { container } = await renderTool(
      <ToolCallPart
        part={completedShell({ status: 'running', shellID: 'sh_notice' })}
        messageID="msg_1"
        directory="/repo"
        shellOutcome="completed"
      />,
      { shells: [] },
    )

    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('fails a background shell missing from the list from its notice', async () => {
    await renderTool(
      <ToolCallPart
        part={completedShell({ status: 'running', shellID: 'sh_notice' })}
        messageID="msg_1"
        directory="/repo"
        shellOutcome="failed"
      />,
      { shells: [] },
    )

    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
  })

  it('treats an unknown child session as running, not finished', async () => {
    await renderTool(
      <ToolCallPart part={completedSubagent({ status: 'running', sessionID: 'child-unknown' })} messageID="msg_1" />,
    )

    expect(await screen.findByText('background')).toBeInTheDocument()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('completes a backgrounded subagent when the child session is known idle', async () => {
    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })

    await renderTool(
      <ToolCallPart part={completedSubagent({ status: 'running', sessionID: 'child-1' })} messageID="msg_1" />,
    )

    await waitFor(() => expect(screen.getByText('✓')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
  })

  it('labels a sandboxed command with a non-manager provider', async () => {
    await renderTool(
      <ToolCallPart part={completedShell({ sandbox: true, sandboxProvider: 'forge' })} messageID="msg_1" />,
    )

    const badge = await screen.findByText('sandbox · forge')
    expect(badge).toHaveAttribute('title', 'Executed inside the forge sandbox')
  })

  it.each([
    { name: 'the manager provider', metadata: { sandbox: true, sandboxProvider: 'ocm' } },
    { name: 'no reported provider', metadata: { sandbox: true } },
  ])('keeps the plain sandbox label for $name', async ({ metadata }) => {
    await renderTool(<ToolCallPart part={completedShell(metadata)} messageID="msg_1" />)

    const badge = await screen.findByText('sandbox')
    expect(badge).toHaveAttribute('title', 'Executed inside the sandbox microVM')
  })
})

describe('ToolCallPart shell exit status', () => {
  const completedShell = (metadata: JsonObject): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_exit',
    name: 'shell',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { command: 'cat does-not-exist.txt' },
      content: [{ type: 'text', text: 'Exited with code 1' }],
      metadata,
    },
  })

  it('marks a completed shell with a non-zero exit as failed', async () => {
    await renderTool(<ToolCallPart part={completedShell({ exit: 1 })} messageID="msg_1" />)

    expect(await screen.findByText('exit 1')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
    expect(screen.getByText('✗').parentElement).toHaveClass('text-destructive')
  })

  it('keeps a completed shell with exit code zero successful', async () => {
    await renderTool(<ToolCallPart part={completedShell({ exit: 0 })} messageID="msg_1" />)

    expect(await screen.findByText('completed')).toBeInTheDocument()
    expect(screen.getByText('✓').parentElement).toHaveClass('text-success')
    expect(screen.queryByText('✗')).not.toBeInTheDocument()
  })

  it('keeps a completed shell without an exit code successful', async () => {
    await renderTool(<ToolCallPart part={completedShell({})} messageID="msg_1" />)

    expect(await screen.findByText('completed')).toBeInTheDocument()
  })

  it('does not read an exit code from a non-shell tool', async () => {
    await renderTool(
      <ToolCallPart
        part={{
          type: 'tool',
          id: 'call_fetch',
          name: 'webfetch',
          time: { created: 1, ran: 2, completed: 3 },
          state: {
            status: 'completed',
            input: { url: 'https://example.com' },
            content: [{ type: 'text', text: 'ok' }],
            metadata: { exit: 1 },
          },
        }}
        messageID="msg_1"
      />,
    )

    expect(await screen.findByText('completed')).toBeInTheDocument()
    expect(screen.queryByText('✗')).not.toBeInTheDocument()
  })
})

describe('ToolCallPart execute renderer', () => {
  const completedExecute = (
    metadata: JsonObject,
    text = '{"windows":[{"title":"Untitled"}]}',
  ): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_exec',
    name: 'execute',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: {
        code: 'const result = await tools.listWindows({ app: "TextEdit" })\nconsole.log(result)',
      },
      content: [{ type: 'text', text }],
      metadata,
    },
  })

  const childCalls: JsonValue[] = [
    { tool: 'cua-driver.list_windows', status: 'completed', input: { app: 'TextEdit' } },
    { tool: 'cua-driver.click', status: 'error', input: { x: 10 } },
  ]

  it('lists child calls while collapsed and marks errors', async () => {
    await renderTool(<ToolCallPart part={completedExecute({ toolCalls: childCalls })} messageID="msg_1" />)

    expect(await screen.findByText('cua-driver.list_windows [app=TextEdit]')).toBeInTheDocument()
    expect(screen.getByText('cua-driver.click [x=10]')).toBeInTheDocument()

    const errorRow = screen.getByRole('button', { name: /cua-driver\.click/ })
    expect(within(errorRow).getByText('✗')).toBeInTheDocument()
    expect(screen.getByText(/Failed/)).toBeInTheDocument()
  })

  it('renders line-numbered code and output sections when expanded', async () => {
    const { container } = await renderTool(
      <ToolCallPart part={completedExecute({ toolCalls: childCalls })} messageID="msg_1" />,
      { expandToolCalls: true },
    )

    expect(await screen.findByText('Code')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(container.querySelector('code.language-ts')?.textContent).toContain('const result = await tools.listWindows')
    expect(container.querySelector('code.language-json')?.textContent).toContain('"windows"')

    const gutters = screen.getAllByTestId('execute-line-numbers')
    expect(gutters[0].textContent).toBe('1\n2')
    expect(gutters[1].textContent).toBe('1')
    expect(gutters[0].style.width).toBe(gutters[1].style.width)
  })

  it('caps the collapsed child call preview and reports the hidden count', async () => {
    const manyCalls = Array.from({ length: 8 }, (_, index) => ({
      tool: `cua-driver.call_${index}`,
      status: 'completed',
      input: { index },
    }))

    await renderTool(<ToolCallPart part={completedExecute({ toolCalls: manyCalls })} messageID="msg_1" />)

    expect(await screen.findAllByRole('button', { name: /cua-driver\.call_/ })).toHaveLength(5)
    expect(screen.getByText('(3 more calls)')).toBeInTheDocument()
    expect(screen.queryByText('Code')).not.toBeInTheDocument()
    expect(screen.queryByText('cua-driver.call_5 [index=5]')).not.toBeInTheDocument()
  })

  it('reveals the code and output detail from the header on desktop', async () => {
    const manyCalls = Array.from({ length: 8 }, (_, index) => ({
      tool: `cua-driver.call_${index}`,
      status: 'completed',
      input: { index },
    }))

    await renderTool(<ToolCallPart part={completedExecute({ toolCalls: manyCalls })} messageID="msg_1" />)

    fireEvent.click(await screen.findByRole('button', { name: /execute/ }))

    await waitFor(() => expect(screen.getByText('Code')).toBeInTheDocument())
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.queryByText('(3 more calls)')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /cua-driver\.call_/ })).toHaveLength(8)
    expect(screen.getByText('cua-driver.call_5 [index=5]')).toBeInTheDocument()
  })

  it('reports a completed script that failed at runtime', async () => {
    await renderTool(
      <ToolCallPart
        part={completedExecute({ error: true }, 'Error: tool not found\n    at execute')}
        messageID="msg_1"
      />,
    )

    expect(await screen.findByText(/Failed/)).toBeInTheDocument()
    expect(screen.getByText('↳ Error: tool not found')).toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  const runningExecute = (): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_exec',
    name: 'execute',
    time: { created: 1, ran: 2 },
    state: {
      status: 'running',
      input: { code: 'await tools.listWindows({ app: "TextEdit" })' },
      metadata: {},
    },
  })

  it('shows the waiting permission state while the script awaits permission', async () => {
    await renderTool(<ToolCallPart part={runningExecute()} messageID="msg_1" />, {
      permission: permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_exec' }),
    })

    expect(await screen.findByText('awaiting permission')).toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
  })

  it('toggles aria-expanded on the header button', async () => {
    await renderTool(<ToolCallPart part={completedExecute({ toolCalls: childCalls })} messageID="msg_1" />)

    const header = await screen.findByRole('button', { name: /execute/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens a file reference from an expanded child call input', async () => {
    const onFileClick = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_exec',
      name: 'execute',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { code: 'await tools.read({ path: "src/app.ts" })' },
        content: [{ type: 'text', text: 'read ok' }],
        metadata: { toolCalls: [{ tool: 'read', status: 'completed', input: { path: 'src/app.ts' } }] },
      },
    }

    await renderTool(<ToolCallPart part={part} messageID="msg_1" onFileClick={onFileClick} />)

    fireEvent.click(await screen.findByRole('button', { name: /read \[path=src\/app.ts\]/ }))
    const reference = screen.getByRole('button', { name: 'Open src/app.ts' })
    expect(reference).toHaveAttribute('title', 'Click to open src/app.ts')
    fireEvent.click(reference)

    expect(onFileClick).toHaveBeenCalledWith('src/app.ts')
  })
})

describe('ToolCallPart file content', () => {
  const screenshotUri = 'data:image/png;base64,aGVsbG8='

  it('shows an execute screenshot while collapsed', async () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_exec_files',
      name: 'execute',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { code: 'await tools.screenshot()' },
        content: [
          { type: 'text', text: 'Captured the window' },
          { type: 'file', uri: screenshotUri, mime: 'image/png', name: 'screenshot.png' },
        ],
        metadata: {},
      },
    }

    await renderTool(<ToolCallPart part={part} messageID="msg_1" />)

    expect(await screen.findByRole('button', { name: /execute/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByAltText('screenshot.png')).toHaveAttribute('src', screenshotUri)
  })

  it('shows a generic tool screenshot while collapsed', async () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_screenshot',
      name: 'screenshot',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: {},
        content: [{ type: 'file', uri: screenshotUri, mime: 'image/png', name: 'screenshot.png' }],
        metadata: {},
      },
    }

    await renderTool(<ToolCallPart part={part} messageID="msg_1" />)

    expect(await screen.findByAltText('screenshot.png')).toHaveAttribute('src', screenshotUri)
  })

  it('does not render an empty file content wrapper', async () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_text_only',
      name: 'screenshot',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: {},
        content: [{ type: 'text', text: 'no files' }],
        metadata: {},
      },
    }

    const { container } = await renderTool(<ToolCallPart part={part} messageID="msg_1" />)

    await screen.findByText('screenshot')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.flex-wrap')).toBeNull()
  })
})

describe('ToolCallPart open walkthrough action', () => {
  const openWalkthrough = (status: 'running' | 'completed'): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_ocm',
    name: 'ocm',
    time: status === 'completed' ? { created: 1, ran: 2, completed: 3 } : { created: 1, ran: 2 },
    state:
      status === 'completed'
        ? {
            status: 'completed',
            input: { action: 'open_walkthrough', params: {} },
            content: [{ type: 'text', text: 'Walkthrough opened' }],
          }
        : {
            status: 'running',
            input: { action: 'open_walkthrough', params: {} },
            metadata: {},
          },
  })

  it('renders an Open walkthrough button and calls the opener', async () => {
    const onOpenWalkthrough = vi.fn()

    await renderTool(
      <ToolCallPart part={openWalkthrough('completed')} messageID="msg_1" onOpenWalkthrough={onOpenWalkthrough} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open walkthrough' }))

    expect(onOpenWalkthrough).toHaveBeenCalledTimes(1)
  })

  it('passes the requested source to the opener', async () => {
    const onOpenWalkthrough = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_ocm',
      name: 'ocm',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { source: { kind: 'staged' } } },
        content: [{ type: 'text', text: 'Walkthrough opened' }],
      },
    }

    await renderTool(<ToolCallPart part={part} messageID="msg_1" onOpenWalkthrough={onOpenWalkthrough} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open walkthrough' }))

    expect(onOpenWalkthrough).toHaveBeenCalledWith({ kind: 'staged' })
  })

  it('passes no source when the call invalidates one', async () => {
    const onOpenWalkthrough = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_ocm',
      name: 'ocm',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { source: { kind: 'nonsense' } } },
        content: [{ type: 'text', text: 'Walkthrough opened' }],
      },
    }

    await renderTool(<ToolCallPart part={part} messageID="msg_1" onOpenWalkthrough={onOpenWalkthrough} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open walkthrough' }))

    expect(onOpenWalkthrough).toHaveBeenCalledWith(undefined)
  })

  it('does not render the button while the call is still running', async () => {
    await renderTool(
      <ToolCallPart part={openWalkthrough('running')} messageID="msg_1" onOpenWalkthrough={vi.fn()} />,
    )

    expect(await screen.findByText('ocm')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open walkthrough' })).not.toBeInTheDocument()
  })

  it('does not render the button for another ocm action', async () => {
    const otherAction: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_ocm',
      name: 'ocm',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { action: 'something_else' },
        content: [{ type: 'text', text: 'ok' }],
      },
    }

    await renderTool(<ToolCallPart part={otherAction} messageID="msg_1" onOpenWalkthrough={vi.fn()} />)

    await screen.findByText('ocm')
    expect(screen.queryByRole('button', { name: 'Open walkthrough' })).not.toBeInTheDocument()
  })
})

describe('ToolCallPart shell preview', () => {
  it('shows only the tail of a long shell output until the details are opened', async () => {
    const lines = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`)

    await renderTool(
      <ToolCallPart
        part={{
          type: 'tool',
          id: 'call_lines',
          name: 'shell',
          time: { created: 1, ran: 2, completed: 3 },
          state: {
            status: 'completed',
            input: { command: 'seq 25' },
            content: [{ type: 'text', text: lines.join('\n') }],
            metadata: {},
          },
        }}
        messageID="msg_1"
      />,
    )

    const preview = await screen.findByRole('button', { name: 'Show shell details' })
    expect(within(preview).getByText('(15 earlier lines)')).toBeInTheDocument()
    expect(preview.textContent).toMatch(/\bline 25\b/)
    expect(preview.textContent).not.toMatch(/\bline 1\b/)
  })
})

describe('ToolCallPart shell details scrolling', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView
  const scrollIntoView = vi.fn()

  const completedShell = (): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_scroll',
    name: 'shell',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { command: 'seq 25' },
      content: [{ type: 'text', text: 'line 24\nline 25' }],
      metadata: {},
    },
  })

  it('does not scroll when the shell details open from the preference', async () => {
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      await renderTool(<ToolCallPart part={completedShell()} messageID="msg_1" />, { expandToolCalls: true })

      expect(await screen.findByText('Command:')).toBeInTheDocument()
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('scrolls once when the user opens the shell details', async () => {
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      await renderTool(<ToolCallPart part={completedShell()} messageID="msg_1" />)

      expect(screen.queryByText('Command:')).not.toBeInTheDocument()

      fireEvent.click(await screen.findByRole('button', { name: 'Show shell details' }))

      expect(screen.getByText('Command:')).toBeInTheDocument()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })
})

describe('ToolCallPart show artifact action', () => {
  const showArtifact = (params: JsonObject, metadata?: JsonObject): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_artifact',
    name: 'ocm',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { action: 'show_artifact', params },
      content: [{ type: 'text', text: 'Artifact shown' }],
      metadata,
    },
  })

  it('renders the sandboxed iframe, path label, and open-in-new-tab link', async () => {
    const src = getFileApiUrl('/repo/reports/summary.html', { params: { raw: true } })

    await renderTool(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: 'reports/summary.html' })}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    const iframe = await screen.findByTitle('Report')
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe).toHaveAttribute('src', src)

    const pathLabel = screen.getByText('reports/summary.html')
    expect(pathLabel).toHaveAttribute('title', 'reports/summary.html')

    const link = screen.getByRole('link', { name: 'Open in new tab' })
    expect(link).toHaveAttribute('href', src)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('prefers the backend-resolved metadata path over the directory join', async () => {
    const src = getFileApiUrl('/workspace/sessions/ses_1/report.html', { params: { raw: true } })

    await renderTool(
      <ToolCallPart
        part={showArtifact(
          { title: 'Report', path: 'reports/summary.html' },
          { path: '/workspace/sessions/ses_1/report.html' },
        )}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    await waitFor(() => expect(screen.getByTitle('Report')).toHaveAttribute('src', src))
    expect(screen.getByText('reports/summary.html')).toHaveAttribute('title', 'reports/summary.html')
  })

  it('maps a repo path outside the workspace to the repo-local path', async () => {
    const src = getFileApiUrl('assistant/reports/summary.html', { params: { raw: true } })

    await renderTool(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: 'reports/summary.html' })}
        messageID="msg_1"
        directory="/workspace/repos/assistant"
        repoFullPath="/workspace/repos/assistant"
        repoLocalPath="assistant"
      />,
    )

    expect(await screen.findByTitle('Report')).toHaveAttribute('src', src)
  })

  it('resolves an absolute artifact path without a session directory', async () => {
    const src = getFileApiUrl('/tmp/artifacts/report.html', { params: { raw: true } })

    await renderTool(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: '/tmp/artifacts/report.html' })}
        messageID="msg_1"
      />,
    )

    const iframe = await screen.findByTitle('Report')
    expect(iframe).toHaveAttribute('src', src)
    expect(screen.getByText('/tmp/artifacts/report.html')).toHaveAttribute('title', '/tmp/artifacts/report.html')
  })

  it('remounts the iframe with an unchanged src when Reload is clicked', async () => {
    const src = getFileApiUrl('/repo/reports/summary.html', { params: { raw: true } })

    const { container } = await renderTool(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: 'reports/summary.html' })}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    await screen.findByTitle('Report')
    const before = container.querySelector('iframe')
    expect(before).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reload artifact' }))

    const after = container.querySelector('iframe')
    expect(after).not.toBe(before)
    expect(after).toHaveAttribute('src', src)
  })

  it('falls back to the generic tool card for invalid params', async () => {
    const { container } = await renderTool(
      <ToolCallPart part={showArtifact({ title: 'No path' })} messageID="msg_1" directory="/repo" />,
    )

    expect(await screen.findByText('ocm')).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('falls back to the generic tool card for a relative path without a directory', async () => {
    const { container } = await renderTool(
      <ToolCallPart part={showArtifact({ title: 'Report', path: 'reports/summary.html' })} messageID="msg_1" />,
    )

    expect(await screen.findByText('ocm')).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })
})
