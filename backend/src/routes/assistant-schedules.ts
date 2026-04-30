import { Hono } from 'hono'
import { timingSafeEqual } from 'crypto'
import type { Database } from 'bun:sqlite'
import {
  CreateScheduleJobRequestSchema,
  UpdateScheduleJobRequestSchema,
} from '@opencode-manager/shared/schemas'
import { ensureAssistantRepo, getAssistantSchedulerToken } from '../services/assistant-mode'
import { ScheduleService, ScheduleServiceError } from '../services/schedules'
import { handleServiceError, parseId } from '../utils/route-helpers'

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

async function requireAssistantScheduleToken(c: { req: { header: (name: string) => string | undefined }; json: (body: { error: string }, status: 401 | 403) => Response }) {
  const expectedToken = await getAssistantSchedulerToken()
  if (!expectedToken) {
    return c.json({ error: 'Assistant scheduler token is not initialized' }, 403)
  }

  const authorization = c.req.header('authorization')
  const actualToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  const expected = Buffer.from(expectedToken)
  const actual = Buffer.from(actualToken)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return null
}

export function createAssistantScheduleRoutes(db: Database, scheduleService: ScheduleService) {
  const app = new Hono()

  app.use('*', async (c, next) => {
    const response = await requireAssistantScheduleToken(c)
    if (response) return response
    await next()
  })

  app.get('/', (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      return c.json({ jobs: scheduleService.listJobs(assistantRepo.id), repo: assistantRepo })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list assistant schedules', ScheduleServiceError)
    }
  })

  app.post('/', async (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      const body = await c.req.json()
      const input = CreateScheduleJobRequestSchema.parse(body)
      const job = scheduleService.createJob(assistantRepo.id, input)
      return c.json({ job, repo: assistantRepo }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create assistant schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId', (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const job = scheduleService.getJob(assistantRepo.id, jobId)
      if (!job) {
        return c.json({ error: 'Schedule not found' }, 404)
      }
      return c.json({ job, repo: assistantRepo })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get assistant schedule', ScheduleServiceError)
    }
  })

  app.patch('/:jobId', async (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const body = await c.req.json()
      const input = UpdateScheduleJobRequestSchema.parse(body)
      const job = scheduleService.updateJob(assistantRepo.id, jobId, input)
      return c.json({ job, repo: assistantRepo })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update assistant schedule', ScheduleServiceError)
    }
  })

  app.delete('/:jobId', (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      scheduleService.deleteJob(assistantRepo.id, jobId)
      return c.json({ success: true, repo: assistantRepo })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete assistant schedule', ScheduleServiceError)
    }
  })

  app.post('/:jobId/run', async (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const run = await scheduleService.runJob(assistantRepo.id, jobId, 'manual')
      return c.json({ run, repo: assistantRepo })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to run assistant schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId/runs', (c) => {
    try {
      const assistantRepo = ensureAssistantRepo(db)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const limit = parseRunListLimit(c.req.query('limit'))
      return c.json({ runs: scheduleService.listRuns(assistantRepo.id, jobId, limit), repo: assistantRepo })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list assistant schedule runs', ScheduleServiceError)
    }
  })

  return app
}
