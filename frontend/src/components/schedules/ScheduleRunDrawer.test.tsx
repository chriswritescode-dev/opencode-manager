import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { ScheduleRunDrawer } from './ScheduleRunDrawer'
import { renderWithProviders } from '@/test/render'
import { makeRepo, makeScheduleRunWithContext } from '@/test/fixtures/api'

const repo = makeRepo({ id: 5, name: 'my-repo', localPath: 'repos/my-repo', fullPath: '/abs/repos/my-repo' })

function makeRun(overrides: Partial<ReturnType<typeof makeScheduleRunWithContext>> = {}) {
  return makeScheduleRunWithContext({
    id: 1,
    jobId: 7,
    repoId: 5,
    status: 'completed',
    startedAt: 0,
    finishedAt: 60_000,
    viewedAt: 123,
    createdAt: 0,
    runBranch: 'feature/x',
    commitHash: 'abc1234def',
    jobName: 'Daily report',
    repoName: 'my-repo',
    repoPath: '/abs/repos/my-repo',
    ...overrides,
  })
}

function renderDrawer(props: Partial<ComponentProps<typeof ScheduleRunDrawer>> = {}) {
  return renderWithProviders(
    <ScheduleRunDrawer
      run={makeRun()}
      open
      onClose={vi.fn()}
      onCancelRun={vi.fn()}
      cancelPending={false}
      {...props}
    />,
    {
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: [
        { method: 'GET', path: '/api/repos/5', respond: () => ({ json: repo }) },
        { method: 'GET', path: '/api/repos/5/schedules/7/runs/1', respond: () => ({ json: { run: makeRun() } }) },
        { method: 'POST', path: '/api/schedules/all/runs/:runId/viewed', respond: () => ({ json: { updated: true } }) },
      ],
    },
  )
}

describe('ScheduleRunDrawer', () => {
  it('renders the title and meta row', async () => {
    renderDrawer()

    expect(screen.getByRole('heading', { name: 'Daily report' })).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('my-repo')).toBeInTheDocument()
    expect(screen.getByText('feature/x @ abc1234')).toBeInTheDocument()
  })

  it('calls onNextUnread from the Next unread button', () => {
    const onNextUnread = vi.fn()
    renderDrawer({ onNextUnread, nextUnreadCount: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Next unread (3)' }))

    expect(onNextUnread).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a not found message when no run is available', () => {
    renderDrawer({ run: null, open: true })

    expect(screen.getByText('Run not found')).toBeInTheDocument()
  })
})
