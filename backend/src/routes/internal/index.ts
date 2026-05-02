import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ScheduleService } from '../../services/schedules'
import { createScheduleRoutes } from '../schedules'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'

export function createInternalRoutes(db: Database, scheduleService: ScheduleService) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/schedules', createScheduleRoutes(scheduleService))
  const repos = new Hono()
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService))
  app.route('/repos', repos)
  return app
}
