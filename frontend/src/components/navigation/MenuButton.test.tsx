import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseNotificationsActionReturn } from '@/hooks/useNotificationsAction'
import { MenuButton } from './MenuButton'

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

describe('MenuButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a menu button with no badge when there are no notifications', () => {
    mockNotifications()

    render(<MenuButton onPress={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows the notification count in the accessible name and badge', () => {
    mockNotifications({ count: 2, label: 'Notifications: 2 permissions' })

    render(<MenuButton onPress={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'Menu, Notifications: 2 permissions' }),
    ).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calls onPress when clicked', () => {
    const onPress = vi.fn()
    mockNotifications()

    render(<MenuButton onPress={onPress} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('uses destructive badge styling when a notification failed', () => {
    mockNotifications({ count: 2, destructive: true, label: 'Notifications: 2 unread reports' })

    render(<MenuButton onPress={vi.fn()} />)

    expect(screen.getByText('2')).toHaveClass('bg-destructive')
  })

  it('uses highlight badge styling when nothing failed', () => {
    mockNotifications({ count: 2, destructive: false, label: 'Notifications: 2 permissions' })

    render(<MenuButton onPress={vi.fn()} />)

    expect(screen.getByText('2')).toHaveClass('bg-highlight')
  })
})
