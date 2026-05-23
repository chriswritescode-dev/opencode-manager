import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ScheduleService } from '../../services/schedules'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import { createScheduleRoutes } from '../schedules'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'
import { createInternalRepoRoutes } from './repos'
import { createInternalOpenCodeWorkspacesRoutes } from './opencode-workspaces'
import { createInternalOpenCodeTargetRoutes } from './opencode-target'
import { createInternalRepoSessionRoutes } from './repo-sessions'
import type { RepoOpenCodeTargetManager } from '../../services/opencode/repo-target-manager'

export function createInternalRoutes(
  db: Database,
  scheduleService: ScheduleService,
  notificationService: NotificationService,
  settingsService: SettingsService,
  targetManager?: RepoOpenCodeTargetManager,
) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/schedules', createScheduleRoutes(scheduleService))
  app.route('/notifications', createInternalNotificationRoutes(notificationService))
  app.route('/settings', createInternalSettingsRoutes(settingsService))
  const repos = new Hono()
  repos.route('/', createInternalRepoRoutes(db, settingsService))
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService))
  if (targetManager) {
    repos.route('/:id/opencode-target', createInternalOpenCodeTargetRoutes(db, targetManager))
    repos.route('/:id/sessions', createInternalRepoSessionRoutes(db, targetManager))
  }
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes(db))
  return app
}
