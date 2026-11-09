import { vi } from 'vitest'

vi.mock('@/hooks/useNotificationsAction', () => ({ useNotificationsAction: vi.fn() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/api/repos', () => ({ getRepo: vi.fn(), listRepos: vi.fn() }))
vi.mock('@/hooks/useSchedules', () => ({ useUnreadScheduleRuns: vi.fn(() => ({ data: undefined })) }))
vi.mock('@/components/session/SessionPickerPanel', () => ({
  SessionPickerPanel: ({
    projectName,
    onProjectLabelShownChange,
  }: {
    projectName?: string
    onProjectLabelShownChange?: (shown: boolean) => void
  }) => (
    <div data-testid="session-picker-panel" data-project-name={projectName ?? ''}>
      <button type="button" onClick={() => onProjectLabelShownChange?.(true)}>
        show-project-label
      </button>
      <button type="button" onClick={() => onProjectLabelShownChange?.(false)}>
        hide-project-label
      </button>
    </div>
  ),
}))
vi.mock('@/components/navigation/LinkedServersNav', () => ({
  LinkedServersNav: ({ variant }: { variant?: string }) => (
    <div data-testid="linked-servers-nav" data-variant={variant} />
  ),
}))

import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo } from '@/api/types'
import { stubMatchMedia } from '@/test/test-utils'
import { SideMenu } from './SideMenu'
import { useAuth } from '@/hooks/useAuth'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { getRepo, listRepos } from '@/api/repos'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

function LocationSpy({ search }: { search: { current: string } }) {
  const location = useLocation()

  useEffect(() => {
    search.current = location.search
  })

  return null
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

function notifications(count: number): ReturnType<typeof useNotificationsAction> {
  return {
    permissionCount: count,
    formCount: 0,
    reportCount: 0,
    count,
    destructive: false,
    label: count > 0 ? 'Notifications: permissions' : 'Notifications',
    press: vi.fn(),
  }
}

function readyRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'alpha',
    localPath: '/repos/alpha',
    fullPath: '/repos/alpha',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    ...overrides,
  }
}

function renderSideMenu(entry: string) {
  const search = { current: '' }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationSpy search={search} />
        <SideMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return search
}

describe('SideMenu', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setViewportWidth(390)
    vi.mocked(useNotificationsAction).mockReturnValue(notifications(0))
    vi.mocked(useAuth).mockReturnValue({
      logout: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>)
    vi.mocked(getRepo).mockReturnValue(new Promise(() => {}))
    vi.mocked(listRepos).mockResolvedValue([])
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  })

  it('opens the menu from the menu URL param', () => {
    renderSideMenu('/?menu=home')

    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument()
  })

  it('shows the close button only on a full-width menu', () => {
    setViewportWidth(390)
    renderSideMenu('/?menu=home')
    expect(screen.getByTestId('side-menu-close')).toBeInTheDocument()
  })

  it('hides the close button when the menu does not span the full width', () => {
    setViewportWidth(700)
    renderSideMenu('/?menu=home')
    expect(screen.queryByTestId('side-menu-close')).not.toBeInTheDocument()
  })

  it('closes the menu from the close button', async () => {
    setViewportWidth(390)
    const search = renderSideMenu('/?menu=home')

    fireEvent.click(screen.getByTestId('side-menu-close'))

    await waitFor(() => expect(search.current).not.toContain('menu=home'))
  })

  it('fills the viewport width below 600px', () => {
    setViewportWidth(390)
    renderSideMenu('/?menu=home')

    expect(screen.getByRole('dialog', { name: 'Menu' }).getAttribute('data-width')).toBe('100vw')
  })

  it('caps the width from 600px', () => {
    setViewportWidth(700)
    renderSideMenu('/?menu=home')

    const panel = screen.getByRole('dialog', { name: 'Menu' })
    expect(panel.getAttribute('data-width')).toBe('min(80vw, 520px)')
  })

  it('shows Logout on the home route', () => {
    renderSideMenu('/?menu=home')

    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
  })

  it('hides Logout on a repo route', () => {
    renderSideMenu('/repos/1?menu=home')

    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument()
  })

  it('opens a dialog row and closes the menu in one URL update', async () => {
    const search = renderSideMenu('/repos/1?menu=home')

    fireEvent.click(screen.getByRole('button', { name: 'MCP' }))

    await waitFor(() => expect(search.current).toContain('dialog=mcp'))
    expect(search.current).not.toContain('menu=')
  })

  it('pins the project tabs and drops their menu rows on a repo session route', () => {
    renderSideMenu('/repos/1/sessions/abc?menu=home')

    expect(screen.getAllByRole('button', { name: 'Files' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Git' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Source Control' })).not.toBeInTheDocument()
  })

  it('follows the menu project in the pinned tab strip', () => {
    renderSideMenu('/repos/1/sessions/abc?menu=home&menuProject=repo:0')

    expect(screen.getAllByRole('button', { name: 'Files' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Schedules' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Git' })).not.toBeInTheDocument()
  })

  it('opens the menu project Files dialog from the pinned tab and keeps the menu project', async () => {
    const search = renderSideMenu('/repos/1/sessions/abc?menu=home&menuProject=repo:2')

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))

    await waitFor(() => expect(search.current).toContain('dialog=files'))
    expect(search.current).toContain('menuProject=repo%3A2')
    expect(search.current).not.toContain('menu=')
  })

  it('hides the Notifications row while nothing is waiting', () => {
    renderSideMenu('/?menu=home')

    expect(screen.queryByRole('button', { name: /Notifications/ })).not.toBeInTheDocument()
  })

  it('shows the Notifications row when something is waiting', () => {
    vi.mocked(useNotificationsAction).mockReturnValue(notifications(2))
    renderSideMenu('/?menu=home')

    expect(screen.getByRole('button', { name: /Notifications/ })).toBeInTheDocument()
  })

  it('hosts the session picker on the sessions page and goes back to the home page', async () => {
    const search = renderSideMenu('/?menu=sessions')

    expect(screen.getByTestId('side-menu-sessions-page')).toBeInTheDocument()
    expect(screen.getByTestId('session-picker-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    await waitFor(() => expect(search.current).toContain('menu=home'))
  })

  it('scopes the session picker to the menu project', async () => {
    const repo = readyRepo()
    vi.mocked(getRepo).mockResolvedValue(repo)
    vi.mocked(listRepos).mockResolvedValue([repo])

    renderSideMenu('/repos/1?menu=sessions&menuProject=repo:1')

    await waitFor(() =>
      expect(screen.getByTestId('session-picker-panel')).toHaveAttribute('data-project-name', 'alpha'),
    )
  })

  it('labels a linked-server menu project with its directory name', async () => {
    renderSideMenu('/?menu=sessions&menuProject=server:srv_kitchen:%2Fhome%2Fme%2Fapp')

    await waitFor(() =>
      expect(screen.getByTestId('session-picker-panel')).toHaveAttribute('data-project-name', 'app'),
    )
  })

  it('hides the header project name only while the sessions tab labels the project', async () => {
    const repo = readyRepo()
    vi.mocked(getRepo).mockResolvedValue(repo)
    vi.mocked(listRepos).mockResolvedValue([repo])

    renderSideMenu('/repos/1?menu=sessions&menuProject=repo:1')

    await waitFor(() =>
      expect(screen.getByTestId('session-picker-panel')).toHaveAttribute('data-project-name', 'alpha'),
    )
    expect(screen.getByTestId('side-menu-project-name')).toHaveTextContent('alpha')

    fireEvent.click(screen.getByRole('button', { name: 'show-project-label' }))

    expect(screen.queryByTestId('side-menu-project-name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'hide-project-label' }))

    expect(screen.getByTestId('side-menu-project-name')).toHaveTextContent('alpha')
  })

  it('shows the server switcher as a rail on a narrow menu', () => {
    renderSideMenu('/?menu=home')

    expect(screen.getByTestId('linked-servers-nav')).toHaveAttribute('data-variant', 'rail')
  })

  it('shows the server switcher in the header on a wide menu', () => {
    stubMatchMedia(true)
    try {
      renderSideMenu('/?menu=home')

      expect(screen.getByTestId('linked-servers-nav')).toHaveAttribute('data-variant', 'header')
    } finally {
      Reflect.deleteProperty(window, 'matchMedia')
    }
  })
})
