import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Repo, Session } from '@/api/types'
import type { ActiveWorkItem } from '@/lib/activeWork'
import { stubMatchMedia } from '@/test/test-utils'
import { ToolSidePanel } from './ToolSidePanel'
import { useToolPanel } from '@/hooks/useToolPanel'

const activityMocks = vi.hoisted(() => ({
  useActiveWork: vi.fn(),
  useActiveWorkCounts: vi.fn(),
  useActivityWindowMinutes: vi.fn(),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: activityMocks.useActiveWork,
  useActiveWorkCounts: activityMocks.useActiveWorkCounts,
  useActivityWindowMinutes: activityMocks.useActivityWindowMinutes,
}))

vi.mock('@/components/file-browser/FileBrowser', () => ({
  FileBrowser: ({ initialSelectedFile }: { initialSelectedFile?: string }) => <div>files-tool {initialSelectedFile}</div>,
}))
vi.mock('@/components/source-control', () => ({
  SourceControlContent: () => <div>source-control-tool</div>,
}))
vi.mock('@/components/terminal/TerminalPanel', () => ({
  TerminalWorkspace: () => <div>terminal-tool</div>,
}))
vi.mock('@/components/preview/PreviewPanel', () => ({ PreviewWorkspace: () => <div>preview-tool</div> }))
vi.mock('@/components/schedules/RepoSchedulesContent', () => ({
  RepoSchedulesContent: ({ repoId }: { repoId: number }) => <div>schedules-tool {repoId}</div>,
}))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpContent: () => <div>mcp-tool</div> }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsContent: () => <div>actions-tool</div> }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsContent: () => <div>skills-tool</div> }))
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

function Harness({ docked }: { docked: boolean }) {
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
        />
      ) : null}
      <LocationProbe />
    </>
  )
}

function renderAt(search: string, docked = true) {
  return render(
    <MemoryRouter initialEntries={[`/repos/1/sessions/ses_1${search}`]}>
      <Harness docked={docked} />
    </MemoryRouter>,
  )
}

function search(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('search').textContent ?? '')
}

const WINDOW_MINUTES = 30
const NOW = Date.now()

function createSession(id: string, title: string, updated = NOW - 60_000): Session {
  return {
    id,
    projectID: 'proj-1',
    title,
    time: { created: updated - 10000, updated },
    location: { directory: `/repos/${id}` },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function createRepo(id: number, name: string): Repo {
  return {
    id,
    name,
    fullPath: `/repos/${id}`,
    localPath: `/repos/${id}`,
    defaultBranch: 'main',
    currentBranch: 'feature/x',
    cloneStatus: 'ready',
    clonedAt: 0,
  }
}

function createActivityItem(id: string, title: string, repoId: number, repoName: string): ActiveWorkItem {
  const session = createSession(id, title)
  const repo = createRepo(repoId, repoName)
  return {
    key: `${repoId}:${id}`,
    session,
    repo,
    state: 'recent',
    updatedAt: session.time.updated,
    path: `/repos/${repoId}/sessions/${id}`,
  }
}

function setActivityGroups(items: ActiveWorkItem[] = []) {
  activityMocks.useActiveWork.mockReturnValue({
    groups: { needsInput: [], running: [], recent: items },
    isLoading: false,
    isError: false,
  })
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

beforeEach(() => {
  vi.clearAllMocks()
  activityMocks.useActiveWorkCounts.mockReturnValue({ needsInput: 0, running: 0 })
  activityMocks.useActivityWindowMinutes.mockReturnValue(WINDOW_MINUTES)
  setActivityGroups()
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

  it('lists the Activity tool first in the rail', () => {
    renderAt('')

    const rail = screen.getByRole('navigation', { name: 'Tools' })
    const buttons = within(rail).getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName('Activity')
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
    ).toEqual(['Activity', 'MCP', 'Skills'])

    await user.click(screen.getByRole('button', { name: 'MCP' }))
    expect(await screen.findByText('mcp-tool')).toBeInTheDocument()
  })

  it('opens the Activity panel with rows and the window label when clicked', async () => {
    const user = userEvent.setup()
    setActivityGroups([createActivityItem('other', 'Other Session', 2, 'Beta')])
    renderAt('')

    await user.click(screen.getByRole('button', { name: 'Activity' }))

    expect(await screen.findByText('Other Session')).toBeInTheDocument()
    expect(search().get('panel')).toBe('activity')
    expect(screen.getByRole('complementary', { name: 'Activity' })).toHaveClass('w-80')
    expect(screen.getByText('Last 30 minutes')).toBeInTheDocument()
  })

  it('keeps the Activity panel open when a row navigates to a session', async () => {
    const user = userEvent.setup()
    setActivityGroups([createActivityItem('other', 'Other Session', 2, 'Beta')])
    renderAt('')

    await user.click(screen.getByRole('button', { name: 'Activity' }))
    await user.click(await screen.findByRole('button', { name: /Other Session/ }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/repos/2/sessions/other'))
    expect(search().get('panel')).toBe('activity')
  })

  it('keeps a worktree session tab when navigating from the Activity panel', async () => {
    const user = userEvent.setup()
    setActivityGroups([
      {
        ...createActivityItem('wt', 'Worktree Session', 2, 'Beta'),
        path: '/repos/2/sessions/wt?repoTab=workspaces',
      },
    ])
    renderAt('')

    await user.click(screen.getByRole('button', { name: 'Activity' }))
    await user.click(await screen.findByRole('button', { name: /Worktree Session/ }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/repos/2/sessions/wt'))
    expect(search().get('repoTab')).toBe('workspaces')
    expect(search().get('panel')).toBe('activity')
  })

  it('shows an Activity count pill and extends the accessible name', () => {
    activityMocks.useActiveWorkCounts.mockReturnValue({ needsInput: 1, running: 2 })
    renderAt('')

    const button = screen.getByRole('button', { name: 'Activity, 1 needs input, 2 running' })
    const pill = within(button).getByText('3')
    expect(pill.className).toContain('bg-warning')
  })
})
