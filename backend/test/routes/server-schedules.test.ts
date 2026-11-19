import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { ScheduleJobSchema, ScheduleRunSchema } from '@opencode-manager/shared/schemas'
import { createServerScheduleRoutes } from '../../src/routes/schedules'
import { ScheduleServiceError } from '../../src/services/schedules'
import { readJson } from '../helpers/read-json'
import { buildScheduleJob, buildScheduleRun, createFakeScheduleService } from '../helpers/fake-schedule-service'

const JobsEnvelopeSchema = z.object({ jobs: z.array(ScheduleJobSchema) })
const JobEnvelopeSchema = z.object({ job: ScheduleJobSchema })
const RunsEnvelopeSchema = z.object({ runs: z.array(ScheduleRunSchema) })
const RunEnvelopeSchema = z.object({ run: ScheduleRunSchema })
const ErrorEnvelopeSchema = z.object({ error: z.string() })
const SuccessEnvelopeSchema = z.object({ success: z.boolean() })

const jsonHeaders = { 'Content-Type': 'application/json' }

function createApp(service = createFakeScheduleService()): Hono {
  const app = new Hono()
  app.route('/opencode-servers/:serverId/schedules', createServerScheduleRoutes(service))
  return app
}

describe('server schedule routes', () => {
  it('lists the jobs of a linked server', async () => {
    const app = createApp(createFakeScheduleService({
      listServerJobs: vi.fn(() => [buildScheduleJob({ id: 7, serverId: 'srv_kitchen' })]),
    }))

    const response = await app.request('/opencode-servers/srv_kitchen/schedules')
    const body = await readJson(response, JobsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.jobs.map((job) => job.id)).toEqual([7])
  })

  it('creates a remote schedule with its target directory', async () => {
    let receivedDirectory = ''
    const app = createApp(createFakeScheduleService({
      createServerJob: vi.fn(async (_serverId, directory, input) => {
        receivedDirectory = directory
        return buildScheduleJob({ name: input.name, directory })
      }),
    }))

    const response = await app.request('/opencode-servers/srv_kitchen/schedules', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Nightly audit',
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Audit the project.',
        directory: '/srv/projects/audit',
      }),
    })
    const body = await readJson(response, JobEnvelopeSchema)

    expect(response.status).toBe(201)
    expect(receivedDirectory).toBe('/srv/projects/audit')
    expect(body.job).toMatchObject({ name: 'Nightly audit', directory: '/srv/projects/audit' })
  })

  it('rejects a remote schedule without a directory', async () => {
    const app = createApp()

    const response = await app.request('/opencode-servers/srv_kitchen/schedules', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Nightly audit',
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Audit the project.',
      }),
    })
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('A remote schedule requires an absolute target directory')
  })

  it('updates, runs, and cancels a remote schedule', async () => {
    const app = createApp(createFakeScheduleService({
      updateServerJob: vi.fn(async (_serverId, _jobId, input) => buildScheduleJob({ name: input.name ?? 'Nightly audit' })),
      runServerJob: vi.fn(async (_serverId, _jobId, triggerSource) => buildScheduleRun({ status: 'running', triggerSource })),
      cancelServerRun: vi.fn(async () => buildScheduleRun({ status: 'cancelled' })),
    }))

    const updateResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Updated audit' }),
    })
    const updateBody = await readJson(updateResponse, JobEnvelopeSchema)

    const runResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/run', { method: 'POST' })
    const runBody = await readJson(runResponse, RunEnvelopeSchema)

    const cancelResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs/11/cancel', { method: 'POST' })
    const cancelBody = await readJson(cancelResponse, RunEnvelopeSchema)

    expect(updateResponse.status).toBe(200)
    expect(updateBody.job.name).toBe('Updated audit')
    expect(runResponse.status).toBe(200)
    expect(runBody.run).toMatchObject({ status: 'running', triggerSource: 'manual' })
    expect(cancelResponse.status).toBe(200)
    expect(cancelBody.run.status).toBe('cancelled')
  })

  it('lists and deletes runs for a remote schedule', async () => {
    const app = createApp(createFakeScheduleService({
      listServerRuns: vi.fn((_serverId, _jobId, limit) => [buildScheduleRun({ id: limit })]),
      getServerRun: vi.fn(() => buildScheduleRun({ id: 11 })),
      clearServerRunHistory: vi.fn(async () => ({ cleared: 1 })),
    }))

    const listResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs')
    const listBody = await readJson(listResponse, RunsEnvelopeSchema)

    const getResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs/11')
    const getBody = await readJson(getResponse, RunEnvelopeSchema)

    const clearResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs', { method: 'DELETE' })
    const clearBody = await readJson(clearResponse, z.object({ cleared: z.number() }))

    const deleteResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs/11', { method: 'DELETE' })

    expect(listResponse.status).toBe(200)
    expect(listBody.runs.map((run) => run.id)).toEqual([20])
    expect(getResponse.status).toBe(200)
    expect(getBody.run.id).toBe(11)
    expect(clearResponse.status).toBe(200)
    expect(clearBody.cleared).toBe(1)
    expect(deleteResponse.status).toBe(200)
  })

  it('returns 404 when a remote schedule does not exist', async () => {
    const app = createApp(createFakeScheduleService({ getServerJob: vi.fn(() => null) }))

    const response = await app.request('/opencode-servers/srv_kitchen/schedules/7')
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(404)
    expect(body.error).toBe('Schedule not found')
  })

  it('deletes a remote schedule', async () => {
    const app = createApp()

    const response = await app.request('/opencode-servers/srv_kitchen/schedules/7', { method: 'DELETE' })
    const body = await readJson(response, SuccessEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('maps service errors to their status', async () => {
    const app = createApp(createFakeScheduleService({
      runServerJob: vi.fn(async () => {
        throw new ScheduleServiceError('OpenCode server "Kitchen" is disabled', 400)
      }),
    }))

    const response = await app.request('/opencode-servers/srv_kitchen/schedules/7/run', { method: 'POST' })
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('OpenCode server "Kitchen" is disabled')
  })
})
