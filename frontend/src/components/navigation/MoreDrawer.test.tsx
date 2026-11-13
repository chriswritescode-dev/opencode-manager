import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { MoreDrawer } from './MoreDrawer'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { makeHealthResponse, makeRepo } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { UnreadScheduleRun } from '@/api/schedules'

function createUnreadScheduleRun(): UnreadScheduleRun {
  const now = Date.now()
  return {
    id: 1,
    jobId: 1,
    repoId: 1,
    triggerSource: 'schedule',
    status: 'completed',
    startedAt: now - 60000,
    finishedAt: now - 30000,
    viewedAt: null,
    createdAt: now - 60000,
    sessionId: null,
    sessionTitle: null,
    logText: null,
    responseText: null,
    errorText: null,
    runBranch: null,
    commitHash: null,
    worktreePath: null,
    jobName: 'Nightly report',
    repoName: 'repo1',
    repoPath: '/workspace/repos/repo1',
    serverName: null,
    preview: 'Report ready',
  }
}

interface RenderOptions {
  unread?: UnreadScheduleRun[]
  health?: FetchRoute
}

function renderMoreDrawer(initialEntry = '/', routePath = '*', options: RenderOptions = {}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const onClose = vi.fn()
  const result = renderWithProviders(
    <>
      <Routes>
        <Route path={routePath} element={<MoreDrawer isOpen onClose={onClose} />} />
      </Routes>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: initialEntry,
      theme: false,
      fetchRoutes: [
        ...(options.health ? [options.health] : []),
        ...appRoutes({
          repos: [makeRepo({ id: 1, name: 'repo1', fullPath: '/workspace/repos/repo1' })],
          unreadSchedules: { runs: options.unread ?? [], total: options.unread?.length ?? 0, failed: 0 },
        }),
        { method: 'POST', path: '/api/auth/sign-out', respond: () => ({ json: { success: true } }) },
      ],
    },
  )
  return { ...result, capturedPathname, capturedSearch, onClose }
}

