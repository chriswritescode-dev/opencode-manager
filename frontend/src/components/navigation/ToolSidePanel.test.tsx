import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { stubMatchMedia } from '@/test/test-utils'
import { ToolSidePanel } from './ToolSidePanel'
import { useToolPanel } from '@/hooks/useToolPanel'
import type { SessionPickerNavigation, SessionPickerNavigationOptions } from '@/hooks/useSessionPickerNavigation'
import { useUIState } from '@/stores/uiStateStore'

const activeWorkMocks = vi.hoisted(() => ({
  useActiveWorkCounts: vi.fn(),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWorkCounts: activeWorkMocks.useActiveWorkCounts,
}))

const sessionPickerMocks = vi.hoisted(() => ({
  useSessionPickerNavigation: vi.fn(),
}))

vi.mock('@/hooks/useSessionPickerNavigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSessionPickerNavigation')>()
  return {
    ...actual,
    useSessionPickerNavigation: (options: SessionPickerNavigationOptions) => {
      sessionPickerMocks.useSessionPickerNavigation(options)
      return actual.useSessionPickerNavigation(options)
    },
  }
})

vi.mock('@/components/session/RouteSessionPicker', () => ({
  RouteSessionPicker: ({ navigation }: { navigation: SessionPickerNavigation }) => (
    <div>
      route-session-picker
      <button type="button" onClick={() => navigation.onNavigate('/repos/2/sessions/other')}>
        open other session
      </button>
    </div>
  ),
}))

vi.mock('@/components/file-browser/FileBrowser', () => ({
  FileBrowser: ({ initialSelectedFile }: { initialSelectedFile?: string }) => <div>files-tool {initialSelectedFile}</div>,
}))
vi.mock('@/components/source-control', () => ({
  SourceControlContent: () => <div>source-control-tool</div>,
}))
vi.mock('@/components/source-control/RemoteSourceControlContent', () => ({
  RemoteSourceControlContent: ({ serverId, directory }: { serverId: string; directory: string }) => (
    <div>remote-source-control-tool {serverId} {directory}</div>
  ),
}))
vi.mock('@/components/terminal/TerminalPanel', () => ({
  TerminalWorkspace: ({ onLastTerminalExited }: { onLastTerminalExited?: () => void }) => (
    <div>
      terminal-tool
      <div className="xterm">
        <textarea aria-label="terminal input" />
      </div>
      <button type="button" onClick={onLastTerminalExited}>Exit last terminal</button>
    </div>
  ),
}))
vi.mock('@/components/preview/PreviewPanel', () => ({ PreviewWorkspace: () => <div>preview-tool</div> }))
vi.mock('@/components/schedules/RepoSchedulesContent', () => ({
  RepoSchedulesContent: ({ repoId }: { repoId: number }) => <div>schedules-tool {repoId}</div>,
}))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpContent: () => <div>mcp-tool</div> }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsContent: () => <div>actions-tool</div> }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsContent: () => <div>skills-tool</div> }))
vi.mock('@/components/secrets/RepoSecretsDialog', () => ({
  RepoSecretsContent: () => <div>secrets-tool</div>,
}))
vi.mock('@/components/session/ChangesWalkthroughSheet', () => ({
  ChangesWalkthroughProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ChangesWalkthroughRegenerate: () => null,
  ChangesWalkthroughSourcePicker: () => null,
  ChangesWalkthroughCancel: () => null,
  ChangesWalkthroughView: () => <div>walkthrough-tool</div>,
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  )
}

function Harness({
  docked,
  onDeleteActiveSession,
}: {
  docked: boolean
  onDeleteActiveSession?: () => void
}) {
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
          onDeleteActiveSession={onDeleteActiveSession}
        />
      ) : null}
      <LocationProbe />
    </>
  )
}

function renderAt(search: string, docked = true, onDeleteActiveSession?: () => void) {
  return render(
    <MemoryRouter initialEntries={[`/repos/1/sessions/ses_1${search}`]}>
      <Harness docked={docked} onDeleteActiveSession={onDeleteActiveSession} />
    </MemoryRouter>,
  )
}

function search(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('search').textContent ?? '')
}

