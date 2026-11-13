import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduleReportsBell } from './ScheduleReportsBell'
import { UNREAD_SCHEDULE_RUNS_QUERY_KEY } from '@/hooks/useSchedules'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { UnreadScheduleRunsResponse } from '@/api/schedules'

function makeUnreadRuns(overrides: Partial<UnreadScheduleRunsResponse> = {}): UnreadScheduleRunsResponse {
  return { runs: [], total: 0, failed: 0, ...overrides }
}

function unreadRoutes(response: UnreadScheduleRunsResponse): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: '/api/schedules/all/runs/unread',
      respond: () => ({ json: response }),
    },
  ]
}

describe('ScheduleReportsBell', () => {
  it('renders the unread count badge', async () => {
    renderWithProviders(<ScheduleReportsBell />, { fetchRoutes: unreadRoutes(makeUnreadRuns({ total: 3 })) })

    expect(await screen.findByText('3')).toBeInTheDocument()
  })

  it('uses destructive styling when a run failed', async () => {
    renderWithProviders(<ScheduleReportsBell />, {
      fetchRoutes: unreadRoutes(makeUnreadRuns({ total: 3, failed: 1 })),
    })

    expect(await screen.findByText('3')).toHaveClass('bg-destructive')
  })

  it('renders nothing when there are no unread runs', async () => {
    renderWithProviders(<ScheduleReportsBell />, { fetchRoutes: unreadRoutes(makeUnreadRuns()) })

    await waitFor(() => expect(screen.queryByRole('button', { name: /Reports/ })).not.toBeInTheDocument())
  })

  it('stays open with the all-caught-up state after the last unread run is cleared', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(<ScheduleReportsBell />, {
      fetchRoutes: unreadRoutes(makeUnreadRuns({ total: 1 })),
    })

    await user.click(await screen.findByRole('button', { name: 'Reports, 1 unread' }))
    queryClient.setQueryData(UNREAD_SCHEDULE_RUNS_QUERY_KEY, makeUnreadRuns())

    expect(await screen.findByText('All caught up')).toBeInTheDocument()
    expect(screen.getByText('0 unread')).toBeInTheDocument()
  })

  it('marks all unread runs read when Mark all read is clicked', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderWithProviders(<ScheduleReportsBell />, {
      fetchRoutes: [
        ...unreadRoutes(makeUnreadRuns({ total: 2 })),
        { method: 'POST', path: '/api/schedules/all/runs/viewed', respond: () => ({ json: { updated: 2 } }) },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Reports, 2 unread' }))
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/schedules/all/runs/viewed')).toBeDefined())
  })
})
