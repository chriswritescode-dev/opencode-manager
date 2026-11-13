import { Database } from 'bun:sqlite'
import type { UserPreferences } from '@opencode-manager/shared/types'
import { DEFAULT_USER_PREFERENCES, UserPreferencesSchema } from '@opencode-manager/shared/schemas'
import type { OpenCodeServer, ScheduleJob } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { insertOpenCodeServer, type OpenCodeServerInsert } from '../../src/db/opencode-servers'
import { createScheduleJob } from '../../src/db/schedules'
import type { ScheduleJobPersistenceInput } from '../../src/services/schedule-config'
import { setSessionPin, type SessionPinRecord } from '../../src/db/session-pins'
import type { Repo } from '../../src/types/repo'

let repoSequence = 0

export function createTestDatabase(dbPath: string = ':memory:'): Database {
  const db = new Database(dbPath)
  migrate(db, allMigrations)
  return db
}


export interface SeedRepoOptions {
  localPath?: string
  sourcePath?: string
  branch?: string
  defaultBranch?: string
  cloneStatus?: Repo['cloneStatus']
  clonedAt?: number
  isWorktree?: boolean
  isLocal?: boolean
  repoUrl?: string
}

export function seedRepo(db: Database, overrides: SeedRepoOptions = {}): Repo {
  repoSequence += 1
  const localPath = overrides.localPath ?? `/tmp/test-repos/repo-${repoSequence}`
  const common = {
    localPath,
    defaultBranch: overrides.defaultBranch ?? 'main',
    cloneStatus: overrides.cloneStatus ?? 'ready',
    clonedAt: overrides.clonedAt ?? Date.now(),
    sourcePath: overrides.sourcePath,
    branch: overrides.branch,
    isWorktree: overrides.isWorktree,
  }
  if (overrides.isLocal === false) {
    return createRepo(db, { ...common, isLocal: false, repoUrl: overrides.repoUrl ?? '' })
  }
  return createRepo(db, { ...common, isLocal: true, repoUrl: overrides.repoUrl })
}

export function seedOpenCodeServer(db: Database, overrides: Partial<OpenCodeServerInsert> = {}): OpenCodeServer {
  return insertOpenCodeServer(db, {
    name: 'Kitchen',
    baseUrl: 'http://127.0.0.1:5551',
    username: 'opencode',
    enabled: true,
    ...overrides,
  })
}

export function seedScheduleJob(
  db: Database,
  repoId: number | null,
  overrides: Partial<ScheduleJobPersistenceInput> = {},
): ScheduleJob {
  return createScheduleJob(db, repoId, {
    name: 'Nightly audit',
    description: null,
    prompt: 'Audit the project.',
    enabled: true,
    showInInbox: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    model: null,
    skillMetadata: undefined,
    permissionConfig: null,
    mcpServers: [],
    branch: 'main',
    workspaceMode: 'worktree',
    sandbox: null,
    nextRunAt: null,
    ...overrides,
  })
}

export function seedSessionPin(db: Database, sessionId: string, directory: string): SessionPinRecord[] {
  return setSessionPin(db, sessionId, directory, true)
}

export function seedSettings(db: Database, preferences: Partial<UserPreferences> = {}, userId = 'default'): void {
  const merged = UserPreferencesSchema.parse({ ...DEFAULT_USER_PREFERENCES, ...preferences })
  db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)')
    .run(userId, JSON.stringify(merged), Date.now())
}
