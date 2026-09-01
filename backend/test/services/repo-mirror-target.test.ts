import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { rm } from 'fs/promises'
import type { Database } from 'bun:sqlite'
import type { Repo } from '../../src/types/repo'

let tmpRoot: string
vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    getReposPath: () => tmpRoot,
    getWorkspacePath: vi.fn(() => '/tmp/fake-workspace'),
  }
})

describe('mirror target resolution', () => {
  let db: Database
  let base: Repo
  let baseRepoPath: string

  beforeAll(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'repo-mirror-target-'))
    baseRepoPath = path.join(tmpRoot, 'my-app')
    execSync(`git init -b main "${baseRepoPath}"`)
    execSync(`git -C "${baseRepoPath}" config user.email test@test.com`)
    execSync(`git -C "${baseRepoPath}" config user.name Test`)
    execSync(`git -C "${baseRepoPath}" commit --allow-empty -m "Initial commit"`)

    const { createTestDb } = await import('../helpers/assistant-workspace')
    const { createRepo } = await import('../../src/db/queries')
    db = createTestDb()
    base = createRepo(db, { isLocal: true, localPath: 'my-app', branch: 'main', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now() })
  })

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('targets the repo in place when its checked-out branch matches', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    const plan = await planMirrorTarget(db, base, 'main')
    expect(plan.kind).toBe('in-place')
    expect(plan.currentBranch).toBe('main')
  })

  it('plans a new sibling worktree when the checked-out branch differs', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    const plan = await planMirrorTarget(db, base, 'feature/x')
    expect(plan).toMatchObject({ kind: 'new', localPath: 'my-app-feature-x', fullPath: path.join(tmpRoot, 'my-app-feature-x'), currentBranch: 'main' })
  })

  it('creates the worktree, the branch, and a worktree repo row without touching the base checkout', async () => {
    const { ensureMirrorTarget, planMirrorTarget } = await import('../../src/services/repo')
    const { repo: target, created } = await ensureMirrorTarget(db, base, 'feature/x')

    expect(created).toBe(true)
    expect(target.id).not.toBe(base.id)
    expect(target.isWorktree).toBe(true)
    expect(target.branch).toBe('feature/x')
    expect(target.fullPath).toBe(path.join(tmpRoot, 'my-app-feature-x'))
    expect(existsSync(target.fullPath)).toBe(true)
    expect(execSync(`git -C "${target.fullPath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('feature/x')
    expect(execSync(`git -C "${baseRepoPath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('main')

    const again = await planMirrorTarget(db, base, 'feature/x')
    expect(again.kind).toBe('existing')
    if (again.kind === 'existing') expect(again.repo.id).toBe(target.id)

    const second = await ensureMirrorTarget(db, base, 'feature/x')
    expect(second.created).toBe(false)
    expect(second.repo.id).toBe(target.id)
  })

  it('resolves the base directory name when asked from a worktree repo row', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    const { getRepoByLocalPath } = await import('../../src/db/queries')
    const worktreeRepo = getRepoByLocalPath(db, 'my-app-feature-x')!
    const plan = await planMirrorTarget(db, worktreeRepo, 'other')
    expect(plan).toMatchObject({ kind: 'new', localPath: 'my-app-other' })
  })
})
