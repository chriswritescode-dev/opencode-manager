import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MobileTabBar } from './MobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { usePermissions, useQuestions } from '@/contexts/EventContext'

vi.mock('@/hooks/useMobile')
vi.mock('@/contexts/EventContext', () => ({
  usePermissions: vi.fn(),
  useQuestions: vi.fn(),
}))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="file-browser-sheet">FileBrowserSheet</div> : null,
}))
vi.mock('@/components/navigation/RepoQuickSwitchSheet', () => ({
  RepoQuickSwitchSheet: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="repo-quick-switch-sheet">RepoQuickSwitchSheet</div> : null,
}))
vi.mock('@/components/navigation/NotificationsSheet', () => ({
  NotificationsSheet: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="notifications-sheet">NotificationsSheet</div> : null,
}))
vi.mock('@/components/navigation/MoreDrawer', () => ({
  MoreDrawer: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="more-drawer">MoreDrawer</div> : null,
}))

describe('MobileTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 0,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: null,
      respond: vi.fn(),
      dismiss: vi.fn(),
      getForCallID: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useQuestions).mockReturnValue({
      pendingCount: 0,
      navigateToCurrent: vi.fn(),
      current: null,
      reply: vi.fn(),
      reject: vi.fn(),
      dismiss: vi.fn(),
      getForCallID: vi.fn(),
      hasForSession: vi.fn(),
    })
  })

  it('renders nothing when useMobile returns false', () => {
    vi.mocked(useMobile).mockReturnValue(false)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when pathname is not / or /schedules', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders tab bar on root path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })

  it('renders tab bar on /schedules path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/schedules']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
  })

  it('shows badge when permissionCount + questionCount > 0', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 2,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: null,
      respond: vi.fn(),
      dismiss: vi.fn(),
      getForCallID: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useQuestions).mockReturnValue({
      pendingCount: 1,
      navigateToCurrent: vi.fn(),
      current: null,
      reply: vi.fn(),
      reject: vi.fn(),
      dismiss: vi.fn(),
      getForCallID: vi.fn(),
      hasForSession: vi.fn(),
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const badge = document.querySelector('.bg-orange-500')
    expect(badge).toBeInTheDocument()
  })

  it('does not show badge when both counts are 0', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 0,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: null,
      respond: vi.fn(),
      dismiss: vi.fn(),
      getForCallID: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useQuestions).mockReturnValue({
      pendingCount: 0,
      navigateToCurrent: vi.fn(),
      current: null,
      reply: vi.fn(),
      reject: vi.fn(),
      dismiss: vi.fn(),
      getForCallID: vi.fn(),
      hasForSession: vi.fn(),
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const badge = document.querySelector('.bg-orange-500')
    expect(badge).not.toBeInTheDocument()
  })

  it('opens repos sheet when Repos tab is clicked', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('Repos'))
    expect(screen.getByTestId('repo-quick-switch-sheet')).toBeInTheDocument()
  })

  it('opens files sheet when Files tab is clicked', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('Files'))
    expect(screen.getByTestId('file-browser-sheet')).toBeInTheDocument()
  })

  it('opens notifications sheet when Alerts tab is clicked', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('Alerts'))
    expect(screen.getByTestId('notifications-sheet')).toBeInTheDocument()
  })

  it('opens more drawer when More tab is clicked', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('More'))
    expect(screen.getByTestId('more-drawer')).toBeInTheDocument()
  })
})
