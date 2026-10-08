import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ScheduleReportsBell } from './ScheduleReportsBell'

const mocks = vi.hoisted(() => ({
  useUnreadScheduleRuns: vi.fn(),
  useMarkAllScheduleRunsViewed: vi.fn(),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useUnreadScheduleRuns: mocks.useUnreadScheduleRuns,
  useMarkAllScheduleRunsViewed: mocks.useMarkAllScheduleRunsViewed,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: vi.fn(() => false),
}))

function renderBell() {
  return render(
    <MemoryRouter>
      <ScheduleReportsBell />
    </MemoryRouter>,
  )
}

describe('ScheduleReportsBell', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMarkAllScheduleRunsViewed.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('renders the unread count badge', () => {
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 3, failed: 0 } })
    renderBell()

    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('uses destructive styling when a run failed', () => {
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 3, failed: 1 } })
    renderBell()

    expect(screen.getByTestId('schedule-reports-count')).toHaveClass('bg-destructive')
  })

  it('renders nothing when there are no unread runs', () => {
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 0, failed: 0 } })
    renderBell()

    expect(screen.queryByRole('button', { name: /Reports/ })).not.toBeInTheDocument()
  })

  it('stays open with the all-caught-up state after the last unread run is cleared', async () => {
    const user = userEvent.setup()
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 1, failed: 0 } })
    const { rerender } = renderBell()

    await user.click(screen.getByRole('button', { name: 'Reports, 1 unread' }))
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 0, failed: 0 } })
    rerender(
      <MemoryRouter>
        <ScheduleReportsBell />
      </MemoryRouter>,
    )

    expect(await screen.findByText('All caught up')).toBeInTheDocument()
  })
})
