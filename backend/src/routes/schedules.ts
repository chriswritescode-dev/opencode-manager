import { Hono } from 'hono'
import {
  CreateScheduleJobRequestSchema,
  UpdateScheduleJobRequestSchema,
} from '@opencode-manager/shared/schemas'
import { ScheduleService, ScheduleServiceError } from '../services/schedules'
import { parseId, handleServiceError } from '../utils/route-helpers'

function parseRunListLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20
  }

  const parsed = parseId(value, 'limit', ScheduleServiceError)
  if (parsed < 1) {
    throw new ScheduleServiceError('Limit must be greater than 0', 400)
  }

  return Math.min(parsed, 100)
}

export function createScheduleRoutes(scheduleService: ScheduleService) {
  const app = new Hono()

  app.get('/all', (c) => {
    try {
      const jobs = scheduleService.listAllJobsWithRepos()
      return c.json({ jobs })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list all schedules', ScheduleServiceError)
    }
  })

  app.get('/all/runs', (c) => {
    try {
      const limit = parseRunListLimit(c.req.query('limit'))
      const offsetStr = c.req.query('offset')
      const offset = offsetStr ? Math.max(parseInt(offsetStr, 10) || 0, 0) : 0
      const status = c.req.query('status') || undefined
      const repoIdStr = c.req.query('repoId')
      const repoId = repoIdStr ? (() => {
        const parsed = parseInt(repoIdStr, 10)
        return Number.isNaN(parsed) ? undefined : parsed
      })() : undefined
      const jobIdStr = c.req.query('jobId')
      const jobId = jobIdStr ? (() => {
        const parsed = parseInt(jobIdStr, 10)
        return Number.isNaN(parsed) ? undefined : parsed
      })() : undefined
      const triggerSource = c.req.query('triggerSource') || undefined
      const runs = scheduleService.listAllRuns({ limit, offset, status, repoId, jobId, triggerSource })
      return c.json({ runs })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list all schedule runs', ScheduleServiceError)
    }
  })

  app.get('/', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      return c.json({ jobs: scheduleService.listJobs(repoId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list schedules', ScheduleServiceError)
    }
  })

  app.post('/', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const body = await c.req.json()
      const input = CreateScheduleJobRequestSchema.parse(body)
      const job = scheduleService.createJob(repoId, input)
      return c.json({ job }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const job = scheduleService.getJob(repoId, jobId)
      if (!job) {
        return c.json({ error: 'Schedule not found' }, 404)
      }
      return c.json({ job })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get schedule', ScheduleServiceError)
    }
  })

  app.patch('/:jobId', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const body = await c.req.json()
      const input = UpdateScheduleJobRequestSchema.parse(body)
      const job = scheduleService.updateJob(repoId, jobId, input)
      return c.json({ job })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update schedule', ScheduleServiceError)
    }
  })

  app.delete('/:jobId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      scheduleService.deleteJob(repoId, jobId)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete schedule', ScheduleServiceError)
    }
  })

  app.post('/:jobId/run', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const run = await scheduleService.runJob(repoId, jobId, 'manual')
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to run schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId/runs', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const limit = parseRunListLimit(c.req.query('limit'))
      return c.json({ runs: scheduleService.listRuns(repoId, jobId, limit) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list schedule runs', ScheduleServiceError)
    }
  })

  app.get('/:jobId/runs/:runId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      return c.json({ run: scheduleService.getRun(repoId, jobId, runId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get schedule run', ScheduleServiceError)
    }
  })

  app.post('/:jobId/runs/:runId/cancel', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      const run = await scheduleService.cancelRun(repoId, jobId, runId)
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to cancel schedule run', ScheduleServiceError)
    }
  })

  return app
}


