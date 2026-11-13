import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ScheduleRoutesService } from '../schedules'
import type { NotificationRoutesService } from './notifications'
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
import { createInternalShellEnvRoutes } from './shell-env'
import { createInternalGitCredentialsRoutes } from './git-credentials'
import { createInternalSandboxRoutes } from './sandbox'
import { createInternalSessionArtifactRoutes } from './session-artifacts'
import { createMultiRunRoutes } from '../multi-runs'
import { createChangeWalkthroughRoutes } from '../change-walkthroughs'
import { createInternalWalkthroughSessionRoutes } from './walkthrough-sessions'
import type { SessionPermissionModePinner } from '../../services/session-permission-modes'
import type { SessionSandboxRoutesService } from '../session-sandbox'
import type { RepoWorkspaceProvider } from '../../services/repo-workspace'
import type { GitAuthService } from '../../services/git-auth'
import type { MultiRunRoutesService } from '../multi-runs'
import type { ChangeWalkthroughRoutesService } from '../change-walkthroughs'
import type { RepoEnvResolver } from '../../services/repo-env'

export function createInternalRoutes(
  db: Database,
  scheduleService: ScheduleRoutesService,
  notificationService: NotificationRoutesService,
  settingsService: SettingsService,
  openCodeClient: OpenCodeClient,
  permissionModes: SessionPermissionModePinner,
  repoWorkspaces: RepoWorkspaceProvider,
  gitAuthService: GitAuthService,
  multiRuns: MultiRunRoutesService,
  changeWalkthroughService: ChangeWalkthroughRoutesService,
  sessionSandbox: SessionSandboxRoutesService,
  repoEnvService: RepoEnvResolver,
) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/schedules', createScheduleRoutes(scheduleService))
  app.route('/multi-runs', createMultiRunRoutes(multiRuns))
  app.route('/notifications', createInternalNotificationRoutes(notificationService))
  app.route('/settings', createInternalSettingsRoutes(settingsService))
  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient, { redactSecrets: true }))
  const repos = new Hono()
  repos.route('/', createInternalRepoRoutes(db, settingsService, gitAuthService))
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService))
  repos.route('/', createInternalRepoSyncRoutes(db))
  repos.route('/', mirrorRoutes(db, openCodeClient, gitAuthService, repoWorkspaces))
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes(db))
  app.route('/sessions', createInternalSessionRoutes(db, openCodeClient, permissionModes, repoWorkspaces))
  app.route('/assistant', createInternalAssistantRoutes(openCodeClient))
  app.route('/change-walkthroughs', createChangeWalkthroughRoutes(changeWalkthroughService))
  app.route('/walkthrough-sessions', createInternalWalkthroughSessionRoutes(changeWalkthroughService))
  app.route('/session-artifacts', createInternalSessionArtifactRoutes(openCodeClient))
  app.route('/shell-env', createInternalShellEnvRoutes(db, repoEnvService))
  app.route('/git-credentials', createInternalGitCredentialsRoutes(db))
  app.route('/sandbox', createInternalSandboxRoutes(db, sessionSandbox, repoEnvService))
  return app
}
