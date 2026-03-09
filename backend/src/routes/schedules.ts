import { Hono, type Context } from 'hono'
import type { Database } from 'bun:sqlite'
import {
  CreateScheduleJobRequestSchema,
  UpdateScheduleJobRequestSchema,
} from '@opencode-manager/shared/schemas'
import { ScheduleService, ScheduleServiceError } from '../services/schedules'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

function parseId(value: string | undefined, label: string): number {
  if (!value) {
    throw new ScheduleServiceError(`Missing ${label}`, 400)
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw new ScheduleServiceError(`Invalid ${label}`, 400)
  }
  return parsed
}

export function createScheduleRoutes(database: Database) {
  const app = new Hono()
  const scheduleService = new ScheduleService(database)

  app.get('/', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      return c.json({ jobs: scheduleService.listJobs(repoId) })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to list schedules')
    }
  })

  app.post('/', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const body = await c.req.json()
      const input = CreateScheduleJobRequestSchema.parse(body)
      const job = scheduleService.createJob(repoId, input)
      return c.json({ job }, 201)
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to create schedule')
    }
  })

  app.get('/:jobId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      const job = scheduleService.getJob(repoId, jobId)
      if (!job) {
        return c.json({ error: 'Schedule not found' }, 404)
      }
      return c.json({ job })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to get schedule')
    }
  })

  app.patch('/:jobId', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      const body = await c.req.json()
      const input = UpdateScheduleJobRequestSchema.parse(body)
      const job = scheduleService.updateJob(repoId, jobId, input)
      return c.json({ job })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to update schedule')
    }
  })

  app.delete('/:jobId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      scheduleService.deleteJob(repoId, jobId)
      return c.json({ success: true })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to delete schedule')
    }
  })

  app.post('/:jobId/run', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      const run = await scheduleService.runJob(repoId, jobId, 'manual')
      return c.json({ run })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to run schedule')
    }
  })

  app.get('/:jobId/runs', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      const limitQuery = c.req.query('limit')
      const limit = limitQuery ? parseId(limitQuery, 'limit') : 20
      return c.json({ runs: scheduleService.listRuns(repoId, jobId, limit) })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to list schedule runs')
    }
  })

  app.get('/:jobId/runs/:runId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      const runId = parseId(c.req.param('runId'), 'run id')
      return c.json({ run: scheduleService.getRun(repoId, jobId, runId) })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to get schedule run')
    }
  })

  app.post('/:jobId/runs/:runId/cancel', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id')
      const jobId = parseId(c.req.param('jobId'), 'schedule id')
      const runId = parseId(c.req.param('runId'), 'run id')
      const run = await scheduleService.cancelRun(repoId, jobId, runId)
      return c.json({ run })
    } catch (error) {
      return handleScheduleError(c, error, 'Failed to cancel schedule run')
    }
  })

  return app
}

function handleScheduleError(c: Context, error: unknown, fallbackMessage: string) {
  if (error instanceof ScheduleServiceError) {
    return c.json({ error: error.message }, error.status as 400 | 404 | 409 | 500 | 502)
  }

  logger.error(fallbackMessage + ':', error)
  return c.json({ error: getErrorMessage(error) }, 500)
}