describe('MoreDrawer', () => {
  it('renders Settings and Logout menu items', () => {
    renderMoreDrawer()

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('does not render theme controls', () => {
    renderMoreDrawer()

    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
    expect(screen.queryByText('Light')).not.toBeInTheDocument()
    expect(screen.queryByText('Dark')).not.toBeInTheDocument()
    expect(screen.queryByText('System')).not.toBeInTheDocument()
  })

  it('navigates to settings URL when Settings is clicked', async () => {
    const { capturedSearch } = renderMoreDrawer()

    fireEvent.click(screen.getByText('Settings'))

    await waitFor(() => expect(capturedSearch.current).toContain('settings=open'))
  })

  it('logs out when Logout is clicked', async () => {
    const { fetchFake, onClose } = renderMoreDrawer()

    fireEvent.click(screen.getByText('Logout'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/auth/sign-out')).toBeDefined())
    expect(onClose).toHaveBeenCalled()
  })

  it('displays OpenCode and Manager versions when available', async () => {
    renderMoreDrawer('/', '*', {
      health: {
        method: 'GET',
        path: '/api/health',
        respond: () => ({ json: makeHealthResponse({ opencodeVersion: '1.4.11', opencodeManagerVersion: '0.9.16' }) }),
      },
    })

    expect(await screen.findByText('v1.4.11 · Manager v0.9.16')).toBeInTheDocument()
  })

  it('shows unhealthy server status when server is unhealthy', async () => {
    renderMoreDrawer('/', '*', {
      health: {
        method: 'GET',
        path: '/api/health',
        respond: () => ({ json: makeHealthResponse({ opencode: 'unhealthy', opencodeVersion: '1.4.11', opencodeManagerVersion: null }) }),
      },
    })

    expect(await screen.findByText('v1.4.11')).toBeInTheDocument()
  })

  it('shows fallback text when version is not available', async () => {
    renderMoreDrawer('/', '*', {
      health: {
        method: 'GET',
        path: '/api/health',
        respond: () => ({ json: makeHealthResponse({ opencodeVersion: null, opencodeManagerVersion: null }) }),
      },
    })

    expect(await screen.findByText('Settings')).toBeInTheDocument()
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument()
  })

  it('leaves commands and file mentions to the prompt input', () => {
    renderMoreDrawer('/repos/1/sessions/session-1', '/repos/:id/sessions/:sessionId')

    expect(screen.queryByText('Commands')).not.toBeInTheDocument()
    expect(screen.queryByText('Mention File')).not.toBeInTheDocument()
  })

  it('groups session items into workspace and project sections', async () => {
    renderMoreDrawer('/repos/1/sessions/session-1', '/repos/:id/sessions/:sessionId')

    await screen.findByText('repo1')
    const sectionLabels = (name: string) =>
      within(screen.getByRole('region', { name })).getAllByRole('button').map((button) => button.textContent)

    expect(sectionLabels('Workspace')).toEqual(['Files', 'Source Control', 'Terminal', 'Walkthrough', 'Preview'])
    expect(sectionLabels('Project')).toEqual(['MCP', 'Skills', 'Reset Permissions', 'Schedules', 'Actions'])
    expect(screen.getAllByText('Settings')).toHaveLength(1)
    expect(screen.getAllByText('Logout')).toHaveLength(1)
  })

  it('shows Assistant instead of the source repo on assistant routes', async () => {
    renderMoreDrawer('/repos/1/assistant', '/repos/:id/assistant')

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('repo1')).not.toBeInTheDocument()
  })

  it('shows Assistant instead of the source repo on canonical /assistant route', async () => {
    renderMoreDrawer('/assistant', '/assistant')

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('repo1')).not.toBeInTheDocument()
  })

  it('preserves session route as return target when opening schedules', async () => {
    const { capturedPathname, capturedSearch } = renderMoreDrawer(
      '/repos/1/sessions/session-1?assistant=1',
      '/repos/:id/sessions/:sessionId',
    )

    fireEvent.click(screen.getByText('Schedules'))

    await waitFor(() =>
      expect(capturedSearch.current).toBe(
        '?returnTo=%2Frepos%2F1%2Fsessions%2Fsession-1%3Fassistant%3D1',
      ),
    )
    expect(capturedPathname.current).toBe('/repos/1/schedules')
  })

  it('swaps the menu for the Sessions sheet from a session', async () => {
    const { capturedSearch } = renderMoreDrawer(
      '/repos/1/sessions/session-1?mobileTab=more',
      '/repos/:id/sessions/:sessionId',
    )

    fireEvent.click(screen.getByText('Sessions'))

    await waitFor(() => expect(capturedSearch.current).toContain('mobileTab=sessions'))
  })

  it('keeps Home and hides the Sessions row outside a session', async () => {
    renderMoreDrawer('/repos/1', '/repos/:id')

    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument()
  })

  it('offers the Assistant from a repo session', async () => {
    const { capturedPathname } = renderMoreDrawer(
      '/repos/1/sessions/session-1',
      '/repos/:id/sessions/:sessionId',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/assistant'))
  })

  it('does not offer the Assistant from an assistant session', () => {
    renderMoreDrawer('/repos/1/sessions/session-1?assistant=1', '/repos/:id/sessions/:sessionId')

    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument()
  })

  it('shows no Activity section even when there are recent sessions', async () => {
    renderMoreDrawer('/repos/1/sessions/session-1', '/repos/:id/sessions/:sessionId')

    await screen.findByText('repo1')
    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument()
  })

  it('offers only the remote-capable project items on a linked-server route', async () => {
    renderMoreDrawer('/servers/srv_kitchen/sessions/ses_remote', '/servers/:serverId/sessions/:sessionId')

    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.getByText('Source Control')).toBeInTheDocument()
    expect(screen.queryByText('Preview')).not.toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
    expect(screen.queryByText('Reset Permissions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument()
  })

  it('shows unread reports and marks them all read', async () => {
    const { fetchFake } = renderMoreDrawer('/repos/1/sessions/session-1', '/repos/:id/sessions/:sessionId', {
      unread: [createUnreadScheduleRun()],
    })

    expect(await screen.findByText('Nightly report')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/schedules/all/runs/viewed')).toBeDefined())
  })
})
