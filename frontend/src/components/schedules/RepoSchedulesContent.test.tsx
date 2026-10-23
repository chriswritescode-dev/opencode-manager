import { useState } from 'react'
import type { ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateScheduleJobRequest, ScheduleJob } from '@opencode-manager/shared/types'
import type { ScheduleJobWithRepo } from '@/api/schedules'
import { RepoSchedulesContent } from './RepoSchedulesContent'

function createJob(id: number, name: string): ScheduleJobWithRepo {
  return {
    id,
    repoId: 1,
    name,
    description: null,
    enabled: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: `${name} prompt`,
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch: null,
    workspaceMode: 'worktree',
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: null,
    nextRunAt: null,
    repoName: 'demo',
    repoPath: '/workspace/repos/demo',
    repoUrl: '',
    serverName: null,
    lastRun: null,
    retainedWorktreeCount: 0,
  }
}

const store = vi.hoisted(() => ({
  jobs: [] as ScheduleJobWithRepo[],
  setJobs: null as ((jobs: ScheduleJobWithRepo[]) => void) | null,
  deleteMutate: vi.fn(),
  createMutate: vi.fn(),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useAllSchedules: () => ({ data: store.jobs, isLoading: false }),
  useRepoSchedule: () => ({ data: undefined, isFetching: false }),
  useRepoScheduleRuns: () => ({ data: [], isLoading: false }),
  useScheduleWorktrees: () => ({ data: [] }),
  useCreateRepoSchedule: () => ({ mutate: store.createMutate, isPending: false }),
  useUpdateRepoSchedule: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRepoSchedule: () => ({ mutate: store.deleteMutate, isPending: false }),
  useRunRepoSchedule: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelRepoScheduleRun: () => ({ mutate: vi.fn(), isPending: false }),
  useClearRepoScheduleRuns: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRepoScheduleRun: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/components/schedules', () => ({
  ScheduleJobsTable: ({ jobs, onDelete }: { jobs: ScheduleJob[]; onDelete: (job: ScheduleJob) => void }) => (
    <div>
      {jobs.map((job) => (
        <button key={job.id} onClick={() => onDelete(job)}>{`delete ${job.name}`}</button>
      ))}
    </div>
  ),
  ScheduleJobDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (data: CreateScheduleJobRequest) => void }) => (
    open ? <button onClick={() => onSubmit({} as CreateScheduleJobRequest)}>submit schedule</button> : null
  ),
  ScheduleListToolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ScheduleTabMenu: () => null,
  JobDetailTab: () => null,
  RunHistoryTab: () => null,
  ScheduleRunRemovalDialog: () => null,
}))

function Harness({ initialJobs }: { initialJobs: ScheduleJobWithRepo[] }) {
  const [jobs, setJobs] = useState(initialJobs)
  store.jobs = jobs
  store.setJobs = setJobs
  const location = useLocation()

  return (
    <div>
      <span data-testid="search">{location.search}</span>
      <RepoSchedulesContent repoId={1} embedded={false} />
    </div>
  )
}

function renderContent(initialJobs: ScheduleJobWithRepo[], initialEntry = '/repos/1/schedules') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Harness initialJobs={initialJobs} />
    </MemoryRouter>,
  )
}

describe('RepoSchedulesContent dialogs', () => {
  beforeEach(() => {
    store.jobs = []
    store.setJobs = null
    store.deleteMutate.mockReset()
    store.createMutate.mockReset()
  })

  it('names the schedule in the delete confirmation', async () => {
    const user = userEvent.setup()
    const alpha = createJob(1, 'Alpha')
    const beta = createJob(2, 'Beta')
    store.deleteMutate.mockImplementation(() => {})

    renderContent([alpha, beta])

    await user.click(screen.getByRole('button', { name: 'delete Beta' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Beta')).toBeInTheDocument()
    expect(within(dialog).getByText(/This will permanently delete/)).toBeInTheDocument()
  })

  it('closes the delete dialog after deleting and keeps it closed', async () => {
    const user = userEvent.setup()
    const alpha = createJob(1, 'Alpha')
    const beta = createJob(2, 'Beta')
    store.deleteMutate.mockImplementation((_args: unknown, options: { onSuccess: () => void }) => {
      store.setJobs?.([alpha])
      options.onSuccess()
    })

    const { rerender } = renderContent([alpha, beta], '/repos/1/schedules?jobId=2')

    await user.click(screen.getByRole('button', { name: 'delete Beta' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByTestId('search').textContent).not.toContain('scheduleDialog')
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(
      <MemoryRouter initialEntries={['/repos/1/schedules?jobId=2']}>
        <Harness initialJobs={[alpha, beta]} />
      </MemoryRouter>,
    )
    act(() => { store.setJobs?.([alpha]) })

    expect(screen.getByTestId('search').textContent).not.toContain('scheduleDialog')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the New schedule dialog after creating the first schedule', async () => {
    const user = userEvent.setup()
    const created = createJob(4, 'Gamma')
    store.createMutate.mockImplementation((_args: unknown, options: { onSuccess: (job: ScheduleJob) => void }) => {
      store.setJobs?.([created])
      options.onSuccess(created)
    })

    renderContent([], '/repos/1/schedules')

    await user.click(screen.getByRole('button', { name: 'Create First Schedule' }))
    expect(screen.getByRole('button', { name: 'submit schedule' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit schedule' }))

    expect(screen.getByTestId('search').textContent).not.toContain('scheduleDialog')
    expect(screen.getByTestId('search').textContent).toContain('jobId=4')
    expect(screen.queryByRole('button', { name: 'submit schedule' })).toBeNull()
  })
})
