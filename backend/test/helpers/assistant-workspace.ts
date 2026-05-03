import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import type { Repo } from '@opencode-manager/shared/types'

export async function createTempAssistantWorkspace() {
  const workspacePath = await mkdtemp(path.join(tmpdir(), 'oc-assistant-'))
  process.env.WORKSPACE_PATH = workspacePath
  const reposPath = path.join(workspacePath, 'repos')
  const assistantDir = path.join(reposPath, 'assistant')
  return {
    workspacePath,
    reposPath,
    assistantDir,
    cleanup: () => rm(workspacePath, { recursive: true, force: true }),
  }
}

export function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

export const mockRepo: Repo = {
  id: 1,
  repoUrl: 'https://github.com/example/test-repo.git',
  localPath: 'test-repo',
  fullPath: '/tmp/test-repo',
  sourcePath: '/tmp/test-repo/.git',
  branch: 'main',
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: Date.now(),
  lastPulled: Date.now(),
  lastAccessedAt: Date.now(),
  openCodeConfigName: 'default',
  isWorktree: false,
  isLocal: false,
}
