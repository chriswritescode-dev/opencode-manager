import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { createRepoRow, ensureMirrorTargetPath, isDirectoryInUse, isRepoInUse } from '../../src/services/repo'
import { getRepoById, listRepos } from '../../src/db/queries'
import { extractPartsToStaging } from '../../src/routes/internal/repo-mirror-helpers'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

let workspace: TempWorkspace

beforeEach(() => {
  workspace = createTempWorkspace('ocm-mirror-test-')
})

afterEach(() => {
  vi.restoreAllMocks()
  workspace.restore()
})

function createDatabase(): Database {
  return createTestDatabase()
}

describe('ensureMirrorTargetPath', () => {
  it('returns a path under the repos root', () => {
    const result = ensureMirrorTargetPath('demo')

    expect(result.localPath).toBe('demo')
    expect(result.fullPath).toBe(path.join(getReposPath(), 'demo'))
  })

  it('appends -2 when the target directory already exists on disk', () => {
    const result1 = ensureMirrorTargetPath('demo')
    expect(result1.localPath).toBe('demo')

    fs.mkdirSync(result1.fullPath, { recursive: true })

    const result2 = ensureMirrorTargetPath('demo')
    expect(result2.localPath).toBe('demo-2')
    expect(result2.fullPath).toBe(path.join(getReposPath(), 'demo-2'))
  })

  it('continues incrementing suffix on successive collisions', () => {
    fs.mkdirSync(path.join(getReposPath(), 'demo'), { recursive: true })
    fs.mkdirSync(path.join(getReposPath(), 'demo-2'), { recursive: true })
    fs.mkdirSync(path.join(getReposPath(), 'demo-3'), { recursive: true })

    const result = ensureMirrorTargetPath('demo')
    expect(result.localPath).toBe('demo-4')
    expect(result.fullPath).toBe(path.join(getReposPath(), 'demo-4'))
  })

  it('slugifies names with special characters', () => {
    const result = ensureMirrorTargetPath('My Repo Name!')

    expect(result.localPath).toBe('my-repo-name')
    expect(result.fullPath).toBe(path.join(getReposPath(), 'my-repo-name'))
  })

  it('falls back to "repo" when slugification produces empty string', () => {
    const result = ensureMirrorTargetPath('!!!')

    expect(result.localPath).toBe('repo')
    expect(result.fullPath).toBe(path.join(getReposPath(), 'repo'))
  })
})

describe('createRepoRow', () => {
  let db: Database
  let reposRoot: string

  beforeEach(() => {
    db = createDatabase()
    reposRoot = getReposPath()
  })

  afterEach(() => {
    db.close()
  })

  it('creates a local repo row that is ready', () => {
    const result = createRepoRow(db, { name: 'demo', localPath: 'demo', fullPath: path.join(reposRoot, 'demo') })

    expect(result.created).toBe(true)
    expect(result.repo.cloneStatus).toBe('ready')
    expect(result.repo.isLocal).toBe(true)
    expect(result.repo.repoUrl).toBeUndefined()
    expect(getRepoById(db, result.repo.id)?.localPath).toBe('demo')
  })

  it('creates a remote repo row when an origin URL is provided', () => {
    const result = createRepoRow(db, {
      name: 'demo',
      originUrl: 'https://github.com/example/repo.git',
      localPath: 'demo',
      fullPath: path.join(reposRoot, 'demo'),
      branch: 'main',
    })

    expect(result.created).toBe(true)
    expect(result.repo.cloneStatus).toBe('ready')
    expect(result.repo.isLocal).not.toBe(true)
    expect(result.repo.repoUrl).toBe('https://github.com/example/repo.git')
    expect(getRepoById(db, result.repo.id)?.repoUrl).toBe('https://github.com/example/repo.git')
  })

  it('uses supplied branch as defaultBranch fallback', () => {
    const result = createRepoRow(db, {
      name: 'demo',
      localPath: 'demo',
      fullPath: path.join(reposRoot, 'demo'),
      branch: 'develop',
    })

    expect(result.repo.branch).toBe('develop')
    expect(result.repo.defaultBranch).toBe('develop')
  })

  it('returns the existing repo for a matching origin URL', () => {
    const originUrl = 'https://github.com/example/repo.git'
    const first = createRepoRow(db, {
      name: 'demo',
      originUrl,
      localPath: 'demo',
      fullPath: path.join(reposRoot, 'demo'),
      branch: 'main',
    })

    const second = createRepoRow(db, {
      name: 'new-name',
      originUrl,
      localPath: 'new-name',
      fullPath: path.join(reposRoot, 'new-name'),
      branch: 'main',
    })

    expect(second.created).toBe(false)
    expect(second.repo.id).toBe(first.repo.id)
    expect(listRepos(db)).toHaveLength(1)
  })

  it('returns the existing repo for a matching local path', () => {
    const first = createRepoRow(db, {
      name: 'demo',
      localPath: 'existing-repo',
      fullPath: path.join(reposRoot, 'existing-repo'),
    })

    const second = createRepoRow(db, {
      name: 'new-name',
      localPath: 'existing-repo',
      fullPath: path.join(reposRoot, 'existing-repo'),
    })

    expect(second.created).toBe(false)
    expect(second.repo.id).toBe(first.repo.id)
    expect(listRepos(db)).toHaveLength(1)
  })
})

