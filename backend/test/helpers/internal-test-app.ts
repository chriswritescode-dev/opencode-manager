import { vi } from 'vitest'
import { createInternalRoutes } from '../../src/routes/internal'
import { GitAuthService } from '../../src/services/git-auth'
import { SettingsService } from '../../src/services/settings'
import { createStubOpenCodeClient } from './stub-opencode-client'
import { createStubRepoEnvService } from './stub-repo-env-service'

type CreateInternalRoutesParams = Parameters<typeof createInternalRoutes>

export interface InternalTestAppOverrides {
  scheduleService?: CreateInternalRoutesParams[1]
  notificationService?: CreateInternalRoutesParams[2]
  settingsService?: CreateInternalRoutesParams[3]
  openCodeClient?: CreateInternalRoutesParams[4]
  permissionModes?: CreateInternalRoutesParams[5]
  repoWorkspaces?: CreateInternalRoutesParams[6]
  gitAuthService?: CreateInternalRoutesParams[7]
  multiRuns?: CreateInternalRoutesParams[8]
  changeWalkthroughService?: CreateInternalRoutesParams[9]
  sessionSandbox?: CreateInternalRoutesParams[10]
  repoEnvService?: CreateInternalRoutesParams[11]
}

export function createInternalTestApp(
  db: CreateInternalRoutesParams[0],
  overrides: InternalTestAppOverrides = {},
) {
  return createInternalRoutes(
    db,
    overrides.scheduleService ?? {
      cancelRun: vi.fn(),
      cancelServerRun: vi.fn(),
      clearRunHistory: vi.fn(),
      clearServerRunHistory: vi.fn(),
      countUnreadRuns: vi.fn(),
      createJob: vi.fn(),
      createServerJob: vi.fn(),
      deleteJob: vi.fn(),
      deleteRun: vi.fn(),
      deleteServerJob: vi.fn(),
      deleteServerRun: vi.fn(),
      getJob: vi.fn(),
      getRun: vi.fn(),
      getServerJob: vi.fn(),
      getServerRun: vi.fn(),
      listAllJobsWithRepos: vi.fn(),
      listAllRuns: vi.fn(),
      listJobs: vi.fn(),
      listRuns: vi.fn(),
      listServerJobs: vi.fn(),
      listServerRuns: vi.fn(),
      listUnreadRuns: vi.fn(),
      listWorktrees: vi.fn(),
      markAllRunsViewed: vi.fn(),
      markRunViewed: vi.fn(),
      removeWorktrees: vi.fn(),
      runJob: vi.fn(),
      runServerJob: vi.fn(),
      updateJob: vi.fn(),
      updateServerJob: vi.fn(),
    },
    overrides.notificationService ?? {
      getScheduleRunReportUrl: vi.fn(),
      isConfigured: vi.fn(),
      sendToUser: vi.fn(),
    },
    overrides.settingsService ?? new SettingsService(db),
    overrides.openCodeClient ?? createStubOpenCodeClient(),
    overrides.permissionModes ?? { pinAsk: vi.fn() },
    overrides.repoWorkspaces ?? { create: vi.fn(), remove: vi.fn() },
    overrides.gitAuthService ?? new GitAuthService(),
    overrides.multiRuns ?? {
      discard: vi.fn(),
      fuse: vi.fn(),
      launch: vi.fn(),
      list: vi.fn(),
    },
    overrides.changeWalkthroughService ?? {
      cancelGeneration: vi.fn(),
      getState: vi.fn(),
      listHelperSessionIds: vi.fn(),
      publishFromWalkthroughSession: vi.fn(),
      readChangesForWalkthroughSession: vi.fn(),
      refine: vi.fn(),
      startGeneration: vi.fn(),
    },
    overrides.sessionSandbox ?? {
      getClaim: vi.fn(),
      getState: vi.fn(),
      resolveShellTarget: vi.fn(),
      update: vi.fn(),
    },
    overrides.repoEnvService ?? createStubRepoEnvService(),
  )
}
