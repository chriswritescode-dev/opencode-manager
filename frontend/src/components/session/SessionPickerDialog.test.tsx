import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { OpenCodeProject } from '@/api/opencode'
import type { Repo } from '@/api/types'
import type { UserPreferences } from '@/api/types/settings'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { installMatchMedia } from '@/test/browserFakes'
import { makeOpenCodeServer, makeRepo, makeSession, makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { createSessionServer, type SessionServer } from '@/test/fixtures/sessionServer'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { SessionPickerDialog } from './SessionPickerDialog'

const repos: Repo[] = [
  makeRepo({ id: 1, name: 'alpha', fullPath: '/w/a', localPath: '/w/a' }),
  makeRepo({ id: 2, name: 'beta', fullPath: '/w/b', localPath: '/w/b' }),
]

function session(id: string, title: string, directory = '/w/a', updated = Date.now(), parentID?: string) {
  const info = makeSession({ id, title, location: { directory }, time: { created: updated, updated } })
  if (parentID) info.parentID = parentID
  return info
}

function deferred() {
  let resolve: (result: FetchRouteResult) => void = () => undefined
  const promise = new Promise<FetchRouteResult>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })

interface RenderPickerOptions {
  currentRepo?: Repo | undefined
  activeSessionID?: string
  preferences?: Partial<UserPreferences>
  remote?: { serverId: string; serverName?: string; projectDirectory?: string }
  open?: boolean
  onOpenChange?: (open: boolean) => void
  finePointer?: boolean
}

function settingsRoute(preferences: Partial<UserPreferences>): FetchRoute {
  return {
    method: 'GET',
    path: '/api/settings',
    respond: () => ({ json: makeSettingsResponse({ preferences: makeUserPreferences(preferences) }) }),
  }
}

function renderPicker(server: SessionServer, options: RenderPickerOptions = {}) {
  installMatchMedia(options.finePointer ?? true)
  const onOpenChange = options.onOpenChange ?? vi.fn()
  const onSelectSession = vi.fn()
  const onSelectRemoteSession = vi.fn()
  const onDeleteActiveSession = vi.fn()
  const onSelectRepo = vi.fn()
  const onNavigate = vi.fn()
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <SessionPickerDialog
        open={options.open ?? true}
        onOpenChange={onOpenChange}
        currentRepo={'currentRepo' in options ? options.currentRepo : repos[0]}
        activeSessionID={options.activeSessionID}
        onSelectSession={onSelectSession}
        onSelectRemoteSession={onSelectRemoteSession}
        onDeleteActiveSession={onDeleteActiveSession}
        onSelectRepo={onSelectRepo}
        onNavigate={onNavigate}
        remote={options.remote}
      />
    </KeyboardShortcutsProvider>,
    {
      events: true,
      fetchRoutes: [
        ...(options.preferences ? [settingsRoute(options.preferences)] : []),
        ...server.routes,
      ],
    },
  )
  return {
    ...result,
    onOpenChange,
    onSelectSession,
    onSelectRemoteSession,
    onDeleteActiveSession,
    onSelectRepo,
    onNavigate,
  }
}

const combobox = () => screen.getByRole('combobox')

const openProjectsTab = () => {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
}

const openActiveTab = () => {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
}

function listDirectories(server: SessionServer) {
  return server
    .sessionRequests()
    .map((request) => request.searchParams.get('directory'))
}

