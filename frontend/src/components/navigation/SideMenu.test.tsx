import { vi } from 'vitest'

vi.mock('@/hooks/useNotificationsAction', () => ({ useNotificationsAction: vi.fn() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/api/repos', () => ({ getRepo: vi.fn() }))

import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SideMenu } from './SideMenu'
import { useAuth } from '@/hooks/useAuth'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { getRepo } from '@/api/repos'

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
    const search = renderSideMenu('/?menu=home')

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))

    await waitFor(() => expect(search.current).toContain('dialog=files'))
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
})
