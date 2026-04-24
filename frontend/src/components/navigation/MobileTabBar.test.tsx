import { vi } from 'vitest'

vi.mock('@/hooks/useMobile', () => ({
  useMobile: vi.fn(),
}))

import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MobileTabBar } from './MobileTabBar'
import { useMobile } from '@/hooks/useMobile'

describe('MobileTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
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
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
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

  it('Repos tab is active when pathname is / and no sheet is open', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const reposButton = screen.getByText('Repos').closest('button')
    expect(reposButton).toHaveClass('text-primary')
    expect(reposButton).toHaveClass('border-primary')
  })

  it('Repos tab is active when openSheet is repos regardless of pathname', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123?mobileTab=repos']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const reposButton = screen.getByText('Repos').closest('button')
    expect(reposButton).toHaveClass('text-primary')
    expect(reposButton).toHaveClass('border-primary')
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

    const firstReposButton = screen.getByText('Repos').closest('button')
    expect(firstReposButton).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?foo=2']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const secondReposButton = screen.getByText('Repos').closest('button')
    expect(secondReposButton).toBeInTheDocument()
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

  it('renders tab bar on Memories path /repos/:id/memories', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/1/memories']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })
})