describe('isDirectoryInUse', () => {
  let activeDirectories: string[]

  beforeEach(() => {
    activeDirectories = []
    vi.spyOn(sseAggregator, 'getActiveDirectories').mockImplementation(() => activeDirectories)
  })

  it('returns true when the active directory differs only by a trailing slash', () => {
    const active = path.join(workspace.path, 'demo')
    fs.mkdirSync(active, { recursive: true })
    activeDirectories = [`${active}${path.sep}`]

    expect(isDirectoryInUse(active)).toBe(true)
  })

  it('returns true when the active directory is a symlink to the queried directory', () => {
    const real = path.join(workspace.path, 'real')
    const link = path.join(workspace.path, 'link')
    fs.mkdirSync(real, { recursive: true })
    fs.symlinkSync(real, link)
    activeDirectories = [link]

    expect(isDirectoryInUse(real)).toBe(true)
  })

  it('returns false when no active directory matches', () => {
    activeDirectories = [path.join(workspace.path, 'other')]

    expect(isDirectoryInUse(path.join(workspace.path, 'demo'))).toBe(false)
  })
})

describe('isRepoInUse', () => {
  let db: Database
  let activeDirectories: string[]

  beforeEach(() => {
    db = createDatabase()
    activeDirectories = []
    vi.spyOn(sseAggregator, 'getActiveDirectories').mockImplementation(() => activeDirectories)
  })

  afterEach(() => {
    db.close()
  })

  it('returns false when repo does not exist in DB', () => {
    expect(isRepoInUse(db, 999)).toBe(false)
  })

  it('returns false when no active session matches repo fullPath', () => {
    const repo = seedRepo(db, { sourcePath: path.join(workspace.path, 'demo') })
    activeDirectories = [path.join(workspace.path, 'other')]

    expect(isRepoInUse(db, repo.id)).toBe(false)
  })

  it('returns true when active session matches repo fullPath', () => {
    const repoPath = path.join(workspace.path, 'demo')
    const repo = seedRepo(db, { sourcePath: repoPath })
    activeDirectories = [repoPath]

    expect(isRepoInUse(db, repo.id)).toBe(true)
  })
})

describe('extractPartsToStaging', () => {
  it('rejects zero-part commits before creating a staging directory', async () => {
    await expect(extractPartsToStaging('upload-id', 0, false)).rejects.toThrow('totalParts must be a positive integer')
    expect(fs.existsSync(path.join(getReposPath(), '.ocm-staging'))).toBe(false)
  })
})
