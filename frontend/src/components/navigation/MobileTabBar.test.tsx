import { vi } from 'vitest'

vi.mock('@/hooks/useMobile', () => ({
  useMobile: vi.fn(),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useUnreadScheduleRuns: vi.fn(() => ({ data: undefined })),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { MobileTabBar } from './MobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { useUnreadScheduleRuns } from '@/hooks/useSchedules'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

function LocationSpy() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

describe('MobileTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(useUnreadScheduleRuns).mockReturnValue(
      { data: undefined } as unknown as ReturnType<typeof useUnreadScheduleRuns>,
    )
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
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

  it('renders nothing on unsupported paths', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders global tabs on repo detail (session list) path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Git')).toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels).toEqual(['Sessions', 'Files', 'Git', 'Assistant', 'More'])
  })

  it('opens the source control dialog when Git is clicked on repo detail path', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Git' }))
    expect(screen.getByTestId('location')).toHaveTextContent('dialog=sourceControl')
  })

  it('renders global tabs on assistant session list path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/assistant?view=sessions']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
  })

  it('opens the assistant-scoped file browser from the assistant route', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/assistant']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByTestId('location')).toHaveTextContent('dialog=files')
  })

  it('opens the global file browser from the repos route', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByTestId('location')).toHaveTextContent('mobileTab=files')
  })

  it('navigates to /assistant when assistant is clicked from repo context', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/assistant')
  })

  it('navigates to assistant route when assistant is clicked without repo id', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/schedules']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/assistant')
  })

  it('hides the tab bar on a linked server page path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/servers/srv_kitchen']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders global tabs with Git on a linked server project page', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels).toEqual(['Sessions', 'Git', 'Assistant', 'More'])
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
  })

  it('opens the remote source control dialog from the Git tab on a linked server project page', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Git' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/servers/srv_kitchen/projects')
    expect(screen.getByTestId('location')).toHaveTextContent('directory=%2Fhome%2Fme%2Fapp')
    expect(screen.getByTestId('location')).toHaveTextContent('dialog=sourceControl')
  })

  it('opens the sessions sheet from the Sessions tab on a linked server project page', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    expect(screen.getByTestId('location')).toHaveTextContent('mobileTab=sessions')
  })

  it('does not render tab bar on a linked server session path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/servers/srv_kitchen/sessions/ses_remote']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders schedule tabs on /repos/:id/schedules path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123/schedules']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
    expect(screen.getByText('Runs')).toBeInTheDocument()
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
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
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
    expect(screen.queryByText('Git')).not.toBeInTheDocument()
  })

  it('hides the Files tab on the home page when a linked server is selected', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels).toEqual(['Sessions', 'Assistant', 'Schedules', 'More'])
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
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
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
  })

  it('Sessions tab is active when pathname is / and no sheet is open', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const sessionsButton = screen.getByText('Sessions').closest('button')
    expect(sessionsButton).toHaveClass('text-primary')
    expect(sessionsButton).toHaveClass('border-primary')
  })

  it('Sessions tab is active when openSheet is sessions regardless of pathname', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123?mobileTab=sessions']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const sessionsButton = screen.getByText('Sessions').closest('button')
    expect(sessionsButton).toHaveClass('text-primary')
    expect(sessionsButton).toHaveClass('border-primary')
  })

  it('maintains stable callbacks when search changes but mobileTab does not', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?foo=1']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const firstSessionsButton = screen.getByText('Sessions').closest('button')
    expect(firstSessionsButton).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?foo=2']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const secondSessionsButton = screen.getByText('Sessions').closest('button')
    expect(secondSessionsButton).toBeInTheDocument()
  })

  it('does not render tab bar on SessionDetail path /repos/:id/sessions/:sid', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/1/sessions/abc']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the unread schedule indicator on More when the Schedules tab is replaced by Git', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    vi.mocked(useUnreadScheduleRuns).mockReturnValue({
      data: { total: 2, runs: [] },
    } as unknown as ReturnType<typeof useUnreadScheduleRuns>)
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' }).querySelector('[data-unread-badge]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Git' }).querySelector('[data-unread-badge]')).toBeNull()
  })

  it('keeps the unread schedule indicator on Schedules and off More when that tab is shown', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    vi.mocked(useUnreadScheduleRuns).mockReturnValue({
      data: { total: 1, runs: [] },
    } as unknown as ReturnType<typeof useUnreadScheduleRuns>)
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'Schedules' }).querySelector('[data-unread-badge]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'More' }).querySelector('[data-unread-badge]')).toBeNull()
  })

})
