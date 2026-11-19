import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { cloneRepo } from '../../src/services/repo'
import { getRepoById } from '../../src/db/queries'
import { createTestDatabase } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { createGitAuthService, createOrigin, git, uniqueName } from '../helpers/git-fixtures'

describe('repoService.cloneRepo auth env', () => {
  let workspace: TempWorkspace
  let db: Database
  let originPath: string
  let originHead: string

  beforeAll(() => {
    workspace = createTempWorkspace('ocm-repo-auth-env-')
    db = createTestDatabase()
    originPath = path.join(workspace.path, uniqueName('forge-origin.git'))
    const workPath = path.join(workspace.path, uniqueName('forge-work'))
    createOrigin(originPath, workPath)
    originHead = git(['rev-parse', 'HEAD'], workPath)
  })

  afterAll(() => {
    db.close()
    workspace.restore()
  })

  it('clones through the github extraheader environment git receives', async () => {
    const gitAuthService = createGitAuthService({
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${originPath}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/acme/forge',
    })

    const repo = await cloneRepo(db, gitAuthService, 'https://github.com/acme/forge.git', { directoryName: 'forge' })
    const clonePath = path.join(getReposPath(), 'forge')

    expect(repo.cloneStatus).toBe('ready')
    expect(getRepoById(db, repo.id)?.cloneStatus).toBe('ready')
    expect(existsSync(path.join(clonePath, '.git'))).toBe(true)
    expect(git(['rev-parse', 'HEAD'], clonePath)).toBe(originHead)
  })
})