describe('SessionPickerDialog', () => {
  it('opens with the active session as the cursor and marks it with a dot', async () => {
    const server = createSessionServer({
      repos,
      sessions: [
        session('ses_active', 'Active session', '/w/a', 3000),
        session('ses_other', 'Other session', '/w/a', 2000),
      ],
    })

    renderPicker(server, { activeSessionID: 'ses_active' })

    const active = await screen.findByRole('option', { name: /Active session/ })
    const other = screen.getByRole('option', { name: /Other session/ })
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(active.textContent).toContain('●')
    expect(other).toHaveAttribute('aria-selected', 'false')
  })

  it('filters rows immediately as the query is typed', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_alpha', 'alpha task', '/w/a', 2000), session('ses_beta', 'beta task', '/w/a', 1000)],
    })

    renderPicker(server)

    await screen.findByText('alpha task')
    fireEvent.change(combobox(), { target: { value: 'beta' } })

    expect(screen.queryByText('alpha task')).not.toBeInTheDocument()
    expect(screen.getByText('beta task')).toBeInTheDocument()
  })

  it('moves the cursor with arrow keys and Ctrl+N/Ctrl+P, wrapping, and opens the row on Enter', async () => {
    const server = createSessionServer({
      repos,
      sessions: [
        session('ses_1', 'First', '/w/a', 3000),
        session('ses_2', 'Second', '/w/a', 2000),
        session('ses_3', 'Third', '/w/a', 1000),
      ],
    })
    const { onSelectSession } = renderPicker(server)

    const first = await screen.findByRole('option', { name: /First/ })
    const second = screen.getByRole('option', { name: /Second/ })
    const third = screen.getByRole('option', { name: /Third/ })

    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(second).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowUp' })
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowUp' })
    expect(third).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'n', ctrlKey: true })
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'p', ctrlKey: true })
    expect(third).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'Enter' })
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'ses_3' }), repos[0])
  })

  it('toggles scope with Ctrl+A, persists it, and queries every repo directory with repo labels', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_a', 'Alpha session', '/w/a', 2000), session('ses_b', 'Beta session', '/w/b', 1000)],
    })

    renderPicker(server)

    await screen.findByText('Alpha session')
    expect(listDirectories(server)).toEqual(['/w/a'])
    expect(screen.getByRole('tab', { name: 'This project' })).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'a', ctrlKey: true })

    await screen.findByText('Beta session')
    expect(listDirectories(server).at(-1)).toBeNull()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('true')
    expect(screen.getByRole('tab', { name: 'All sessions' })).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'a', ctrlKey: true })

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument(),
    )
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('false')
    expect(listDirectories(server)).toContain('/w/a')
  })

  it('toggles the scope when the selected sessions tab is clicked again', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({
      repos,
      sessions: [session('ses_a', 'Alpha session', '/w/a', 2000), session('ses_b', 'Beta session', '/w/b', 1000)],
    })
    renderPicker(server)

    await user.click(screen.getByRole('tab', { name: 'This project' }))

    expect(await screen.findByRole('tab', { name: 'All sessions', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('true')

    await user.click(screen.getByRole('tab', { name: 'All sessions' }))

    expect(await screen.findByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('false')
  })

  it('selects the sessions tab without toggling the scope when it was not selected', async () => {
    const user = userEvent.setup()
    renderPicker(createSessionServer({ repos }))

    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    await user.click(screen.getByRole('tab', { name: 'This project' }))

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBeNull()
  })

  it('toggles the scope with Enter on the focused selected sessions tab', async () => {
    const user = userEvent.setup()
    renderPicker(createSessionServer({ repos }))

    await waitFor(() => expect(combobox()).toHaveFocus())

    const sessionsTab = screen.getByRole('tab', { name: 'This project' })
    act(() => {
      sessionsTab.focus()
    })
    expect(sessionsTab).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(await screen.findByRole('tab', { name: 'All sessions', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('true')
  })

  it('labels the sessions tab Sessions and lists every project without a current repo', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_a', 'Alpha session', '/w/a', 2000), session('ses_b', 'Beta session', '/w/b', 1000)],
    })

    renderPicker(server, { currentRepo: undefined })

    expect(await screen.findByRole('tab', { name: 'Sessions', selected: true })).toBeInTheDocument()
    expect(listDirectories(server).at(-1)).toBeNull()
    expect(await screen.findByText('Beta session')).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBeNull()
  })

  it('leaves the persisted scope preference unchanged on Ctrl+A without a current repo', async () => {
    localStorage.setItem('oc:session-picker:all-projects', 'false')
    renderPicker(createSessionServer({ repos }), { currentRepo: undefined })

    await screen.findByRole('tab', { name: 'Sessions', selected: true })
    fireEvent.keyDown(combobox(), { key: 'a', ctrlKey: true })

    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('false')
    expect(screen.getByRole('tab', { name: 'Sessions', selected: true })).toBeInTheDocument()
  })

  it('starts a new session in the current repo from the sessions tab header action', async () => {
    const server = createSessionServer({ repos })
    const { onNavigate } = renderPicker(server)

    fireEvent.click(await screen.findByRole('button', { name: 'New session in alpha' }))

    await waitFor(() => expect(server.createdDirectories()).toEqual(['/w/a']))
    expect(onNavigate).toHaveBeenCalledWith('/repos/1/sessions/ses_new')
  })

  it('opens the add repository dialog from the projects tab header action', async () => {
    renderPicker(createSessionServer({ repos }))

    openProjectsTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(await screen.findByRole('dialog', { name: 'Add Repository' })).toBeInTheDocument()
  })

  it('starts a new session in a project row and marks a repo that is not ready', async () => {
    const server = createSessionServer({
      repos: [
        repos[0],
        makeRepo({ id: 2, name: 'beta', fullPath: '/w/b', localPath: '/w/b', cloneStatus: 'cloning' }),
      ],
    })
    const { onNavigate } = renderPicker(server)

    openProjectsTab()

    fireEvent.click(await screen.findByRole('button', { name: 'New session in alpha' }))

    await waitFor(() => expect(server.createdDirectories()).toEqual(['/w/a']))
    expect(onNavigate).toHaveBeenCalledWith('/repos/1/sessions/ses_new')
    expect(screen.queryByRole('button', { name: 'New session in beta' })).not.toBeInTheDocument()
    expect(screen.getByText('Not ready')).toBeInTheDocument()
  })

  it('lists project sessions across worktrees and labels them with the folder name', async () => {
    const server = createSessionServer({
      repos: [repos[0]],
      locationProject: { id: 'proj_x', directory: '/w/a', canonical: '/w/a' },
      sessions: [
        session('ses_root', 'Root session', '/w/a', 3000),
        session('ses_wt', 'Worktree session', '/w/.opencode/state/opencode/worktree/proj_x/test', 2000),
        session('ses_schedule', 'Schedule session', '/w/schedule-worktrees/job-11-run-361', 1000),
      ],
    })

    renderPicker(server)

    expect(await screen.findByText('Worktree session')).toBeInTheDocument()
    expect(screen.getByText('Schedule session')).toBeInTheDocument()
    expect(screen.getByText('Root session')).toBeInTheDocument()
    const rootRow = screen.getByRole('option', { name: /Root session/ })
    const worktreeRow = screen.getByRole('option', { name: /Worktree session/ })
    const scheduleRow = screen.getByRole('option', { name: /Schedule session/ })
    expect(worktreeRow.textContent).toContain('test')
    expect(scheduleRow.textContent).toContain('job-11-run-361')
    expect(rootRow.textContent).not.toContain('test')
    expect(rootRow.textContent).not.toContain('job-11-run-361')

    await waitFor(() => {
      const request = server.sessionRequests().at(-1)
      expect(request?.searchParams.get('project')).toBe('proj_x')
      expect(request?.searchParams.get('subpath')).toBe('')
    })
  })

  it('falls back to the repo directory listing when the location project is global', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_a', 'Alpha session', '/w/a', 2000), session('ses_b', 'Beta session', '/w/b', 1000)],
    })

    renderPicker(server)

    expect(await screen.findByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
    expect(listDirectories(server)).toEqual(['/w/a'])
  })

  it('falls back to the repo directory listing when the location lookup fails', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_a', 'Alpha session', '/w/a', 2000), session('ses_b', 'Beta session', '/w/b', 1000)],
      locationRespond: () => ({ status: 500, json: { error: 'location unavailable' } }),
    })

    renderPicker(server)

    expect(await screen.findByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
    expect(listDirectories(server)).toEqual(['/w/a'])
  })

  it('does not issue a directory listing while the location is pending', async () => {
    const location = deferred()
    const server = createSessionServer({
      repos,
      sessions: [session('ses_a', 'Alpha session', '/w/a', 2000)],
      locationRespond: () => location.promise,
    })

    renderPicker(server)

    expect(screen.getByText('Loading sessions...')).toBeInTheDocument()
    expect(server.sessionRequests()).toHaveLength(0)
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()

    location.resolve({
      json: { directory: '/w/a', project: { id: 'global', directory: '/w/a', canonical: '/w/a' } },
    })

    expect(await screen.findByText('Alpha session')).toBeInTheDocument()
  })

  it('does not query sessions while closed and queries after opening', async () => {
    const server = createSessionServer({ repos, sessions: [session('ses_1', 'First', '/w/a', 3000)] })

    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open-picker</button>
          <SessionPickerDialog
            open={open}
            onOpenChange={setOpen}
            currentRepo={repos[0]}
            onSelectSession={vi.fn()}
            onDeleteActiveSession={vi.fn()}
            onSelectRepo={vi.fn()}
            onNavigate={vi.fn()}
          />
        </>
      )
    }

    renderWithProviders(
      <KeyboardShortcutsProvider>
        <Host />
      </KeyboardShortcutsProvider>,
      { events: true, fetchRoutes: server.routes },
    )

    expect(server.sessionRequests()).toHaveLength(0)

    fireEvent.click(screen.getByText('open-picker'))

    await waitFor(() => expect(server.sessionRequests().length).toBeGreaterThan(0))
  })

  it('deletes on a second Ctrl+D and clears the pending state on a move', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_1', 'First', '/w/a', 3000), session('ses_2', 'Second', '/w/a', 2000)],
    })
    const { onDeleteActiveSession } = renderPicker(server)

    await screen.findByRole('option', { name: /First/ })
    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Press Ctrl\+D again/ })).toBeInTheDocument(),
    )
    expect(server.deletedSessionIDs()).toHaveLength(0)

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    await waitFor(() => expect(screen.queryByText(/Press Ctrl\+D again/)).not.toBeInTheDocument())

    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Press Ctrl\+D again/ })).toBeInTheDocument(),
    )

    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })

    await waitFor(() => expect(server.deletedSessionIDs()).toEqual(['ses_2']))
    expect(onDeleteActiveSession).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText(/Press Ctrl\+D again/)).not.toBeInTheDocument())
  })

  it('notifies when the active session is deleted before the delete completes', async () => {
    const deletion = deferred()
    const server = createSessionServer({
      repos,
      sessions: [session('ses_active', 'Active', '/w/a', 3000)],
      deleteRespond: () => deletion.promise,
    })
    const { onDeleteActiveSession } = renderPicker(server, { activeSessionID: 'ses_active' })

    await screen.findByRole('option', { name: /Active/ })
    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })

    await waitFor(() => expect(onDeleteActiveSession).toHaveBeenCalled())
    expect(server.deletedSessionIDs()).toEqual(['ses_active'])

    deletion.resolve({ status: 204 })
  })

  it('moves the cursor when a mouse pointer moves over a row', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_1', 'First', '/w/a', 3000), session('ses_2', 'Second', '/w/a', 2000)],
    })
    renderPicker(server)

    const second = await screen.findByRole('option', { name: /Second/ })
    const pointerMove = new Event('pointermove', { bubbles: true })
    Object.defineProperty(pointerMove, 'pointerType', { value: 'mouse' })
    fireEvent(second, pointerMove)

    expect(second).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the delete confirmation from the row menu', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({ repos, sessions: [session('ses_1', 'First', '/w/a', 3000)] })
    renderPicker(server)

    await user.click(await screen.findByRole('button', { name: 'Session actions' }))
    await user.click(await screen.findByText('Delete'))

    expect(await screen.findByRole('dialog', { name: 'Delete Session' })).toBeInTheDocument()
  })

  it('groups older sessions under per-day headings', async () => {
    const server = createSessionServer({
      repos,
      sessions: [
        session('ses_jan2', 'Jan two', '/w/a', new Date(2020, 0, 2, 12).getTime()),
        session('ses_jan1', 'Jan one', '/w/a', new Date(2020, 0, 1, 12).getTime()),
      ],
    })

    renderPicker(server)

    expect(await screen.findByText('Thu, Jan 2, 2020')).toBeInTheDocument()
    expect(screen.getByText('Wed, Jan 1, 2020')).toBeInTheDocument()
  })

  it('resets the query and cursor on reopen', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_active', 'Active session', '/w/a', 3000), session('ses_other', 'Other session', '/w/a', 2000)],
    })

    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>close-picker</button>
          <button type="button" onClick={() => setOpen(true)}>open-picker</button>
          <SessionPickerDialog
            open={open}
            onOpenChange={setOpen}
            currentRepo={repos[0]}
            activeSessionID="ses_active"
            onSelectSession={vi.fn()}
            onDeleteActiveSession={vi.fn()}
            onSelectRepo={vi.fn()}
            onNavigate={vi.fn()}
          />
        </>
      )
    }

    renderWithProviders(
      <KeyboardShortcutsProvider>
        <Host />
      </KeyboardShortcutsProvider>,
      { events: true, fetchRoutes: server.routes },
    )

    await screen.findByRole('option', { name: /Active session/ })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Other' } })
    expect(screen.queryByText('Active session')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('close-picker'))
    fireEvent.click(screen.getByText('open-picker'))

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''))
    expect(await screen.findByRole('option', { name: /Active session/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('renders an Activity/Sessions/Projects tab switcher and defaults to the sessions tab', () => {
    renderPicker(createSessionServer({ repos }))

    expect(screen.getByRole('tab', { name: 'This project' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'false')
    expect(combobox()).toHaveAttribute('placeholder', 'Search sessions...')
  })

  it('exposes a tabpanel labelled by the active tab and swaps panels on tab switch', async () => {
    renderPicker(createSessionServer({ repos }))

    const sessionsPanel = screen.getByRole('tabpanel', { name: 'This project' })
    expect(sessionsPanel).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tabpanel', { name: 'Projects' })).not.toBeInTheDocument()

    openProjectsTab()

    const projectsPanel = await screen.findByRole('tabpanel', { name: 'Projects' })
    expect(projectsPanel).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tabpanel', { name: 'This project' })).not.toBeInTheDocument()
  })

  it('focuses the projects search input after clicking the Projects tab and filters on typing', async () => {
    const user = userEvent.setup()
    renderPicker(createSessionServer({ repos }))

    await user.click(screen.getByRole('tab', { name: 'Projects' }))

    await waitFor(() => expect(screen.getByPlaceholderText('Search projects...')).toHaveFocus())

    await user.keyboard('beta')

    expect(screen.getByRole('option', { name: /beta/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /alpha/ })).not.toBeInTheDocument()
  })

  it.each([
    [true, 'fine pointer'],
    [false, 'coarse pointer'],
  ] as const)('focuses the projects search input after switching tabs with the shortcut on a %s', async (finePointer) => {
    const user = userEvent.setup()
    const server = createSessionServer({ repos })
    renderPicker(server, { finePointer })

    await user.click(combobox())
    await user.keyboard('{Control>}s{/Control}')

    await waitFor(() => expect(screen.getByPlaceholderText('Search projects...')).toHaveFocus())
  })

  it('does not focus the projects search input when switching tabs by pointer on a coarse pointer device', async () => {
    const user = userEvent.setup()
    renderPicker(createSessionServer({ repos }), { finePointer: false })

    await user.click(screen.getByRole('tab', { name: 'Projects' }))

    expect(await screen.findByPlaceholderText('Search projects...')).not.toHaveFocus()
  })

  it('lists repos in the projects tab and opens the cursor repo on Enter', async () => {
    const server = createSessionServer({ repos })
    const { onSelectRepo } = renderPicker(server)

    openProjectsTab()

    const alpha = await screen.findByRole('option', { name: /alpha/ })
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /beta/ })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'Enter' })

    expect(onSelectRepo).toHaveBeenCalledWith(repos[0])
  })

  it('navigates the projects tab with wrapping arrows, PageUp/PageDown and Enter', async () => {
    const server = createSessionServer({
      repos: Array.from({ length: 12 }, (_, index) =>
        makeRepo({
          id: index + 1,
          name: `repo-${index + 1}`,
          fullPath: `/w/r${index + 1}`,
          localPath: `/w/r${index + 1}`,
          currentBranch: undefined,
          branch: undefined,
        }),
      ),
    })
    const { onSelectRepo } = renderPicker(server, { currentRepo: undefined })

    openProjectsTab()

    expect(await screen.findByRole('option', { name: 'repo-1' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: 'repo-12' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'repo-1' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'PageDown' })
    expect(screen.getByRole('option', { name: 'repo-11' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'Enter' })
    expect(onSelectRepo).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }))

    fireEvent.keyDown(combobox(), { key: 'PageUp' })
    expect(screen.getByRole('option', { name: 'repo-1' })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens a repo on click in the projects tab', async () => {
    const server = createSessionServer({ repos })
    const { onSelectRepo } = renderPicker(server)

    openProjectsTab()

    fireEvent.click(await screen.findByRole('option', { name: /beta/ }))

    expect(onSelectRepo).toHaveBeenCalledWith(repos[1])
  })

  it('filters projects by name and branch', async () => {
    const server = createSessionServer({
      repos: [
        makeRepo({ id: 1, name: 'alpha', fullPath: '/w/a', localPath: '/w/a', currentBranch: 'feature/x' }),
        repos[1],
      ],
    })
    renderPicker(server)

    openProjectsTab()
    await screen.findByRole('option', { name: /alpha/ })

    fireEvent.change(combobox(), { target: { value: 'beta' } })
    expect(screen.queryByRole('option', { name: /alpha/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /beta/ })).toBeInTheDocument()

    fireEvent.change(combobox(), { target: { value: 'feature/x' } })
    expect(screen.getByRole('option', { name: /alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /beta/ })).not.toBeInTheDocument()
  })

  it('shows the empty projects state when nothing matches', async () => {
    renderPicker(createSessionServer({ repos }))

    openProjectsTab()
    await screen.findByRole('option', { name: /alpha/ })

    fireEvent.change(combobox(), { target: { value: 'zzz' } })

    expect(screen.getByText('No projects found')).toBeInTheDocument()
  })

  it('cycles Activity, Sessions and Projects with the default Ctrl+S binding', async () => {
    renderPicker(createSessionServer({ repos }))

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 's', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'Projects', selected: true })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 's', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'Activity', selected: true })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 's', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
  })

  it('honors a configured switch binding and shows it in the footer', async () => {
    renderPicker(createSessionServer({ repos }), {
      preferences: { keyboardShortcuts: { switchPickerTab: 'Ctrl+G' } },
    })

    expect(await screen.findByText(/Ctrl\+G projects/)).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'g', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'Projects', selected: true })).toBeInTheDocument()

    expect(screen.getByText(/Ctrl\+G active/)).toBeInTheDocument()
  })

  it('shows the normalized leader, arrow and key in the footer for a leader switch binding', async () => {
    renderPicker(createSessionServer({ repos }), {
      preferences: { keyboardShortcuts: { switchPickerTab: 'G' }, directShortcuts: [], leaderKey: 'Ctrl+X' },
    })

    expect(await screen.findByText(/Ctrl\+X → G projects/)).toBeInTheDocument()
  })

  it('no longer switches tabs on Ctrl+O', async () => {
    renderPicker(createSessionServer({ repos }))

    await screen.findByRole('option', { name: /alpha/ }).catch(() => undefined)
    fireEvent.keyDown(combobox(), { key: 'o', ctrlKey: true })

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
  })

  it('resets to the sessions tab when the dialog reopens', async () => {
    const server = createSessionServer({ repos })

    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>close-picker</button>
          <button type="button" onClick={() => setOpen(true)}>open-picker</button>
          <SessionPickerDialog
            open={open}
            onOpenChange={setOpen}
            currentRepo={repos[0]}
            onSelectSession={vi.fn()}
            onDeleteActiveSession={vi.fn()}
            onSelectRepo={vi.fn()}
            onNavigate={vi.fn()}
          />
        </>
      )
    }

    renderWithProviders(
      <KeyboardShortcutsProvider>
        <Host />
      </KeyboardShortcutsProvider>,
      { events: true, fetchRoutes: server.routes },
    )

    openProjectsTab()
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByText('close-picker'))
    fireEvent.click(screen.getByText('open-picker'))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'This project' })).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('groups active work into needs input, running and recent sections with repo labels', async () => {
    useSessionStatus.setState({ statuses: new Map([['ses_run', { type: 'busy' }]]) })
    const server = createSessionServer({
      repos,
      sessions: [
        session('ses_ni', 'Needs input task', '/w/a'),
        session('ses_run', 'Running task', '/w/b'),
        session('ses_recent', 'Recent task', '/w/a'),
      ],
      permissions: [
        { id: 'perm-1', sessionID: 'ses_ni', action: 'shell', resources: ['echo'], metadata: {} },
      ],
    })

    renderPicker(server)
    openActiveTab()

    expect(await screen.findByText('Needs input')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Needs input task/ }).textContent).toContain('alpha')
    expect(screen.getByRole('option', { name: /Running task/ }).textContent).toContain('beta')
    expect(screen.getByRole('option', { name: /Recent task/ }).textContent).toContain('alpha')
  })

  it('skips empty active work sections and shows the empty state for the configured window', async () => {
    renderPicker(createSessionServer({ repos }), { preferences: { activityWindowMinutes: 120 } })
    openActiveTab()

    expect(
      await screen.findByText('No active or recent sessions in the last 2 hours'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Needs input')).not.toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('formats a full-day active work window as hours in the empty state', async () => {
    renderPicker(createSessionServer({ repos }), { preferences: { activityWindowMinutes: 1440 } })
    openActiveTab()

    expect(
      await screen.findByText('No active or recent sessions in the last 24 hours'),
    ).toBeInTheDocument()
  })

  it('opens the cursor active row with Enter and selects its session and repo', async () => {
    useSessionStatus.setState({ statuses: new Map([['ses_run', { type: 'busy' }]]) })
    const server = createSessionServer({
      repos,
      sessions: [session('ses_run', 'Running task', '/w/b'), session('ses_recent', 'Recent task', '/w/a')],
    })
    const { onSelectSession } = renderPicker(server)
    openActiveTab()

    const running = await screen.findByRole('option', { name: /Running task/ })
    expect(running).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Recent task/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'Enter' })

    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'ses_recent' }), repos[0])
  })

  it('filters active work rows by title and drops sections left empty', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_ni', 'Needs input task', '/w/a'), session('ses_recent', 'Recent task', '/w/b')],
      permissions: [
        { id: 'perm-1', sessionID: 'ses_ni', action: 'shell', resources: ['echo'], metadata: {} },
      ],
    })
    renderPicker(server)
    openActiveTab()

    await screen.findByRole('option', { name: /Needs input task/ })

    fireEvent.change(combobox(), { target: { value: 'recent' } })

    expect(screen.queryByRole('option', { name: /Needs input task/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Recent task/ })).toBeInTheDocument()
    expect(screen.queryByText('Needs input')).not.toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
  })

  it('pins an active work row from the shared row menu', async () => {
    const user = userEvent.setup()
    useSessionStatus.setState({ statuses: new Map([['ses_run', { type: 'busy' }]]) })
    const server = createSessionServer({
      repos,
      sessions: [session('ses_run', 'Running task', '/w/b')],
    })
    const { fetchFake } = renderPicker(server)
    openActiveTab()

    await screen.findByRole('option', { name: /Running task/ })
    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    await user.click(await screen.findByText('Pin'))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PUT', '/api/session-pins')?.body).toEqual({
        sessionId: 'ses_run',
        directory: '/w/b',
        pinned: true,
      }),
    )
  })

  describe('linked-server mode', () => {
    const remote = { serverId: 'srv_kitchen', serverName: 'Kitchen', projectDirectory: '/home/me/app' }
    const remoteSession = makeSession({
      id: 'ses_remote',
      title: 'Remote session',
      location: { directory: '/home/me/app' },
      time: { created: Date.now(), updated: Date.now() },
    })

    it('lists the project sessions with the linked server projects tab and reports the chosen server session', async () => {
      const server = createSessionServer({
        repos,
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
      })
      const { onSelectRemoteSession } = renderPicker(server, { remote })

      expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()

      const row = await screen.findByRole('option', { name: /Remote session/ })
      expect(row).toHaveTextContent('Kitchen')

      fireEvent.click(row)

      expect(onSelectRemoteSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ses_remote' }),
        'srv_kitchen',
      )
    })

    it('renders the linked server projects tab through the shared activity-ordered project list', async () => {
      const project: OpenCodeProject = {
        id: 'p1',
        name: 'Alpha',
        canonical: '/projects/alpha',
        time: { created: 1, updated: 2 },
        sandboxes: [],
      }
      const server = createSessionServer({
        repos,
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
        projects: [project],
      })
      renderPicker(server, { remote: { serverId: 'srv_kitchen', serverName: 'Kitchen' } })

      openProjectsTab()

      expect(await screen.findByText('Alpha')).toBeInTheDocument()
    })

    it('queries the linked server sessions without a host-supplied server provider', async () => {
      const server = createSessionServer({
        repos,
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
      })
      renderPicker(server, { remote: { serverId: 'srv_kitchen', serverName: 'Kitchen' } })

      expect(await screen.findByRole('option', { name: /Remote session/ })).toBeInTheDocument()
      await waitFor(() =>
        expect(
          server
            .sessionRequests()
            .some((request) => request.path.startsWith('/api/opencode/servers/srv_kitchen/api/session')),
        ).toBe(true),
      )
    })

    it('navigates a remote active work row through the owning server', async () => {
      const server = createSessionServer({
        repos,
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
      })
      const { onSelectRemoteSession } = renderPicker(server, { remote })
      openActiveTab()

      const row = await screen.findByRole('option', { name: /Remote session/ })
      expect(row).toHaveTextContent('Kitchen')
      expect(screen.queryByRole('button', { name: 'Session actions' })).not.toBeInTheDocument()

      fireEvent.click(row)

      expect(onSelectRemoteSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ses_remote' }),
        'srv_kitchen',
      )
    })

    it('does not arm Ctrl+D for a linked server session in the sessions tab', async () => {
      const server = createSessionServer({
        repos,
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
      })
      renderPicker(server, { remote })

      await screen.findByRole('option', { name: /Remote session/ })
      fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })

      await waitFor(() => expect(screen.queryByText(/Press Ctrl\+D/)).not.toBeInTheDocument())
      expect(server.deletedSessionIDs()).toEqual([])
    })

    it('does not arm Ctrl+D for a remote active work row despite the delete hint', async () => {
      const server = createSessionServer({
        repos,
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
      })
      renderPicker(server, { remote })
      openActiveTab()

      const row = await screen.findByRole('option', { name: /Remote session/ })
      expect(row).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText(/Ctrl\+D delete/)).toBeInTheDocument()

      fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })

      await waitFor(() => expect(screen.queryByText(/Press Ctrl\+D/)).not.toBeInTheDocument())
      expect(server.deletedSessionIDs()).toEqual([])
    })

    it('deletes a local active work row through the local server', async () => {
      const user = userEvent.setup()
      const server = createSessionServer({
        repos,
        sessions: [session('ses_local', 'Local task', '/w/a')],
        remoteServers: [kitchen],
        remoteSessions: [remoteSession],
      })
      const { fetchFake } = renderPicker(server, { remote })
      openActiveTab()

      await screen.findByRole('option', { name: /Local task/ })

      await user.click(screen.getByRole('button', { name: 'Session actions' }))
      await user.click(await screen.findByText('Delete'))

      const dialog = await screen.findByRole('dialog', { name: 'Delete Session' })
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() =>
        expect(fetchFake.findRequests('DELETE', '/api/opencode/api/session/ses_local')).toHaveLength(1),
      )
      expect(server.deletedSessionIDs()).toContain('ses_local')
    })
  })
})
