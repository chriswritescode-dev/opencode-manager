import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { ToolSidePanel } from './ToolSidePanel'
import { useToolPanel } from '@/hooks/useToolPanel'
import { useUIState } from '@/stores/uiStateStore'
import { act } from '@testing-library/react'
import { installMatchMedia, installWebSocket } from '@/test/browserFakes'
import { connectTestEventStream, renderWithProviders } from '@/test/render'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import { permissionAsked, sessionStatusUpdated } from '@/test/fixtures/events'
import type { FetchRoute } from '@/test/fetchFake'
import type { TerminalInfo } from '@opencode-manager/shared/types'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="panel-search">{location.search}</div>
    </>
  )
}

interface HarnessProps {
  docked: boolean
  deleteActiveSessionPath?: string
}

function Harness({ docked, deleteActiveSessionPath }: HarnessProps) {
  const panel = useToolPanel(docked)
  return (
    <>
      <textarea data-prompt-input aria-label="prompt" />
      {docked ? (
        <ToolSidePanel
          panel={panel}
          repoId={1}
          sessionId="ses_1"
          directory="/repo"
          filesBasePath="repo"
          currentBranch="main"
          selectedFilePath="src/a.ts"
          repoDirectory="/repo"
          onSkillLoaded={() => {}}
          deleteActiveSessionPath={deleteActiveSessionPath}
        />
      ) : null}
      <LocationProbe />
    </>
  )
}

function HomeHarness() {
  const panel = useToolPanel(true)
  return (
    <>
      <ToolSidePanel panel={panel} filesBasePath="" allowNavigateAboveBase />
      <LocationProbe />
    </>
  )
}

function RemoteHarness() {
  const panel = useToolPanel(true)
  return (
    <>
      <ToolSidePanel
        panel={panel}
        repoId={0}
        sessionId="ses_remote"
        directory="/home/me/app"
        repoDirectory="/home/me/app"
        filesBasePath={undefined}
      />
      <LocationProbe />
    </>
  )
}

function RepoHarness() {
  const panel = useToolPanel(true)
  return (
    <>
      <ToolSidePanel
        panel={panel}
        repoId={1}
        directory="/repo"
        repoDirectory="/repo"
        filesBasePath="repo"
        currentBranch="main"
      />
      <LocationProbe />
    </>
  )
}

interface PanelOptions {
  docked?: boolean
  terminals?: TerminalInfo[]
  deleteActiveSessionPath?: string
  events?: boolean
}

function terminalRoute(terminals: TerminalInfo[]): FetchRoute {
  return { method: 'GET', path: '/api/repos/1/terminals', respond: () => ({ json: { terminals } }) }
}

function renderPanel(route: string, options: PanelOptions = {}) {
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <Harness docked={options.docked ?? true} deleteActiveSessionPath={options.deleteActiveSessionPath} />
    </KeyboardShortcutsProvider>,
    {
      route: `/repos/1/sessions/ses_1${route}`,
      events: true,
      theme: false,
      toaster: false,
      fetchRoutes: [
        ...(options.terminals ? [terminalRoute(options.terminals)] : []),
        {
          method: 'DELETE',
          path: '/api/repos/1/terminals/:ptyID',
          respond: () => ({ status: 204 }),
        },
        ...appRoutes({
          repos: [makeRepo({ id: 1, fullPath: '/repo', name: 'repo' })],
          sessions: [
            makeSession({ id: 'ses_1', title: 'Session one', location: { directory: '/repo' } }),
            makeSession({ id: 'ses_2', title: 'Session two', location: { directory: '/repo' } }),
          ],
        }),
      ],
      fetchFallback: () => ({ json: {} }),
    },
  )
  return result
}


function stubNarrowPage(): () => void {
  const main = document.createElement('main')
  main.getBoundingClientRect = () => new DOMRect(0, 0, 560, 800)
  document.body.append(main)
  return () => main.remove()
}

function panelSearch(): URLSearchParams {
  return new URLSearchParams(
    screen.getByTestId('panel-search')?.textContent ?? '',
  )
}

