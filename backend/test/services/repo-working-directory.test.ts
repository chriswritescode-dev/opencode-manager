import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { findSiblingByDirectory, getSiblingRepos, resolveRepoWorkingDirectory } from '../../src/services/repo'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { createCommittedRepo, git } from '../helpers/git-fixtures'

function makeRepo(fullPath: string): Repo {
  return {
    id: 1,
    localPath: path.basename(fullPath),
    fullPath,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
    isLocal: true,
  }
}

describe('resolveRepoWorkingDirectory', () => {
  let root: string
  let repoPath: string
  let siblingPath: string
  let unrelatedPath: string
  let repoLinkPath: string
  let siblingLinkPath: string

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-repo-working-directory-'))
    repoPath = path.join(root, 'repo')
    siblingPath = path.join(root, 'sibling')
    unrelatedPath = path.join(root, 'unrelated')
    repoLinkPath = path.join(root, 'repo-link')
    siblingLinkPath = path.join(root, 'sibling-link')

    fs.mkdirSync(repoPath)
    fs.mkdirSync(siblingPath)
    fs.mkdirSync(unrelatedPath)
    fs.symlinkSync(repoPath, repoLinkPath, 'dir')
    fs.symlinkSync(siblingPath, siblingLinkPath, 'dir')
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('returns the repo path when no directory is given', async () => {
    expect(await resolveRepoWorkingDirectory(makeRepo(repoPath), undefined, async () => [])).toBe(repoPath)
  })

  it('returns the repo path for the repo directory itself', async () => {
    expect(await resolveRepoWorkingDirectory(makeRepo(repoPath), repoPath, async () => [])).toBe(repoPath)
  })

  it('returns the repo path for a symlinked equivalent of the repo directory', async () => {
    expect(await resolveRepoWorkingDirectory(makeRepo(repoPath), repoLinkPath, async () => [])).toBe(repoPath)
  })

  it('returns a matching sibling path', async () => {
    const siblings = [{ fullPath: siblingPath }]
    expect(await resolveRepoWorkingDirectory(makeRepo(repoPath), siblingPath, async () => siblings)).toBe(siblingPath)
  })

  it('matches a sibling through a symlinked directory', async () => {
    const siblings = [{ fullPath: siblingPath }]
    expect(await resolveRepoWorkingDirectory(makeRepo(repoPath), siblingLinkPath, async () => siblings)).toBe(siblingPath)
  })

  it('returns null for an unrelated directory', async () => {
    const siblings = [{ fullPath: siblingPath }]
    expect(await resolveRepoWorkingDirectory(makeRepo(repoPath), unrelatedPath, async () => siblings)).toBeNull()
  })
})

describe('findSiblingByDirectory', () => {
  let root: string
  let siblingPath: string
  let siblingLinkPath: string

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-find-sibling-'))
    siblingPath = path.join(root, 'sibling')
    siblingLinkPath = path.join(root, 'sibling-link')
    fs.mkdirSync(siblingPath)
    fs.symlinkSync(siblingPath, siblingLinkPath, 'dir')
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('returns the sibling whose canonical path matches', () => {
    const sibling = { fullPath: siblingPath, id: 1 }
    expect(findSiblingByDirectory([sibling], siblingPath)).toBe(sibling)
  })

  it('matches through a symlinked directory', () => {
    const sibling = { fullPath: siblingPath, id: 1 }
    expect(findSiblingByDirectory([sibling], siblingLinkPath)).toBe(sibling)
  })

  it('returns undefined when no sibling matches', () => {
    const sibling = { fullPath: siblingPath, id: 1 }
    expect(findSiblingByDirectory([sibling], path.join(root, 'missing'))).toBeUndefined()
  })
})

describe('getSiblingRepos branch resolution', () => {
  let workspace: TempWorkspace
  let db: Database
  let repoPath: string
  let repo: Repo

  beforeAll(() => {
    workspace = createTempWorkspace('ocm-sibling-branch-')
    repoPath = path.join(workspace.path, 'repo-a')
    createCommittedRepo(repoPath)
  })

  beforeEach(() => {
    db = createTestDatabase()
    repo = seedRepo(db, { sourcePath: repoPath, localPath: 'repo-a' })
  })

  afterEach(() => {
    db.close()
  })

  afterAll(() => {
    workspace.restore()
  })

  it('skips branch resolution when includeBranch is false', async () => {
    const siblings = await getSiblingRepos(db, repo.id, {}, undefined, { includeBranch: false })

    expect(siblings).toHaveLength(1)
    expect(siblings[0]?.currentBranch).toBeUndefined()
  })

  it('resolves the branch when includeBranch is true', async () => {
    git(['checkout', '-B', 'feature-branch'], repoPath)

    const siblings = await getSiblingRepos(db, repo.id, {})

    expect(siblings).toHaveLength(1)
    expect(siblings[0]?.currentBranch).toBe('feature-branch')
  })
})
