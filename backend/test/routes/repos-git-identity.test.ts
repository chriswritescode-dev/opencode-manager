import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { getOpenCodeConfigHome } from '@opencode-manager/shared/config/env'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { SettingsService } from '../../src/services/settings'
import { createRepoRoutes } from '../../src/routes/repos'
import { createWorktreeSafely } from '../../src/services/repo'
import { syncManagerGitIdentityConfig } from '../../src/services/git-identity'
import { createGitAuthService, cloneOrigin, createOrigin, git, uniqueName } from '../helpers/git-fixtures'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'repos-git-identity-'))
const homeDir = path.join(workspaceRoot, 'home')
process.env.WORKSPACE_PATH = workspaceRoot
process.env.GIT_CONFIG_NOSYSTEM = '1'
delete process.env.GIT_CONFIG_GLOBAL
process.env.HOME = homeDir
process.env.XDG_CONFIG_HOME = getOpenCodeConfigHome()
mkdirSync(homeDir, { recursive: true })

const reposPath = path.join(workspaceRoot, 'repos')

function readLocalConfig(repoPath: string, key: string): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, 'config', '--local', '--get', key], {
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    }).trim()
  } catch {
    return null
  }
}

describe('repo git identity routes', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    rmSync(reposPath, { recursive: true, force: true })
    mkdirSync(reposPath, { recursive: true })
    const scheduleService = { prepareRepoDelete: () => {} } as unknown as Parameters<typeof createRepoRoutes>[2]
    app = new Hono()
    app.route('/repos', createRepoRoutes(db, createGitAuthService(), scheduleService, createStubOpenCodeClient()))
  })

  afterEach(() => {
    db.close()
  })

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  function setupClone(prefix: string): { repoId: number; repoPath: string; origin: string } {
    const origin = path.join(workspaceRoot, uniqueName(`${prefix}-origin.git`))
    const work = path.join(workspaceRoot, uniqueName(`${prefix}-work`))
    createOrigin(origin, work)
    const repoPath = path.join(reposPath, uniqueName(`${prefix}-clone`))
    cloneOrigin(origin, repoPath)
    const repo = createRepo(db, {
      repoUrl: origin,
      localPath: path.basename(repoPath),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
    return { repoId: repo.id, repoPath, origin }
  }

  async function commitViaRoute(repoId: number, message: string): Promise<Response> {
    return app.request(`/repos/${repoId}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
  }

  it('writes local config from a preset and a commit records that author', async () => {
    const { repoId, repoPath } = setupClone('identity-commit')
    new SettingsService(db).updateSettings({
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
    })

    const patch = await app.request(`/repos/${repoId}/git-identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: 'work' }),
    })

    expect(patch.status).toBe(200)
    expect(await patch.json()).toEqual({
      name: 'Work User',
      email: 'work@example.com',
      scope: 'repository',
      presetId: 'work',
    })
    expect(readLocalConfig(repoPath, 'user.name')).toBe('Work User')
    expect(readLocalConfig(repoPath, 'user.email')).toBe('work@example.com')

    writeFileSync(path.join(repoPath, 'file.txt'), 'hello\n')
    git(['add', 'file.txt'], repoPath)

    const res = await commitViaRoute(repoId, 'identity commit')

    expect(res.status).toBe(200)
    expect(git(['log', '-1', '--format=%an <%ae>'], repoPath)).toBe('Work User <work@example.com>')
  })

  it('commits with the same identity in a linked worktree', async () => {
    const { repoId, repoPath } = setupClone('identity-worktree')
    new SettingsService(db).updateSettings({
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
    })
    await app.request(`/repos/${repoId}/git-identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: 'work' }),
    })

    const worktreePath = path.join(reposPath, uniqueName('identity-worktree-feature'))
    await createWorktreeSafely(repoPath, worktreePath, 'feature', {}, 'main')
    writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], worktreePath)
    git(['commit', '-m', 'worktree commit'], worktreePath)

    expect(git(['log', '-1', '--format=%an <%ae>'], worktreePath)).toBe('Work User <work@example.com>')
  })

  it('applies the Manager default identity to a commit when the repo has no local identity', async () => {
    const { repoId, repoPath } = setupClone('identity-default')
    new SettingsService(db).updateSettings({ gitIdentity: { name: 'Manager User', email: 'manager@example.com' } })
    await syncManagerGitIdentityConfig(db)

    git(['config', '--local', '--unset', 'user.name'], repoPath)
    git(['config', '--local', '--unset', 'user.email'], repoPath)

    writeFileSync(path.join(repoPath, 'file.txt'), 'hello\n')
    git(['add', 'file.txt'], repoPath)

    const res = await commitViaRoute(repoId, 'default identity commit')

    expect(res.status).toBe(200)
    expect(git(['log', '-1', '--format=%an <%ae>'], repoPath)).toBe('Manager User <manager@example.com>')
  })

  it('removes the local keys when the identity is unset', async () => {
    const { repoId, repoPath } = setupClone('identity-unset')
    new SettingsService(db).updateSettings({
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
    })
    await app.request(`/repos/${repoId}/git-identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: 'work' }),
    })

    const res = await app.request(`/repos/${repoId}/git-identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: null }),
    })

    expect(res.status).toBe(200)
    expect(readLocalConfig(repoPath, 'user.name')).toBeNull()
    expect(readLocalConfig(repoPath, 'user.email')).toBeNull()
  })

  it('returns the effective identity from GET', async () => {
    const { repoId } = setupClone('identity-get')
    new SettingsService(db).updateSettings({
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
    })
    await app.request(`/repos/${repoId}/git-identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: 'work' }),
    })

    const res = await app.request(`/repos/${repoId}/git-identity`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: 'Work User',
      email: 'work@example.com',
      scope: 'repository',
      presetId: 'work',
    })
  })

  it('returns 400 for an unknown identity id', async () => {
    const { repoId } = setupClone('identity-unknown')

    const res = await app.request(`/repos/${repoId}/git-identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: 'missing-identity' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Identity not found' })
  })

  it('returns 404 for a missing repo', async () => {
    const res = await app.request('/repos/9999/git-identity', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: 'work' }),
    })

    expect(res.status).toBe(404)
  })
})