function stubNarrowPage(): () => void {
  const main = document.createElement('main')
  main.getBoundingClientRect = () =>
    ({ width: 560, height: 800, top: 0, left: 0, right: 560, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  document.body.append(main)
  return () => main.remove()
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

beforeEach(() => {
  vi.clearAllMocks()
  activeWorkMocks.useActiveWorkCounts.mockReturnValue({ needsInput: 0, running: 0 })
  useUIState.setState({ isToolRailMounted: false })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('ToolSidePanel', () => {
  it('shows the tool name in a tooltip when hovering a rail icon', async () => {
    const user = userEvent.setup()
    renderAt('')

    await user.hover(screen.getByRole('button', { name: 'Terminal' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Terminal')
  })

  it('shows the home route tools without a repo', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/']}>
        <HomeHarness />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Terminal' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(await screen.findByText(/files-tool/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All Schedules' }))
    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/schedules'))
  })

  it('moves a panel tool opened as a dialog into the docked panel', async () => {
    renderAt('?dialog=walkthrough')

    expect(await screen.findByText('walkthrough-tool')).toBeInTheDocument()
    expect(search().get('panel')).toBe('walkthrough')
    expect(search().has('dialog')).toBe(false)
  })

  it('leaves non-panel dialogs alone', async () => {
    renderAt('?dialog=resetPermissions&panel=files')

    expect(await screen.findByText('files-tool src/a.ts')).toBeInTheDocument()
    expect(search().get('dialog')).toBe('resetPermissions')
  })

  it.each([
    ['Preview', 'preview-tool'],
    ['MCP', 'mcp-tool'],
    ['Actions', 'actions-tool'],
    ['Skills', 'skills-tool'],
  ])('opens %s inside the docked panel', async (label, content) => {
    const user = userEvent.setup()
    renderAt('')

    await user.click(screen.getByRole('button', { name: label }))

    expect(await screen.findByText(content)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    expect(search().has('dialog')).toBe(false)
  })

  it('moves a preview opened with a port into the panel and keeps its port', async () => {
    renderAt('?panel=terminal&terminal=pty-1&dialog=preview&previewPort=5173&previewPath=%2F')

    expect(await screen.findByText('preview-tool')).toBeInTheDocument()
    expect(search().get('panel')).toBe('preview')
    expect(search().get('previewPort')).toBe('5173')
    expect(search().has('terminal')).toBe(false)
  })

  it('toggles tools from the rail and closes the panel', async () => {
    const user = userEvent.setup()
    renderAt('')

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Source Control' }))
    expect(await screen.findByText('source-control-tool')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Source Control' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(await screen.findByText('terminal-tool')).toBeInTheDocument()
    expect(screen.queryByText('source-control-tool')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    await waitFor(() => expect(screen.queryByText('terminal-tool')).not.toBeInTheDocument())
    expect(search().has('panel')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(await screen.findByRole('button', { name: 'Close panel' }))
    await waitFor(() => expect(search().has('panel')).toBe(false))
  })

  it('renders the panel as a modal sheet over the page when docking would squeeze it', async () => {
    const removePage = stubNarrowPage()

    try {
      renderAt('?panel=files')

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
      renderAt('?panel=files')

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
      renderAt('')

      const filesButton = screen.getByRole('button', { name: 'Files' })
      await user.click(filesButton)
      const panel = await screen.findByRole('dialog', { name: 'Files' })

      await waitFor(() => expect(document.activeElement).toBe(panel))

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Files' })).not.toBeInTheDocument())
      await waitFor(() => expect(document.activeElement).toBe(filesButton))
      expect(search().has('panel')).toBe(false)
    } finally {
      removePage()
    }
  })

  it('closes the floating panel on Escape and on an outside click', async () => {
    const user = userEvent.setup()
    const removePage = stubNarrowPage()

    try {
      renderAt('?panel=files')

      await screen.findByRole('dialog', { name: 'Files' })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(search().has('panel')).toBe(false))

      await user.click(screen.getByRole('button', { name: 'Files' }))
      await screen.findByRole('dialog', { name: 'Files' })

      await user.click(screen.getByTestId('tool-panel-backdrop'))
      await waitFor(() => expect(search().has('panel')).toBe(false))
    } finally {
      removePage()
    }
  })

  it('keeps the floating terminal open on Escape typed into the terminal', async () => {
    const user = userEvent.setup()
    const removePage = stubNarrowPage()

    try {
      renderAt('?panel=terminal&terminal=pty-1')

      await screen.findByRole('dialog', { name: 'Terminal' })
      const terminalInput = screen.getByLabelText('terminal input')
      await user.click(terminalInput)
      await user.keyboard('{Escape}')

      expect(screen.getByRole('dialog', { name: 'Terminal' })).toBeInTheDocument()
      expect(search().get('panel')).toBe('terminal')
    } finally {
      removePage()
    }
  })

  it('keeps a docked panel open on Escape', async () => {
    const user = userEvent.setup()
    renderAt('?panel=files')

    await screen.findByRole('complementary', { name: 'Files' })
    await user.keyboard('{Escape}')

    expect(search().get('panel')).toBe('files')
  })

  it('resizes the docked panel from the keyboard and clamps it', async () => {
    const user = userEvent.setup()
    renderAt('?panel=files')

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
    render(
      <MemoryRouter initialEntries={['/repos/1']}>
        <RepoHarness />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Secrets' }))

    expect(await screen.findByText('secrets-tool')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Secrets' })).toBeInTheDocument()
    expect(search().has('dialog')).toBe(false)
  })

  it('opens non-panel session items from the rail as dialogs', async () => {
    const user = userEvent.setup()
    renderAt('?panel=files')

    await user.click(screen.getByRole('button', { name: 'Reset Permissions' }))

    await waitFor(() => expect(search().get('dialog')).toBe('resetPermissions'))
    expect(search().get('panel')).toBe('files')
  })

  it('opens schedules in the panel without leaving the session', async () => {
    const user = userEvent.setup()
    renderAt('?panel=files')

    await user.click(screen.getByRole('button', { name: 'Schedules' }))

    expect(await screen.findByText('schedules-tool 1')).toBeInTheDocument()
    expect(screen.getByTestId('pathname').textContent).toBe('/repos/1/sessions/ses_1')
    expect(search().get('panel')).toBe('schedules')
  })

  it('drops schedule selection params when switching away from schedules', async () => {
    const user = userEvent.setup()
    renderAt('?panel=schedules&jobId=4&scheduleTab=runs&runId=9')

    await user.click(await screen.findByRole('button', { name: 'Terminal' }))

    await waitFor(() => expect(search().get('panel')).toBe('terminal'))
    expect(search().has('jobId')).toBe(false)
    expect(search().has('scheduleTab')).toBe(false)
    expect(search().has('runId')).toBe(false)
  })

  it('closes a docked schedules panel when the layout is no longer docked', async () => {
    renderAt('?panel=schedules&jobId=4', false)

    await waitFor(() => expect(search().has('panel')).toBe(false))
    expect(search().has('dialog')).toBe(false)
    expect(search().has('jobId')).toBe(false)
  })

  it('drops terminal selection params when switching away from the terminal', async () => {
    const user = userEvent.setup()
    renderAt('?panel=terminal&terminal=pty-1')

    await user.click(await screen.findByRole('button', { name: 'Files' }))

    await waitFor(() => expect(search().get('panel')).toBe('files'))
    expect(search().has('terminal')).toBe(false)
  })

  it('closes the docked terminal panel when the last terminal exits', async () => {
    const user = userEvent.setup()
    renderAt('?panel=terminal&terminal=pty-1')

    await user.click(await screen.findByRole('button', { name: 'Exit last terminal' }))

    await waitFor(() => expect(search().has('panel')).toBe(false))
    expect(search().has('terminal')).toBe(false)
  })

  it('falls back to the dialog when not docked', async () => {
    renderAt('?panel=sourceControl', false)

    await waitFor(() => expect(search().get('dialog')).toBe('sourceControl'))
    expect(search().has('panel')).toBe(false)
  })

  it('moves focus to the chat prompt when the docked panel closes on desktop', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()
    renderAt('')

    await user.click(screen.getByRole('button', { name: 'Files' }))
    const closeButton = await screen.findByRole('button', { name: 'Close panel' })
    closeButton.focus()

    await user.click(closeButton)

    await waitFor(() => expect(search().has('panel')).toBe(false))
    expect(screen.getByLabelText('prompt')).toHaveFocus()
  })

  it('lists the Sessions tool first in the rail', () => {
    renderAt('')

    const rail = screen.getByRole('navigation', { name: 'Tools' })
    const buttons = within(rail).getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName('Sessions')
  })

  it('shows only the remote-capable tools on a linked-server route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/servers/srv_kitchen/sessions/ses_remote']}>
        <RemoteHarness />
      </MemoryRouter>,
    )

    const rail = screen.getByRole('navigation', { name: 'Tools' })
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
    ).toEqual(['Sessions', 'MCP', 'Skills', 'Source Control', 'Terminal'])

    await user.click(screen.getByRole('button', { name: 'MCP' }))
    expect(await screen.findByText('mcp-tool')).toBeInTheDocument()
  })

  it('opens the remote source control panel for a linked-server session', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/servers/srv_kitchen/sessions/ses_remote']}>
        <RemoteHarness />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Source Control' }))

    expect(
      await screen.findByText('remote-source-control-tool srv_kitchen /home/me/app'),
    ).toBeInTheDocument()
    expect(search().get('panel')).toBe('sourceControl')
    expect(screen.queryByText('source-control-tool')).not.toBeInTheDocument()
  })

  it('opens the skills panel for a linked-server session', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/servers/srv_kitchen/sessions/ses_remote']}>
        <RemoteHarness />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Skills' }))

    expect(await screen.findByText('skills-tool')).toBeInTheDocument()
    expect(search().get('panel')).toBe('skills')
  })

  it('opens the Sessions panel with the session picker when clicked', async () => {
    const user = userEvent.setup()
    renderAt('')

    await user.click(screen.getByRole('button', { name: 'Sessions' }))

    const panel = await screen.findByRole('complementary', { name: 'Sessions' })
    expect(within(panel).getByText('route-session-picker')).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(search().get('panel')).toBe('sessions')
  })

  it('keeps the docked Sessions panel open when a session is chosen', async () => {
    const user = userEvent.setup()
    renderAt('?panel=sessions')

    await user.click(await screen.findByRole('button', { name: 'open other session' }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/repos/2/sessions/other'))
    expect(search().get('panel')).toBe('sessions')
  })

  it('builds the docked picker navigation in panel mode', async () => {
    renderAt('?panel=sessions')

    await screen.findByText('route-session-picker')

    expect(sessionPickerMocks.useSessionPickerNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'panel', onClose: expect.any(Function) }),
    )
  })

  it('builds the floating picker navigation in replace mode', async () => {
    const removePage = stubNarrowPage()

    try {
      renderAt('?panel=sessions')

      const panel = await screen.findByRole('dialog', { name: 'Sessions' })
      expect(within(panel).getByText('route-session-picker')).toBeInTheDocument()
      expect(sessionPickerMocks.useSessionPickerNavigation).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: 'replace', onClose: expect.any(Function) }),
      )
    } finally {
      removePage()
    }
  })

  it('forwards the delete override to the session picker', async () => {
    const onDeleteActiveSession = vi.fn()
    renderAt('?panel=sessions', true, onDeleteActiveSession)

    await screen.findByText('route-session-picker')

    expect(sessionPickerMocks.useSessionPickerNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ onDeleteActiveSession }),
    )
  })

  it('shows a Sessions count pill and extends the accessible name', () => {
    activeWorkMocks.useActiveWorkCounts.mockReturnValue({ needsInput: 1, running: 2 })
    renderAt('')

    const button = screen.getByRole('button', { name: 'Sessions, 1 needs input, 2 running' })
    const pill = within(button).getByText('3')
    expect(pill.className).toContain('bg-warning')
  })

  it('marks the tool rail as mounted only while it renders', () => {
    const { unmount } = renderAt('')

    expect(useUIState.getState().isToolRailMounted).toBe(true)

    unmount()

    expect(useUIState.getState().isToolRailMounted).toBe(false)
  })
})