async function openTool(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: label }))
  return screen.findByRole('complementary', { name: label })
}

describe('ToolSidePanel', () => {
  it('shows the tool name in a tooltip when hovering a rail icon', async () => {
    const user = userEvent.setup()
    renderPanel('')

    await user.hover(screen.getByRole('button', { name: 'Terminal' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Terminal')
  })

  it('shows the home route tools without a repo', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <KeyboardShortcutsProvider>
        <HomeHarness />
      </KeyboardShortcutsProvider>,
      {
        route: '/',
        events: true,
        theme: false,
        toaster: false,
        fetchRoutes: appRoutes(),
        fetchFallback: () => ({ json: {} }),
      },
    )

    expect(screen.queryByRole('button', { name: 'Terminal' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(await screen.findByRole('complementary', { name: 'Files' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All Schedules' }))
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/schedules'))
  })

  it('moves a panel tool opened as a dialog into the docked panel', async () => {
    renderPanel('?dialog=walkthrough')

    expect(await screen.findByRole('complementary', { name: 'Walkthrough' })).toBeInTheDocument()
    const params = panelSearch()
    expect(params.get('panel')).toBe('walkthrough')
    expect(params.has('dialog')).toBe(false)
  })

  it('leaves non-panel dialogs alone', async () => {
    renderPanel('?dialog=resetPermissions&panel=files')

    expect(await screen.findByRole('complementary', { name: 'Files' })).toBeInTheDocument()
    expect(panelSearch().get('dialog')).toBe('resetPermissions')
  })

  it.each([
    ['Preview', 'preview'],
    ['MCP', 'mcp'],
    ['Actions', 'actions'],
    ['Skills', 'skills'],
  ])('opens %s inside the docked panel', async (label, panelKey) => {
    const user = userEvent.setup()
    renderPanel('')

    await openTool(user, label)

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    expect(panelSearch().get('panel')).toBe(panelKey)
    expect(panelSearch().has('dialog')).toBe(false)
  })

  it('moves a preview opened with a port into the panel and keeps its port', async () => {
    renderPanel('?panel=terminal&terminal=pty-1&dialog=preview&previewPort=5173&previewPath=%2F')

    expect(await screen.findByRole('complementary', { name: 'Preview' })).toBeInTheDocument()
    const params = panelSearch()
    expect(params.get('panel')).toBe('preview')
    expect(params.get('previewPort')).toBe('5173')
    expect(params.has('terminal')).toBe(false)
  })

  it('toggles tools from the rail and closes the panel', async () => {
    const user = userEvent.setup()
    renderPanel('')

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()

    await openTool(user, 'Source Control')
    expect(screen.getByRole('button', { name: 'Source Control' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(await screen.findByRole('complementary', { name: 'Terminal' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Source Control' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Terminal' })).not.toBeInTheDocument())
    expect(panelSearch().has('panel')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(await screen.findByRole('button', { name: 'Close panel' }))
    await waitFor(() => expect(panelSearch().has('panel')).toBe(false))
  })

  it('renders the panel as a modal sheet over the page when docking would squeeze it', async () => {
    const removePage = stubNarrowPage()

    try {
      renderPanel('?panel=files')

      const panel = await screen.findByRole('dialog', { name: 'Files' })
      const backdrop = screen.getByTestId('tool-panel-backdrop')
      expect(panel.className).toContain('fixed')
      expect(panel).toHaveAttribute('aria-modal', 'true')
      expect(panel).not.toHaveAttribute('style')
      expect(panel.className).toContain('z-50')
      expect(backdrop.className).toContain('z-50')
      expect(backdrop).toHaveAttribute('aria-hidden', 'true')
      expect(screen.queryByRole('separator', { name: 'Resize panel' })).not.toBeInTheDocument()
    } finally {
      removePage()
    }
  })

  it('portals the floating overlay into the document body so page stacking contexts cannot cover it', async () => {
    const removePage = stubNarrowPage()

    try {
      renderPanel('?panel=files')

      const panel = await screen.findByRole('dialog', { name: 'Files' })
      const backdrop = screen.getByTestId('tool-panel-backdrop')

      expect(panel.parentElement).toBe(document.body)
      expect(backdrop.parentElement).toBe(document.body)
      expect(backdrop.className).toContain('inset-y-0')
    } finally {
      removePage()
    }
  })

  it('moves focus into the floating panel and returns it to the rail on close', async () => {
    const user = userEvent.setup()
    const removePage = stubNarrowPage()

    try {
      renderPanel('')

      const filesButton = screen.getByRole('button', { name: 'Files' })
      await user.click(filesButton)
      const panel = await screen.findByRole('dialog', { name: 'Files' })

      await waitFor(() => expect(document.activeElement).toBe(panel))

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Files' })).not.toBeInTheDocument())
      await waitFor(() => expect(document.activeElement).toBe(filesButton))
      expect(panelSearch().has('panel')).toBe(false)
    } finally {
      removePage()
    }
  })

  it('closes the floating panel on Escape and on an outside click', async () => {
    const user = userEvent.setup()
    const removePage = stubNarrowPage()

    try {
      renderPanel('?panel=files')

      await screen.findByRole('dialog', { name: 'Files' })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(panelSearch().has('panel')).toBe(false))

      await user.click(screen.getByRole('button', { name: 'Files' }))
      await screen.findByRole('dialog', { name: 'Files' })

      await user.click(screen.getByTestId('tool-panel-backdrop'))
      await waitFor(() => expect(panelSearch().has('panel')).toBe(false))
    } finally {
      removePage()
    }
  })

  it('keeps the floating terminal open on Escape typed into the terminal', async () => {
    const user = userEvent.setup()
    const removePage = stubNarrowPage()

    try {
      renderPanel('?panel=terminal&terminal=pty-1')

      const panel = screen.getByRole('dialog')
      expect(panel).toHaveAttribute('aria-label', 'Terminal')
      const terminal = document.createElement('div')
      terminal.className = 'xterm'
      terminal.tabIndex = -1
      panel.append(terminal)
      await user.click(terminal)
      await user.keyboard('{Escape}')

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Terminal')
      expect(panelSearch().get('panel')).toBe('terminal')
    } finally {
      removePage()
    }
  })

  it('keeps a docked panel open on Escape', async () => {
    const user = userEvent.setup()
    renderPanel('?panel=files')

    await screen.findByRole('complementary', { name: 'Files' })
    await user.keyboard('{Escape}')

    expect(panelSearch().get('panel')).toBe('files')
  })

  it('resizes the docked panel from the keyboard and clamps it', async () => {
    const user = userEvent.setup()
    renderPanel('?panel=files')

    const handle = await screen.findByRole('separator', { name: 'Resize panel' })
    const panel = screen.getByRole('complementary', { name: 'Files' })
    expect(panel.parentElement).not.toBe(document.body)
    const initial = Number(handle.getAttribute('aria-valuenow'))

    handle.focus()
    await user.keyboard('{ArrowRight}')

    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(initial - 16)
    expect(panel).toHaveStyle({ width: `${initial - 16}px` })

    await user.keyboard('{Home}')

    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(320)
    expect(panel).toHaveStyle({ width: '320px' })
  })

  it('opens Secrets inside the docked repo panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <KeyboardShortcutsProvider>
        <RepoHarness />
      </KeyboardShortcutsProvider>,
      {
        route: '/repos/1',
        events: true,
        theme: false,
        toaster: false,
        fetchRoutes: appRoutes({
          repos: [makeRepo({ id: 1, fullPath: '/repo', name: 'repo' })],
        }),
        fetchFallback: () => ({ json: {} }),
      },
    )

    await user.click(screen.getByRole('button', { name: 'Secrets' }))

    expect(await screen.findByRole('complementary', { name: 'Secrets' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Secrets' })).toBeInTheDocument()
  })

  it('opens non-panel session items from the rail as dialogs', async () => {
    const user = userEvent.setup()
    renderPanel('?panel=files')

    await user.click(await screen.findByRole('button', { name: 'Reset Permissions' }))

    await waitFor(() => expect(panelSearch().get('dialog')).toBe('resetPermissions'))
    expect(panelSearch().get('panel')).toBe('files')
  })

  it('opens schedules in the panel without leaving the session', async () => {
    const user = userEvent.setup()
    renderPanel('?panel=files')

    await user.click(screen.getByRole('button', { name: 'Schedules' }))

    expect(await screen.findByRole('complementary', { name: 'Schedules' })).toBeInTheDocument()
    expect(panelSearch().get('panel')).toBe('schedules')
    expect(screen.getByTestId('pathname')).toHaveTextContent('/repos/1/sessions/ses_1')
  })

  it('drops schedule selection params when switching away from schedules', async () => {
    const user = userEvent.setup()
    renderPanel('?panel=schedules&jobId=4&scheduleTab=runs&runId=9')

    await user.click(await screen.findByRole('button', { name: 'Terminal' }))

    await waitFor(() => expect(panelSearch().get('panel')).toBe('terminal'))
    expect(panelSearch().has('jobId')).toBe(false)
    expect(panelSearch().has('scheduleTab')).toBe(false)
    expect(panelSearch().has('runId')).toBe(false)
  })

  it('closes a docked schedules panel when the layout is no longer docked', async () => {
    renderPanel('?panel=schedules&jobId=4', { docked: false })

    await waitFor(() => expect(panelSearch().has('panel')).toBe(false))
    expect(panelSearch().has('dialog')).toBe(false)
    expect(panelSearch().has('jobId')).toBe(false)
  })

  it('drops terminal selection params when switching away from the terminal', async () => {
    const user = userEvent.setup()
    renderPanel('?panel=terminal&terminal=pty-1')

    await user.click(await screen.findByRole('button', { name: 'Files' }))

    await waitFor(() => expect(panelSearch().get('panel')).toBe('files'))
    expect(panelSearch().has('terminal')).toBe(false)
  })

  it('closes the docked terminal panel when the last terminal exits', async () => {
    installMatchMedia(false)
    const socketFake = installWebSocket()
    const runningTerminal: TerminalInfo = {
      id: 'pty-1',
      title: 'Terminal',
      kind: 'shell',
      cwd: '/repo',
      status: 'running',
    }
    const terminals: TerminalInfo[] = [runningTerminal]
    renderPanel('?panel=terminal&terminal=pty-1', { terminals })

    await waitFor(() => expect(socketFake.connectionFor('/terminals/pty-1/connect')).toBeDefined())

    terminals.splice(0, terminals.length, { ...runningTerminal, status: 'exited', exitCode: 0 })
    act(() => socketFake.connectionFor('/terminals/pty-1/connect')?.serverClose(1000))

    await waitFor(() => expect(panelSearch().has('panel')).toBe(false))
  })

  it('falls back to the dialog when not docked', async () => {
    renderPanel('?panel=sourceControl', { docked: false })

    await waitFor(() => expect(panelSearch().get('dialog')).toBe('sourceControl'))
    expect(panelSearch().has('panel')).toBe(false)
  })

  it('moves focus to the chat prompt when the docked panel closes on desktop', async () => {
    installMatchMedia(true)
    const user = userEvent.setup()
    renderPanel('')

    await user.click(screen.getByRole('button', { name: 'Files' }))
    const closeButton = await screen.findByRole('button', { name: 'Close panel' })
    closeButton.focus()

    await user.click(closeButton)

    await waitFor(() => expect(panelSearch().has('panel')).toBe(false))
    expect(screen.getByLabelText('prompt')).toHaveFocus()
  })

  it('lists the Sessions tool first in the rail', () => {
    renderPanel('')

    const rail = screen.getByRole('navigation', { name: 'Tools' })
    const buttons = within(rail).getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName('Sessions')
  })

  it('shows only the remote-capable tools on a linked-server route', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <KeyboardShortcutsProvider>
        <RemoteHarness />
      </KeyboardShortcutsProvider>,
      {
        route: '/servers/srv_kitchen/sessions/ses_remote',
        events: true,
        theme: false,
        toaster: false,
        fetchRoutes: appRoutes(),
        fetchFallback: () => ({ json: {} }),
      },
    )

    const rail = screen.getByRole('navigation', { name: 'Tools' })
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
    ).toEqual(['Sessions', 'MCP', 'Skills', 'Source Control', 'Terminal'])

    await user.click(screen.getByRole('button', { name: 'MCP' }))
    expect(await screen.findByRole('complementary', { name: 'MCP' })).toBeInTheDocument()
  })

  it('opens the remote source control panel for a linked-server session', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderWithProviders(
      <KeyboardShortcutsProvider>
        <RemoteHarness />
      </KeyboardShortcutsProvider>,
      {
        route: '/servers/srv_kitchen/sessions/ses_remote',
        events: true,
        theme: false,
        toaster: false,
        fetchRoutes: appRoutes(),
        fetchFallback: () => ({ json: {} }),
      },
    )

    await user.click(await screen.findByRole('button', { name: 'Source Control' }))

    expect(await screen.findByRole('complementary', { name: 'Source Control' })).toBeInTheDocument()
    expect(panelSearch().get('panel')).toBe('sourceControl')
    await waitFor(() =>
      expect(
        fetchFake.requests.some((request) => request.path.startsWith('/api/opencode/servers/srv_kitchen/')),
      ).toBe(true),
    )
  })

  it('opens the skills panel for a linked-server session', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <KeyboardShortcutsProvider>
        <RemoteHarness />
      </KeyboardShortcutsProvider>,
      {
        route: '/servers/srv_kitchen/sessions/ses_remote',
        events: true,
        theme: false,
        toaster: false,
        fetchRoutes: appRoutes(),
        fetchFallback: () => ({ json: {} }),
      },
    )

    await user.click(await screen.findByRole('button', { name: 'Skills' }))

    expect(await screen.findByRole('complementary', { name: 'Skills' })).toBeInTheDocument()
    expect(panelSearch().get('panel')).toBe('skills')
  })

  it('opens the Sessions panel with the session picker when clicked', async () => {
    const user = userEvent.setup()
    renderPanel('')

    await user.click(screen.getByRole('button', { name: 'Sessions' }))

    const panel = await screen.findByRole('complementary', { name: 'Sessions' })
    expect(within(panel).getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(panelSearch().get('panel')).toBe('sessions')
  })

  it('keeps the docked Sessions panel open when a session is chosen', async () => {
    const { queryClient } = renderPanel('?panel=sessions')

    const panel = await screen.findByRole('complementary', { name: 'Sessions' })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    fireEvent.click(await within(panel).findByRole('option', { name: /Session two/ }))

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/repos/1/sessions/ses_2'))
    expect(panelSearch().get('panel')).toBe('sessions')
  })

  it('shows a Sessions count pill and extends the accessible name', async () => {
    const { eventStream } = renderPanel('')
    await connectTestEventStream(eventStream)
    act(() => {
      eventStream?.message(
        permissionAsked(
          { id: 'perm-1', sessionID: 'ses_needs_input', action: 'shell', resources: ['ls'], metadata: {} },
          { directory: '/repo' },
        ),
      )
      eventStream?.message(sessionStatusUpdated('ses_running', { type: 'busy' }, { directory: '/repo' }))
    })

    expect(
      await screen.findByRole('button', { name: 'Sessions, 1 needs input, 1 running' }),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Sessions, 1 needs input, 1 running' })).getByText('2').className).toContain('bg-warning')
  })

  it('marks the tool rail as mounted only while it renders', () => {
    const { unmount } = renderPanel('')

    expect(useUIState.getState().isToolRailMounted).toBe(true)

    unmount()

    expect(useUIState.getState().isToolRailMounted).toBe(false)
  })
})
