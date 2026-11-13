import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { GlobalSchedules } from '../GlobalSchedules'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import {
  makeRepo,
  makeScheduleJobWithRepo,
  makeScheduleRunWithContext,
} from '@/test/fixtures/api'
import type { FetchRoute, RecordedFetchRequest } from '@/test/fetchFake'
import type { ScheduleJobWithRepo, ScheduleRunWithContext } from '@opencode-manager/shared/types'

const repo = makeRepo({ id: 1, name: 'my-repo', fullPath: '/home/user/my-repo' })

interface GlobalSchedulesRenderOptions {
  route?: string
  jobs?: ScheduleJobWithRepo[]
  historyRuns?: ScheduleRunWithContext[]
  selectedRuns?: (runId: number, request: RecordedFetchRequest) => ScheduleRunWithContext[]
  selectedStatus?: number
  selectedPending?: boolean
  seedSelectedRun?: ScheduleRunWithContext
}

function selectedRunLookup(request: RecordedFetchRequest): ScheduleRunWithContext[] {
  const runId = Number(request.searchParams.get('runId') ?? 0)
  return [makeScheduleRunWithContext({ id: runId, jobId: 7, jobName: `Run ${runId}`, sessionTitle: `Run ${runId}` })]
}

function buildRoutes(options: GlobalSchedulesRenderOptions): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/schedules/all', respond: () => ({ json: { jobs: options.jobs ?? [] } }) },
    {
      method: 'GET',
      path: '/api/schedules/all/runs',
      respond: (request) => {
        if (request.searchParams.get('limit') === '1') {
          if (options.selectedPending) return new Promise<never>(() => undefined)
          const runId = Number(request.searchParams.get('runId') ?? 0)
          if (options.selectedStatus && options.selectedStatus !== 200) {
            return { status: options.selectedStatus, json: { error: 'Run lookup failed' } }
          }
          const respond = options.selectedRuns ?? selectedRunLookup
          return { json: { runs: respond(runId, request) } }
        }
        return { json: { runs: options.historyRuns ?? [] } }
      },
    },
    { method: 'GET', path: '/api/schedules/all/runs/unread', respond: () => ({ json: { runs: [], total: 0, failed: 0 } }) },
    { method: 'GET', path: '/api/repos/:id', respond: () => ({ json: repo }) },
    { method: 'POST', path: '/api/schedules/all/runs/:runId/viewed', respond: () => ({ json: { updated: true } }) },
    {
      method: 'GET',
      path: '/api/repos/:id/schedules/:jobId/runs/:runId',
      respond: (_request, params) => ({
        json: {
          run: makeScheduleRunWithContext({ id: Number(params.runId), jobId: Number(params.jobId) }),
        },
      }),
    },
  ]
}

