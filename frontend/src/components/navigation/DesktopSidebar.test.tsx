import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DesktopSidebar } from './DesktopSidebar'
import * as useDesktopModule from '@/hooks/useDesktop'
import * as useSidebarCollapsedModule from '@/hooks/useSidebarCollapsed'
import * as useAuthModule from '@/hooks/useAuth'

vi.mock('@/hooks/useDesktop')
vi.mock('@/hooks/useSidebarCollapsed')
vi.mock('@/hooks/useAuth')
vi.mock('@/components/navigation/DesktopSessionTree', () => ({
  DesktopSessionTree: () => <div data-testid="session-tree" />,
}))

function LocationDisplay() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div>
      <div data-testid="location">{location.pathname}{location.search}</div>
      <button onClick={() => navigate(-1)} data-testid="back-button">Back</button>
    </div>
  )
}

function createWrapper(initialEntries?: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('DesktopSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when user is not authenticated', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(false)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    const { container } = render(
      <MemoryRouter>
        <DesktopSidebar />
      </MemoryRouter>,
    )

    expect(container.firstChild).toBeNull()
  })

  it('returns null when auth state is loading', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(false)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: true,
      logout: vi.fn(),
    } as any)

    const { container } = render(
      <MemoryRouter>
        <DesktopSidebar />
      </MemoryRouter>,
    )

    expect(container.firstChild).toBeNull()
  })

  it('returns null when not desktop', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(false)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    const { container } = render(
      <MemoryRouter>
        <DesktopSidebar />
      </MemoryRouter>
    )

    expect(container.firstChild).toBeNull()
  })

  it('hides the New Repo CTA for root path and renders Assistant', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(screen.queryByText('New Repo')).toBeNull()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('renders primary CTAs for repo detail', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.queryByText('New Session')).toBeNull()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('renders primary CTAs for session detail', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5/sessions/abc']) })

    expect(screen.queryByText('New Session')).toBeNull()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it.each(['/', '/repos/5', '/repos/5/sessions/abc', '/assistant'])('leaves route tools to the tool rail on %s', (path) => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper([path]) })

    for (const label of ['Home', 'Settings', 'Logout']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const label of ['Menu', 'Repos', 'Files', 'MCP', 'Skills', 'Schedules', 'All Schedules', 'Source Control', 'Terminal', 'Walkthrough', 'Preview']) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })
  it.each([
    ['/schedules', 'New Schedule'],
    ['/repos/5/schedules', 'New Schedule'],
    ['/assistant', 'New Session'],
  ])('does not duplicate the page header create action on %s', (path, headerAction) => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper([path]) })

    expect(screen.queryByText(headerAction)).toBeNull()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('navigates home from the footer', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(
      <>
        <DesktopSidebar />
        <LocationDisplay />
      </>,
      { wrapper: createWrapper(['/repos/5?repoTab=workspaces']) }
    )

    fireEvent.click(screen.getByText('Home'))

    expect(screen.getByTestId('location').textContent).toBe('/')
  })
  it('opens settings by updating settings query params', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(
      <>
        <DesktopSidebar />
        <LocationDisplay />
      </>,
      { wrapper: createWrapper(['/?dialog=files']) }
    )

    fireEvent.click(screen.getByText('Settings'))

    expect(screen.getByTestId('location').textContent).toBe('/?dialog=files&settings=open&settingsTab=account')
  })

  it('renders the session tree with home and account items in the footer', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.getByRole('region', { name: 'Sessions' })).toContainElement(screen.getByTestId('session-tree'))
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })
  it('renders home, repos and account items and no session tree when collapsed', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([true, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.queryByTestId('session-tree')).toBeNull()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.queryByText('Files')).toBeNull()
  })
})
