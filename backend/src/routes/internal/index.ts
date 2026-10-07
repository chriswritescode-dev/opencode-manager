import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ScheduleService } from '../../services/schedules'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import { createScheduleRoutes } from '../schedules'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'
import { createOpenCodeConfigRoutes } from '../opencode-config'
import { createInternalRepoRoutes } from './repos'
import { createInternalRepoSyncRoutes } from './repo-sync'
import { createInternalRepoMirrorRoutes as mirrorRoutes } from './repo-mirror'
import { createInternalOpenCodeWorkspacesRoutes } from './opencode-workspaces'
import { createInternalSessionRoutes } from './sessions'
import { createInternalAssistantRoutes } from './assistant'
import { createInternalGitCredentialsRoutes } from './git-credentials'
import { createInternalSandboxRoutes } from './sandbox'
import { createSessionGoalRoutes } from '../session-goals'
import { createMultiRunRoutes } from '../multi-runs'
import type { SessionPermissionModeService } from '../../services/session-permission-modes'
import type { RepoWorkspaceService } from '../../services/repo-workspace'
import type { GitAuthService } from '../../services/git-auth'
import type { SessionGoalService } from '../../services/session-goals'
import type { MultiRunService } from '../../services/multi-runs'

export function createInternalRoutes(
  db: Database,
  scheduleService: ScheduleService,
  notificationService: NotificationService,
  settingsService: SettingsService,
  openCodeClient: OpenCodeClient,
  permissionModes: SessionPermissionModeService,
  repoWorkspaces: RepoWorkspaceService,
  gitAuthService: GitAuthService,
  sessionGoals: SessionGoalService,
  multiRuns: MultiRunService,
) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/schedules', createScheduleRoutes(scheduleService))
  app.route('/session-goals', createSessionGoalRoutes(sessionGoals))
  app.route('/multi-runs', createMultiRunRoutes(multiRuns))
  app.route('/notifications', createInternalNotificationRoutes(notificationService))
  app.route('/settings', createInternalSettingsRoutes(settingsService))
  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient, { redactSecrets: true }))
  const repos = new Hono()
  repos.route('/', createInternalRepoRoutes(db, settingsService, gitAuthService))
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService))
  repos.route('/', createInternalRepoSyncRoutes(db))
  repos.route('/', mirrorRoutes(db))
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes(db))
  app.route('/sessions', createInternalSessionRoutes(db, openCodeClient, permissionModes, repoWorkspaces))
  app.route('/assistant', createInternalAssistantRoutes(openCodeClient))
  app.route('/git-credentials', createInternalGitCredentialsRoutes(db))
  app.route('/sandbox', createInternalSandboxRoutes(db))
  return app
}