function renderGlobalSchedules(options: GlobalSchedulesRenderOptions = {}) {
  const queryClient = createTestQueryClient()
  if (options.seedSelectedRun) {
    const runId = options.seedSelectedRun.id
    queryClient.setQueryData(['all-schedule-runs', { limit: 1, runId }], [options.seedSelectedRun])
  }
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/schedules" element={<GlobalSchedules />} />
        <Route path="/servers/:serverId/projects" element={<div>server project route</div>} />
        <Route path="/repos/:id/schedules" element={<div>repo schedules route</div>} />
      </Routes>
    </>,
    {
      route: options.route ?? '/schedules',
      queryClient,
      fetchRoutes: buildRoutes(options),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

function historyRuns(count: number): ScheduleRunWithContext[] {
  return Array.from({ length: count }, (_, index) =>
    makeScheduleRunWithContext({
      id: index + 1,
      jobId: 7,
      jobName: `Run ${index + 1}`,
      sessionTitle: `Run ${index + 1}`,
    }),
  )
}

describe('GlobalSchedules run history', () => {
  it('pins the selected run outside the loaded history and loads it by id', async () => {
    const { fetchFake } = renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      historyRuns: historyRuns(50),
      selectedRuns: () => [
        makeScheduleRunWithContext({ id: 999, jobId: 7, jobName: 'Deep linked run' }),
      ],
    })

    expect(await screen.findByRole('dialog', { name: 'Deep linked run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open run Deep linked run' })).toBeInTheDocument()
    const lookup = fetchFake.findRequests('GET', '/api/schedules/all/runs').filter(
      (request) => request.searchParams.get('limit') === '1',
    )
    const lastLookup = lookup[lookup.length - 1]
    expect(lastLookup?.searchParams.get('runId')).toBe('999')
  })

  it('does not duplicate a selected run already present in history', async () => {
    const runs = historyRuns(6)
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=5',
      historyRuns: runs,
      seedSelectedRun: runs[4],
    })

    expect(await screen.findByRole('button', { name: 'Open run Run 5' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open run Run 5' })).toHaveLength(1)
    expect(await screen.findByRole('dialog', { name: 'Run 5' })).toBeInTheDocument()
  })

  it('shows a loading drawer while the selected run lookup is pending', async () => {
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      selectedPending: true,
    })

    const drawer = await screen.findByRole('dialog', { name: 'Run' })
    expect(drawer).toBeInTheDocument()
    expect(within(drawer).queryByText('Run not found')).not.toBeInTheDocument()
  })

  it('reports a missing selected run in the drawer', async () => {
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      selectedRuns: () => [],
    })

    expect(await screen.findByText('Run not found')).toBeInTheDocument()
  })

  it('reports a failed selected run lookup and retries it', async () => {
    const { fetchFake } = renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      selectedStatus: 500,
    })

    expect(await screen.findByText('Failed to load run')).toBeInTheDocument()
    const before = fetchFake.findRequests('GET', '/api/schedules/all/runs').length

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(fetchFake.findRequests('GET', '/api/schedules/all/runs').length).toBeGreaterThan(before)
    })
  })

  it('shows the cached selected run when a background refetch fails', async () => {
    const cachedRun = makeScheduleRunWithContext({ id: 999, jobId: 7, jobName: 'Deep linked run' })
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      selectedStatus: 500,
      seedSelectedRun: cachedRun,
    })

    expect(await screen.findByRole('dialog', { name: 'Deep linked run' })).toBeInTheDocument()
    expect(screen.queryByText('Failed to load run')).not.toBeInTheDocument()
  })

  it('loads the newly selected run when the selection changes', async () => {
    const user = userEvent.setup()
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      historyRuns: [
        makeScheduleRunWithContext({ id: 1000, jobId: 7, jobName: 'Run 1000' }),
      ],
      selectedRuns: (runId) => [
        makeScheduleRunWithContext({ id: runId, jobId: 7, jobName: `Run ${runId}` }),
      ],
    })

    expect(await screen.findByRole('dialog', { name: 'Run 999' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open run Run 1000' }))

    expect(await screen.findByRole('dialog', { name: 'Run 1000' })).toBeInTheDocument()
  })

  it('drops the selected run from the table when the selection is cleared', async () => {
    const user = userEvent.setup()
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=runs&runId=999',
      historyRuns: [makeScheduleRunWithContext({ id: 1, jobId: 7, jobName: 'Run 1' })],
      selectedRuns: () => [
        makeScheduleRunWithContext({ id: 999, jobId: 7, jobName: 'Deep linked run' }),
      ],
    })

    expect(await screen.findByRole('button', { name: 'Open run Deep linked run' })).toBeInTheDocument()

    await user.click(within(await screen.findByRole('dialog', { name: 'Deep linked run' })).getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open run Deep linked run' })).not.toBeInTheDocument()
    })
  })

  it('loads the selected run on the jobs tab as well', async () => {
    renderGlobalSchedules({
      route: '/schedules?scheduleTab=jobs&runId=999',
      jobs: [makeScheduleJobWithRepo({ id: 7, name: 'Weekly summary' })],
      selectedRuns: () => [
        makeScheduleRunWithContext({ id: 999, jobId: 7, jobName: 'Deep linked run' }),
      ],
    })

    expect(await screen.findByRole('dialog', { name: 'Deep linked run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Weekly summary' })).toBeInTheDocument()
  })

  it('opens the report drawer from a job row that has a last run', async () => {
    const user = userEvent.setup()
    renderGlobalSchedules({
      jobs: [
        makeScheduleJobWithRepo({
          id: 7,
          name: 'Weekly summary',
          lastRun: {
            id: 5,
            status: 'completed',
            startedAt: 0,
            finishedAt: 1,
            viewedAt: 1,
            preview: null,
          },
        }),
      ],
      selectedRuns: () => [
        makeScheduleRunWithContext({ id: 5, jobId: 7, jobName: 'Last run report' }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Open Weekly summary' }))

    expect(await screen.findByRole('dialog', { name: 'Last run report' })).toBeInTheDocument()
  })

  it('opens a linked-server job on its project page', async () => {
    const user = userEvent.setup()
    const { capturedPathname, capturedSearch } = renderGlobalSchedules({
      jobs: [
        makeScheduleJobWithRepo({
          id: 7,
          name: 'Deploy report',
          repoId: null,
          serverId: 'srv_kitchen',
          directory: '/home/me/app',
          lastRun: null,
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Open Deploy report' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/projects'))
    expect(capturedSearch.current).toBe('?directory=%2Fhome%2Fme%2Fapp')
  })

  it('keeps the jobs tab visible with the empty state when there are no jobs', async () => {
    renderGlobalSchedules()

    expect(await screen.findByText('No schedules yet')).toBeInTheDocument()
  })
})
