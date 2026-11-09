import { vi } from 'vitest'

vi.mock('@/hooks/useDesktop', () => ({ useDesktop: vi.fn() }))
vi.mock('@/hooks/useSidebarCollapsed', () => ({ useSidebarCollapsed: vi.fn() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/hooks/useNotificationsAction', () => ({ useNotificationsAction: vi.fn() }))
vi.mock('@/api/repos', () => ({ getRepo: vi.fn(), listRepos: vi.fn() }))
vi.mock('@/hooks/useSchedules', () => ({ useUnreadScheduleRuns: vi.fn(() => ({ data: undefined })) }))
vi.mock('@/components/session/SessionPickerPanel', () => ({
  SessionPickerPanel: ({ renderProjectSessions }: { renderProjectSessions?: () => ReactNode }) => (
    <div data-testid="session-picker-panel">{renderProjectSessions?.()}</div>
  ),
}))
vi.mock('./ProjectHub', () => ({
  ProjectHub: ({ target }: { target: ProjectTarget }) => (
    <div data-testid="project-hub" data-repo-id={target.kind === 'repo' ? target.repoId : ''} />
  ),
}))
vi.mock('@/components/navigation/LinkedServersNav', () => ({
  LinkedServersNav: ({ variant }: { variant?: string }) => (
    <div data-testid="linked-servers-nav" data-variant={variant} />
  ),
}))

import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { ProjectTarget } from '@/lib/projectTarget'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getRepo, listRepos } from '@/api/repos'
import { useAuth } from '@/hooks/useAuth'
import { useDesktop } from '@/hooks/useDesktop'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { DesktopSidebar } from './DesktopSidebar'

function LocationDisplay() {
  const location = useLocation()

  return <div data-testid="location">{location.pathname}{location.search}</div>
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

function renderSidebar(
  entry: string,
  options: { collapsed?: boolean; toggle?: () => void } = {},
) {
  const toggle = options.toggle ?? vi.fn()
  vi.mocked(useSidebarCollapsed).mockReturnValue([options.collapsed ?? false, toggle])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <TooltipProvider>
          <DesktopSidebar />
          <LocationDisplay />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...result, toggle }
}

describe('DesktopSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDesktop).mockReturnValue(true)
    vi.mocked(useSidebarCollapsed).mockReturnValue([false, vi.fn()])
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>)
    vi.mocked(useNotificationsAction).mockReturnValue(notifications(0))
    vi.mocked(getRepo).mockReturnValue(new Promise(() => {}))
    vi.mocked(listRepos).mockResolvedValue([])
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  })

  it('returns null when user is not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      logout: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>)

    const { container } = renderSidebar('/')

    expect(container.querySelector('aside')).toBeNull()
  })

  it('returns null when auth state is loading', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: true,
      logout: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>)

    const { container } = renderSidebar('/')

    expect(container.querySelector('aside')).toBeNull()
  })

  it('returns null when not desktop', () => {
    vi.mocked(useDesktop).mockReturnValue(false)

    const { container } = renderSidebar('/')

    expect(container.querySelector('aside')).toBeNull()
  })

  it('shows the sessions page by default when no menu param is present', () => {
    renderSidebar('/')

    expect(screen.getByTestId('side-menu-sessions-page')).toBeInTheDocument()
    expect(screen.getByTestId('session-picker-panel')).toBeInTheDocument()
  })

  it('renders the project hub for the menu project', async () => {
    renderSidebar('/?menu=sessions&menuProject=repo:1')

    await waitFor(() => expect(screen.getByTestId('project-hub')).toHaveAttribute('data-repo-id', '1'))
  })

  it('renders the menu rows on the home page', () => {
    renderSidebar('/?menu=home')

    for (const label of ['Home', 'All Schedules', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('shows the Notifications row while something is waiting', () => {
    vi.mocked(useNotificationsAction).mockReturnValue(notifications(1))
    renderSidebar('/?menu=home')

    expect(screen.getByRole('button', { name: /Notifications/ })).toBeInTheDocument()
  })

  it('hides the Notifications row while nothing is waiting', () => {
    renderSidebar('/?menu=home')

    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull()
  })

  it('renders the tab destinations strip in the docked panel', () => {
    renderSidebar('/?menu=sessions&menuProject=repo:1')

    for (const label of ['Sessions', 'Files', 'Git', 'Assistant']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('renders the icon rail with the destinations and the linked servers rail', () => {
    renderSidebar('/?dialog=files', { collapsed: true })

    for (const label of ['Sessions', 'Assistant', 'Home', 'Settings', 'Logout']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByTestId('linked-servers-nav')).toHaveAttribute('data-variant', 'rail')
  })

  it('shows Logout in the rail only on the root route', () => {
    renderSidebar('/repos/5', { collapsed: true })

    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
  })

  it('hides the Notifications item in the rail while nothing is waiting', () => {
    renderSidebar('/', { collapsed: true })

    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull()
  })

  it('shows the Notifications item in the rail and presses it', () => {
    const action = notifications(1)
    vi.mocked(useNotificationsAction).mockReturnValue(action)
    renderSidebar('/', { collapsed: true })

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))

    expect(action.press).toHaveBeenCalledTimes(1)
  })

  it('opens the sessions menu from the collapsed Sessions item and expands the sidebar', async () => {
    const { toggle } = renderSidebar('/', { collapsed: true })

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))

    expect(toggle).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/?menu=sessions'))
  })

  it('expands the sidebar from Sessions when the menu param is already set', () => {
    const { toggle } = renderSidebar('/?menu=sessions', { collapsed: true })

    expect(toggle).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))

    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('navigates home from the collapsed Home item', () => {
    renderSidebar('/repos/5?repoTab=workspaces', { collapsed: true })

    fireEvent.click(screen.getByRole('button', { name: 'Home' }))

    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('opens settings from the collapsed Settings item', () => {
    renderSidebar('/?dialog=files', { collapsed: true })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByTestId('location').textContent).toBe('/?dialog=files&settings=open&settingsTab=account')
  })

  it('expands a collapsed sidebar once per open request', () => {
    const toggle = vi.fn()
    renderSidebar('/?menu=sessions&menuProject=repo:1', { collapsed: true, toggle })

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('keeps the sidebar collapsed when no menu is open', () => {
    const toggle = vi.fn()
    renderSidebar('/', { collapsed: true, toggle })

    expect(toggle).not.toHaveBeenCalled()
  })

  it('does not render the side menu sessions page while collapsed', () => {
    renderSidebar('/?menu=sessions&menuProject=repo:1', { collapsed: true })

    expect(screen.queryByTestId('side-menu-sessions-page')).toBeNull()
  })
})
