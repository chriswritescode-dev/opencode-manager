import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionMoreButton } from './SessionMoreButton'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  useUnreadScheduleRuns: vi.fn(),
}))

vi.mock('@/hooks/useMobileTabBar', () => ({
  useMobileTabBar: () => ({ open: mocks.open, openSheet: null, close: vi.fn() }),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useUnreadScheduleRuns: mocks.useUnreadScheduleRuns,
}))

describe('SessionMoreButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the unread report count and opens the drawer', () => {
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 4, failed: 0 } })
    render(<SessionMoreButton />)

    const button = screen.getByRole('button', { name: 'More, 4 unread reports' })
    expect(screen.getByText('4')).toBeInTheDocument()

    fireEvent.click(button)

    expect(mocks.open).toHaveBeenCalledWith('more')
  })

  it('shows no count when there are no unread reports', () => {
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 0, failed: 0 } })
    render(<SessionMoreButton />)

    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
