import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { Schedules } from '../Schedules'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import {
  makeAssistantModeStatus,
  makeRepo,
  makeScheduleJob,
  makeScheduleJobWithRepo,
  makeScheduleRun,
} from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { ScheduleJob, ScheduleJobWithRepo, ScheduleRun } from '@opencode-manager/shared/types'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'

const repo = makeRepo({ id: 5, name: 'my-repo', localPath: 'repos/my-repo', fullPath: '/abs/repos/my-repo' })

interface SchedulesRenderOptions {
  route?: string
  repo?: ReturnType<typeof makeRepo> | null
  assistant?: AssistantModeStatus | null
  jobs?: ScheduleJobWithRepo[]
  job?: ScheduleJob | null
  runs?: ScheduleRun[]
}

function buildRoutes(options: SchedulesRenderOptions): FetchRoute[] {
  const repoBody = options.repo === undefined ? repo : options.repo
  const assistantBody = options.assistant === undefined ? makeAssistantModeStatus() : options.assistant
  const job = options.job === undefined ? makeScheduleJob({ id: 123, repoId: 5 }) : options.job
  return [
    {
      method: 'GET',
      path: '/api/repos/:id',
      respond: () => (repoBody ? { json: repoBody } : { status: 404, json: { error: 'Repository not found' } }),
    },
    {
      method: 'GET',
      path: '/api/repos/0/assistant-mode',
      respond: () => (assistantBody ? { json: assistantBody } : { status: 404, json: { error: 'Assistant not found' } }),
    },
    { method: 'POST', path: '/api/repos/:id/access', respond: () => ({ status: 204 }) },
    { method: 'GET', path: '/api/schedules/all', respond: () => ({ json: { jobs: options.jobs ?? [] } }) },
    {
      method: 'GET',
      path: '/api/repos/:id/schedules/:jobId',
      respond: () => (job ? { json: { job } } : { status: 404, json: { error: 'Schedule not found' } }),
    },
    {
      method: 'GET',
      path: '/api/repos/:id/schedules/:jobId/runs',
      respond: () => ({ json: { runs: options.runs ?? [] } }),
    },
    {
      method: 'GET',
      path: '/api/repos/:id/schedules/:jobId/worktrees',
      respond: () => ({ json: { worktrees: [] } }),
    },
    {
      method: 'POST',
      path: '/api/repos/:id/schedules/:jobId/run',
      respond: () => ({ json: { run: makeScheduleRun({ id: 9, jobId: 123 }) } }),
    },
    { method: 'DELETE', path: '/api/repos/:id/schedules/:jobId', respond: () => ({ status: 204 }) },
    { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  ]
}

function renderSchedules(options: SchedulesRenderOptions = {}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/repos/:id/schedules" element={<Schedules />} />
        <Route path="/repos/:id" element={<div>repo route</div>} />
        <Route path="/repos/:id/sessions/:sessionId" element={<div>session route</div>} />
        <Route path="/assistant" element={<div>assistant route</div>} />
      </Routes>
    </>,
    {
      route: options.route ?? '/repos/5/schedules',
      fetchRoutes: buildRoutes(options),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

describe('Schedules', () => {
  it('shows the assistant target name and subtitle for the built-in assistant', async () => {
    renderSchedules({ route: '/repos/0/schedules' })

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Built-in assistant')).toBeInTheDocument()
    expect(screen.queryByText('Repository not found')).not.toBeInTheDocument()
  })

  it('returns to the assistant page from the back button', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderSchedules({ route: '/repos/0/schedules' })

    await user.click(await screen.findByRole('button', { name: 'Go back' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/assistant'))
  })

  it('shows the repository name and subtitle for a repository target', async () => {
    renderSchedules()

    expect(await screen.findByText('my-repo')).toBeInTheDocument()
    expect(screen.getByText('repos/my-repo')).toBeInTheDocument()
  })

  it('returns to the repository from the back button', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderSchedules()

    await user.click(await screen.findByRole('button', { name: 'Go back' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/5'))
  })

  it('returns to the returnTo path when the URL provides one', async () => {
    const user = userEvent.setup()
    const { capturedPathname, capturedSearch } = renderSchedules({
      route: '/repos/5/schedules?returnTo=%2Frepos%2F5%2Fsessions%2Fabc%3Fassistant%3D1',
    })

    await user.click(await screen.findByRole('button', { name: 'Go back' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/5/sessions/abc'))
    expect(capturedSearch.current).toBe('?assistant=1')
  })

  it('runs the assistant schedule through the repo-0 target', async () => {
    const user = userEvent.setup()
    const assistantJob = makeScheduleJobWithRepo({ id: 123, repoId: 0, name: 'Test Job' })
    const { fetchFake } = renderSchedules({
      route: '/repos/0/schedules?scheduleTab=detail&jobId=123',
      jobs: [assistantJob],
      job: makeScheduleJob({ id: 123, repoId: 0, name: 'Test Job' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Run now' }))

    await waitFor(() => {
      expect(fetchFake.findRequests('POST', '/api/repos/0/schedules/123/run')).toHaveLength(1)
    })
  })

  it('normalizes the prompts tab back to jobs when jobs exist', async () => {
    const job = makeScheduleJobWithRepo({ id: 123, repoId: 5, name: 'Test Job' })
    const { capturedSearch } = renderSchedules({
      route: '/repos/5/schedules?scheduleTab=prompts&jobId=123',
      jobs: [job],
      job: makeScheduleJob({ id: 123, repoId: 5, name: 'Test Job' }),
    })

    expect(await screen.findByRole('button', { name: 'Open Test Job' })).toBeInTheDocument()
    await waitFor(() => expect(capturedSearch.current).not.toContain('scheduleTab=prompts'))
  })

  it('shows a not-found state for a missing repository', async () => {
    renderSchedules({ route: '/repos/999/schedules', repo: null })

    expect(await screen.findByText('Repository not found')).toBeInTheDocument()
  })

  it('shows a not-found state for a missing assistant', async () => {
    renderSchedules({ route: '/repos/0/schedules', assistant: null })

    expect(await screen.findByText('Assistant not found')).toBeInTheDocument()
  })

  it('closes the schedule dialog when cancelled', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderSchedules({
      route: '/repos/5/schedules?scheduleDialog=edit&jobId=123',
      jobs: [makeScheduleJobWithRepo({ id: 123, repoId: 5, name: 'Test Job' })],
      job: makeScheduleJob({ id: 123, repoId: 5, name: 'Test Job' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(capturedSearch.current).not.toContain('scheduleDialog'))
  })

  it('deletes the scheduled job and closes the delete dialog', async () => {
    const user = userEvent.setup()
    const { capturedSearch, fetchFake } = renderSchedules({
      route: '/repos/5/schedules?scheduleDialog=delete&jobId=123',
      jobs: [makeScheduleJobWithRepo({ id: 123, repoId: 5, name: 'Test Job' })],
      job: makeScheduleJob({ id: 123, repoId: 5, name: 'Test Job' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(fetchFake.findRequests('DELETE', '/api/repos/5/schedules/123')).toHaveLength(1)
    })
    await waitFor(() => expect(capturedSearch.current).not.toContain('scheduleDialog'))
  })

  it('opens the edit dialog from the job detail tab', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderSchedules({
      route: '/repos/5/schedules?scheduleTab=detail&jobId=123',
      jobs: [makeScheduleJobWithRepo({ id: 123, repoId: 5, name: 'Test Job' })],
      job: makeScheduleJob({ id: 123, repoId: 5, name: 'Test Job' }),
    })

    await user.click(await screen.findByTitle('Edit'))

    await waitFor(() => expect(capturedSearch.current).toContain('scheduleDialog=edit'))
  })
})
