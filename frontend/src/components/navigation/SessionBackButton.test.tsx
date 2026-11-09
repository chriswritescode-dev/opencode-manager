import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseNotificationsActionReturn } from '@/hooks/useNotificationsAction'
import { LocationCatcher } from '@/test/test-utils'
import { SessionBackButton } from './SessionBackButton'

const mocks = vi.hoisted(() => ({
  useNotificationsAction: vi.fn(),
}))

vi.mock('@/hooks/useNotificationsAction', () => ({
  useNotificationsAction: mocks.useNotificationsAction,
}))

function mockNotifications(overrides: Partial<UseNotificationsActionReturn> = {}) {
  mocks.useNotificationsAction.mockReturnValue({
    count: 0,
    destructive: false,
    label: 'Notifications',
    press: vi.fn(),
    permissionCount: 0,
    formCount: 0,
    reportCount: 0,
    ...overrides,
  })
}

function renderBackButton(to = '/?menu=sessions&menuProject=repo:1') {
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  render(
    <MemoryRouter initialEntries={['/repos/1/sessions/abc']}>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/repos/:id/sessions/:sessionId" element={<SessionBackButton to={to} />} />
        <Route path="/" element={null} />
      </Routes>
    </MemoryRouter>,
  )
  return { capturedPathname, capturedSearch }
}

describe('SessionBackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an icon-only back button with no badge when there are no notifications', () => {
    mockNotifications()

    renderBackButton()

    const button = screen.getByRole('button', { name: 'Back' })
    expect(button).toBeInTheDocument()
    expect(button).not.toHaveTextContent('Back')
    expect(screen.queryByText('Back')).not.toBeInTheDocument()
  })

  it('shows the notification count in the accessible name and badge', () => {
    mockNotifications({ count: 2, label: 'Notifications: 2 permissions' })

    renderBackButton()

    expect(
      screen.getByRole('button', { name: 'Back, Notifications: 2 permissions' }),
    ).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('navigates to the hub path when pressed', () => {
    mockNotifications()

    const { capturedPathname, capturedSearch } = renderBackButton()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(capturedPathname.current).toBe('/')
    expect(capturedSearch.current).toBe('?menu=sessions&menuProject=repo:1')
  })

  it('uses destructive badge styling when a notification failed', () => {
    mockNotifications({ count: 2, destructive: true, label: 'Notifications: 2 unread reports' })

    renderBackButton()

    expect(screen.getByText('2')).toHaveClass('bg-destructive')
  })
})
