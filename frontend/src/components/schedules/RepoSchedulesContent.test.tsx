import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ScheduleJobWithRepo } from '@/api/schedules'
import { RepoSchedulesContent } from './RepoSchedulesContent'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import { makeHealthResponse, makeRepo, makeScheduleJobWithRepo } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

function createJob(id: number, name: string): ScheduleJobWithRepo {
  return makeScheduleJobWithRepo({
    id,
    name,
    repoId: 1,
    prompt: `${name} prompt`,
    repoName: 'demo',
    repoPath: '/workspace/repos/demo',
  })
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="search">{location.search}</span>
}

function Harness() {
  return (
    <div>
      <LocationProbe />
      <RepoSchedulesContent repoId={1} embedded={false} />
    </div>
  )
}

interface ScheduleServer {
  routes: FetchRoute[]
  setJobs: (jobs: ScheduleJobWithRepo[]) => void
}

function createScheduleServer(initialJobs: ScheduleJobWithRepo[]): ScheduleServer {
  let jobs = initialJobs
  const jobsResponse = (): FetchRouteResult => ({ json: { jobs } })
  return {
    routes: [
      { method: 'GET', path: '/api/schedules/all', respond: jobsResponse },
      { method: 'GET', path: '/api/repos/1/schedules/:jobId', respond: () => ({ json: { job: jobs[0] } }) },
      { method: 'GET', path: '/api/repos/1/schedules/:jobId/runs', respond: () => ({ json: { runs: [] } }) },
      { method: 'GET', path: '/api/repos/1/schedules/:jobId/worktrees', respond: () => ({ json: { worktrees: [] } }) },
      { method: 'GET', path: '/api/repos/1', respond: () => ({ json: makeRepo({ id: 1 }) }) },
      { method: 'GET', path: '/api/repos/1/git/branches', respond: () => ({ json: { branches: [], status: { ahead: 0, behind: 0 } } }) },
      { method: 'GET', path: '/api/prompt-templates', respond: () => ({ json: { templates: [] } }) },
      { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse() }) },
      { method: 'GET', path: '/api/settings/skills', respond: () => ({ json: [] }) },
      { method: 'GET', path: '/api/opencode/api/agent', respond: () => ({ json: { location: { directory: '/workspace/repos/demo' }, data: [] } }) },
      { method: 'GET', path: '/api/opencode/api/mcp', respond: () => ({ json: { location: { directory: '/workspace/repos/demo' }, data: [] } }) },
      { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { location: { directory: '/workspace/repos/demo' }, data: [] } }) },
      { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { location: { directory: '/workspace/repos/demo' }, data: [] } }) },
    ],
    setJobs: (nextJobs) => {
      jobs = nextJobs
    },
  }
}

function renderContent(options: {
  jobs: ScheduleJobWithRepo[]
  initialEntry?: string
  extraRoutes?: FetchRoute[]
}) {
  installPointerCapture()
  const server = createScheduleServer(options.jobs)
  const view = renderWithProviders(<Harness />, {
    auth: false,
    theme: false,
    route: options.initialEntry ?? '/repos/1/schedules',
    fetchRoutes: [...(options.extraRoutes ?? []), ...server.routes],
  })
  return { ...view, server }
}

async function deleteJob(user: ReturnType<typeof userEvent.setup>, name: string, confirm: boolean) {
  const row = (await screen.findByRole('button', { name: `Open ${name}` })).closest('tr')
  expect(row).not.toBeNull()
  await user.click(within(row ?? document.body).getByRole('button', { name: 'More actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  if (confirm) {
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  }
  return dialog
}

describe('RepoSchedulesContent dialogs', () => {
  it('names the schedule in the delete confirmation', async () => {
    const user = userEvent.setup()
    renderContent({ jobs: [createJob(1, 'Alpha'), createJob(2, 'Beta')] })

    const dialog = await deleteJob(user, 'Beta', false)

    expect(within(dialog).getByText('Beta')).toBeInTheDocument()
    expect(within(dialog).getByText(/This will permanently delete/)).toBeInTheDocument()
  })

  it('closes the delete dialog after deleting and keeps it closed', async () => {
    const user = userEvent.setup()
    const alpha = createJob(1, 'Alpha')
    const beta = createJob(2, 'Beta')
    const { server } = renderContent({
      jobs: [alpha, beta],
      initialEntry: '/repos/1/schedules?jobId=2',
      extraRoutes: [
        {
          method: 'DELETE',
          path: '/api/repos/1/schedules/:jobId',
          respond: () => {
            server.setJobs([alpha])
            return { status: 204 }
          },
        },
      ],
    })

    await deleteJob(user, 'Beta', true)

    await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('scheduleDialog'))
    expect(screen.queryByRole('dialog')).toBeNull()

    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('jobId=1'))
    expect(screen.getByTestId('search').textContent).not.toContain('scheduleDialog')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the New schedule dialog after creating the first schedule', async () => {
    const user = userEvent.setup()
    const created = createJob(4, 'Gamma')
    const { fetchFake, server } = renderContent({
      jobs: [],
      extraRoutes: [
        {
          method: 'POST',
          path: '/api/repos/1/schedules',
          respond: () => {
            server.setJobs([created])
            return { json: { job: created } }
          },
        },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Create First Schedule' }))
    await user.type(await screen.findByLabelText('Name'), 'Gamma')
    await user.click(screen.getByRole('tab', { name: 'Prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Do the thing')
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() =>
      expect(fetchFake.requests.map((request) => `${request.method} ${request.path}`)).toContain('POST /api/repos/1/schedules'),
    )
    expect(fetchFake.lastRequest('POST', '/api/repos/1/schedules')?.body).toMatchObject({
      name: 'Gamma',
      prompt: 'Do the thing',
      scheduleMode: 'interval',
    })
    await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('scheduleDialog'))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('jobId=4'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create schedule' })).toBeNull())
  })
})
