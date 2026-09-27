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
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'sessions', toggleSection: vi.fn() })
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

  it('renders primary CTA for schedules routes', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/schedules']) })

    expect(screen.getByText('New Schedule')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('dispatches oc:sidebar:action event when primary CTA is clicked', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/schedules']) })

    fireEvent.click(screen.getByText('New Schedule'))

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oc:sidebar:action',
        detail: { action: 'new-schedule' },
      })
    )
  })

  it('opens dialog items by updating the dialog query param (push) and closes on back', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'menu', toggleSection: vi.fn() })
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
      { wrapper: createWrapper(['/repos/5/sessions/abc?assistant=1']) }
    )

    fireEvent.click(screen.getByText('Files'))

    expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/abc?assistant=1&dialog=files')

    fireEvent.click(screen.getByTestId('back-button'))

    expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/abc?assistant=1')
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

  it('preserves session route as return target when opening schedules', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'menu', toggleSection: vi.fn() })
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
      { wrapper: createWrapper(['/repos/5/sessions/abc?assistant=1']) }
    )

    fireEvent.click(screen.getByText('Schedules'))

    expect(screen.getByTestId('location').textContent).toBe('/repos/5/schedules?returnTo=%2Frepos%2F5%2Fsessions%2Fabc%3Fassistant%3D1')
  })

  it('renders the session tree and account footer when the sessions section is open', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.getByTestId('session-tree')).toBeInTheDocument()
    expect(screen.queryByText('Files')).toBeNull()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('renders the menu items and account footer when the menu section is open', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'menu', toggleSection: vi.fn() })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.queryByTestId('session-tree')).toBeNull()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('renders the vertical nav list and no session tree when collapsed', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([true, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.queryByTestId('session-tree')).toBeNull()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('hides the session tree when the menu section is open', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'menu', toggleSection: vi.fn() })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.queryByTestId('session-tree')).toBeNull()
    expect(screen.getByText('Files')).toBeInTheDocument()
  })

  it('hides the menu items when the sessions section is open', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'sessions', toggleSection: vi.fn() })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    expect(screen.getByTestId('session-tree')).toBeInTheDocument()
    expect(screen.queryByText('Files')).toBeNull()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('toggles the sessions section from its header', () => {
    const toggle = vi.fn()
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'sessions', toggleSection: toggle })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))
    expect(toggle).toHaveBeenCalledWith('sessions')
  })

  it('toggles the menu section from its header', () => {
    const toggle = vi.fn()
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.mocked(useSidebarCollapsedModule.useSidebarSections).mockReturnValue({ openSection: 'sessions', toggleSection: toggle })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/repos/5']) })

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(toggle).toHaveBeenCalledWith('menu')
  })
})
