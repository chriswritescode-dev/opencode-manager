import { createInternalRoutes } from '../../src/routes/internal'
import { createStubOpenCodeClient } from './stub-opencode-client'

type CreateInternalRoutesParams = Parameters<typeof createInternalRoutes>

type InternalTestAppOverrides = Partial<{
  scheduleService: CreateInternalRoutesParams[1]
  notificationService: CreateInternalRoutesParams[2]
  settingsService: CreateInternalRoutesParams[3]
  openCodeClient: CreateInternalRoutesParams[4]
  permissionModes: CreateInternalRoutesParams[5]
  repoWorkspaces: CreateInternalRoutesParams[6]
  gitAuthService: CreateInternalRoutesParams[7]
  sessionGoals: CreateInternalRoutesParams[8]
  multiRuns: CreateInternalRoutesParams[9]
}>

export function createInternalTestApp(
  db: CreateInternalRoutesParams[0],
  overrides: InternalTestAppOverrides = {},
) {
  return createInternalRoutes(
    db,
    overrides.scheduleService ?? ({} as CreateInternalRoutesParams[1]),
    overrides.notificationService ?? ({} as CreateInternalRoutesParams[2]),
    overrides.settingsService ?? ({} as CreateInternalRoutesParams[3]),
    overrides.openCodeClient ?? createStubOpenCodeClient(),
    overrides.permissionModes ?? ({} as CreateInternalRoutesParams[5]),
    overrides.repoWorkspaces ?? ({} as CreateInternalRoutesParams[6]),
    overrides.gitAuthService ?? ({} as CreateInternalRoutesParams[7]),
    overrides.sessionGoals ?? ({} as CreateInternalRoutesParams[8]),
    overrides.multiRuns ?? ({} as CreateInternalRoutesParams[9]),
  )
}
