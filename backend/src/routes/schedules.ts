import { Hono } from 'hono'
import {
  CreateScheduleJobRequestSchema,
  RemoveScheduleWorktreesRequestSchema,
  ScheduleRunWorktreesModeSchema,
  UpdateScheduleJobRequestSchema,
} from '@opencode-manager/shared/schemas'
import type { ScheduleRunWorktreesMode } from '@opencode-manager/shared/types'
import { ScheduleService, ScheduleServiceError } from '../services/schedules'
import { parseId, handleServiceError } from '../utils/route-helpers'

function parseServerId(value: string | undefined): string {
  if (!value) {
    throw new ScheduleServiceError('OpenCode server id is required', 400)
  }
  return value
}

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

function parseRunIdFilter(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!/^\d+$/.test(value)) {
    throw new ScheduleServiceError('Invalid run id', 400)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ScheduleServiceError('Run id must be a positive integer', 400)
  }

  return parsed
}

function parseWorktreesMode(value: string | undefined): ScheduleRunWorktreesMode {
  const result = ScheduleRunWorktreesModeSchema.safeParse(value)
  if (!result.success) {
    throw new ScheduleServiceError('Invalid worktrees mode', 400)
  }
  return result.data
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
      const runId = parseRunIdFilter(c.req.query('runId'))
      const search = c.req.query('search')?.slice(0, 200) || undefined
      const runs = scheduleService.listAllRuns({ limit, offset, status, repoId, jobId, triggerSource, runId, search })
      return c.json({ runs })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list all schedule runs', ScheduleServiceError)
    }
  })

  app.get('/all/runs/unread', (c) => {
    try {
      const limit = parseRunListLimit(c.req.query('limit'))
      const runs = scheduleService.listUnreadRuns(limit)
      const counts = scheduleService.countUnreadRuns()
      return c.json({ runs, total: counts.total, failed: counts.failed })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list unread schedule runs', ScheduleServiceError)
    }
  })

  app.post('/all/runs/viewed', (c) => {
    try {
      const updated = scheduleService.markAllRunsViewed()
      return c.json({ updated })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to mark schedule runs viewed', ScheduleServiceError)
    }
  })

  app.post('/all/runs/:runId/viewed', (c) => {
    try {
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      const updated = scheduleService.markRunViewed(runId)
      return c.json({ updated })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to mark schedule run viewed', ScheduleServiceError)
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
      const job = await scheduleService.createJob(repoId, input)
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
      const job = await scheduleService.updateJob(repoId, jobId, input)
      return c.json({ job })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update schedule', ScheduleServiceError)
    }
  })

  app.delete('/:jobId', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      await scheduleService.deleteJob(repoId, jobId)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId/worktrees', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      return c.json({ worktrees: scheduleService.listWorktrees(repoId, jobId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list schedule worktrees', ScheduleServiceError)
    }
  })

  app.delete('/:jobId/worktrees', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const body = await c.req.json().catch(() => ({}))
      const input = RemoveScheduleWorktreesRequestSchema.parse(body)
      const result = await scheduleService.removeWorktrees(repoId, jobId, input.worktreePath)
      return c.json(result)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to remove schedule worktrees', ScheduleServiceError)
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

  app.delete('/:jobId/runs', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const worktrees = parseWorktreesMode(c.req.query('worktrees'))
      const result = await scheduleService.clearRunHistory(repoId, jobId, worktrees)
      return c.json(result)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to clear schedule run history', ScheduleServiceError)
    }
  })

  app.delete('/:jobId/runs/:runId', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', ScheduleServiceError)
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      const worktrees = parseWorktreesMode(c.req.query('worktrees'))
      await scheduleService.deleteRun(repoId, jobId, runId, worktrees)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete schedule run', ScheduleServiceError)
    }
  })

  return app
}

/**
 * Schedule routes for a project directory on a linked OpenCode server. They mirror the
 * repo routes without worktree endpoints, because remote runs execute in place.
 */
export function createServerScheduleRoutes(scheduleService: ScheduleService) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      return c.json({ jobs: scheduleService.listServerJobs(parseServerId(c.req.param('serverId'))) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list schedules', ScheduleServiceError)
    }
  })

  app.post('/', async (c) => {
    try {
      const serverId = parseServerId(c.req.param('serverId'))
      const body = await c.req.json()
      const input = CreateScheduleJobRequestSchema.parse(body)
      if (!input.directory) {
        throw new ScheduleServiceError('A remote schedule requires an absolute target directory', 400)
      }
      const job = await scheduleService.createServerJob(serverId, input.directory, input)
      return c.json({ job }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId', (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const job = scheduleService.getServerJob(parseServerId(c.req.param('serverId')), jobId)
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
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const body = await c.req.json()
      const input = UpdateScheduleJobRequestSchema.parse(body)
      const job = await scheduleService.updateServerJob(parseServerId(c.req.param('serverId')), jobId, input)
      return c.json({ job })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update schedule', ScheduleServiceError)
    }
  })

  app.delete('/:jobId', async (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      await scheduleService.deleteServerJob(parseServerId(c.req.param('serverId')), jobId)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete schedule', ScheduleServiceError)
    }
  })

  app.post('/:jobId/run', async (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const run = await scheduleService.runServerJob(parseServerId(c.req.param('serverId')), jobId, 'manual')
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to run schedule', ScheduleServiceError)
    }
  })

  app.get('/:jobId/runs', (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const limit = parseRunListLimit(c.req.query('limit'))
      return c.json({ runs: scheduleService.listServerRuns(parseServerId(c.req.param('serverId')), jobId, limit) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list schedule runs', ScheduleServiceError)
    }
  })

  app.get('/:jobId/runs/:runId', (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      return c.json({ run: scheduleService.getServerRun(parseServerId(c.req.param('serverId')), jobId, runId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get schedule run', ScheduleServiceError)
    }
  })

  app.post('/:jobId/runs/:runId/cancel', async (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      const run = await scheduleService.cancelServerRun(parseServerId(c.req.param('serverId')), jobId, runId)
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to cancel schedule run', ScheduleServiceError)
    }
  })

  app.delete('/:jobId/runs', async (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      return c.json(await scheduleService.clearServerRunHistory(parseServerId(c.req.param('serverId')), jobId))
    } catch (error) {
      return handleServiceError(c, error, 'Failed to clear schedule run history', ScheduleServiceError)
    }
  })

  app.delete('/:jobId/runs/:runId', async (c) => {
    try {
      const jobId = parseId(c.req.param('jobId'), 'schedule id', ScheduleServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', ScheduleServiceError)
      await scheduleService.deleteServerRun(parseServerId(c.req.param('serverId')), jobId, runId)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete schedule run', ScheduleServiceError)
    }
  })

  return app
}


