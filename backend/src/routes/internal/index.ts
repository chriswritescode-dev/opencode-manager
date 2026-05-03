import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ScheduleService } from '../../services/schedules'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import { createScheduleRoutes } from '../schedules'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'

export function createInternalRoutes(
  db: Database,
  scheduleService: ScheduleService,
  notificationService: NotificationService,
  settingsService: SettingsService,
) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/schedules', createScheduleRoutes(scheduleService))
  app.route('/notifications', createInternalNotificationRoutes(notificationService))
  app.route('/settings', createInternalSettingsRoutes(settingsService))
  const repos = new Hono()
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService))
  app.route('/repos', repos)
  return app
}
