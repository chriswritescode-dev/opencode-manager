import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { ClientError } from '@opencode-manager/shared/opencode'
import { getRepoById, getRepoGitCredentialId, listRepos } from '../../src/db/queries'
import { SettingsService } from '../../src/services/settings'
import { createRepoRoutes } from '../../src/routes/repos'
import { createGitService } from '../../src/services/git/GitService'
import { ProjectConfigService } from '../../src/services/project-config'
import { RepoWorkspaceService } from '../../src/services/repo-workspace'
import { ScheduleService } from '../../src/services/schedules'
import { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'
import { SecretsService } from '../../src/services/secrets'
import { TerminalService } from '../../src/services/terminal'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createCommittedRepo, cloneOrigin, createGitAuthService, createOrigin, git } from '../helpers/git-fixtures'
import { readJson } from '../helpers/read-json'
import { createTestDatabase, seedRepo, seedSettings } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

const RepoSchema = z.looseObject({
  id: z.number(),
  localPath: z.string(),
  fullPath: z.string(),
  branch: z.string().nullable().optional(),
  cloneStatus: z.string(),
  gitCredentialId: z.string().optional(),
  currentBranch: z.string().nullable().optional(),
})

const ErrorSchema = z.object({ error: z.string() })

const AssistantFileSchema = z.object({ path: z.string(), exists: z.boolean(), created: z.boolean() })

const AssistantStatusSchema = z.looseObject({
  repoId: z.number(),
  directory: z.string(),
  relativePath: z.string(),
  files: z.object({ agentsMd: AssistantFileSchema, opencodeJson: AssistantFileSchema }),
})

const DiscoverySchema = z.object({
  repos: z.array(z.looseObject({ localPath: z.string() })),
  discoveredCount: z.number(),
  existingCount: z.number(),
  errors: z.array(z.string()),
})

const WorktreeSetupSchema = z.union([
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('started'), repoCommandsSkipped: z.boolean() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
])

const WorkspaceSchema = z.object({ directory: z.string(), worktreeSetup: WorktreeSetupSchema })

const jsonHeaders = { 'Content-Type': 'application/json' }

type StubClient = ReturnType<typeof createStubOpenCodeClient>

describe('repo routes', () => {
  let workspace: TempWorkspace
  let db: Database
  let originPath: string
  let workPath: string
  let repoPath: string
  let repo: ReturnType<typeof seedRepo>

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-repo-routes-')
    db = createTestDatabase()
    originPath = path.join(workspace.path, 'origin.git')
    workPath = path.join(workspace.path, 'work')
    createOrigin(originPath, workPath)
    repoPath = path.join(workspace.path, 'repos', 'repo')
    cloneOrigin(originPath, repoPath)
    repo = seedRepo(db, { localPath: 'repo', sourcePath: repoPath, repoUrl: originPath, isLocal: false })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  function createApp(client: StubClient = createStubOpenCodeClient()): Hono {
    const gitAuthService = createGitAuthService()
    const terminalService = new TerminalService(
      { client, baseUrl: () => 'http://127.0.0.1:5551', includeLocalEnv: false },
      new CredentialProvider(db),
      createStubRepoEnvService(),
    )
    const projectConfigService = new ProjectConfigService(db, createGitService(gitAuthService), gitAuthService)
    const scheduleService = new ScheduleService(db, client, new ScheduleWorktreeManager(gitAuthService, db))
    const repoWorkspaces = new RepoWorkspaceService(
      db,
      client,
      gitAuthService,
      projectConfigService,
      terminalService,
      scheduleService,
    )
    const app = new Hono()
    app.route('/', createRepoRoutes(
      db,
      gitAuthService,
      scheduleService,
      client,
      terminalService,
      projectConfigService,
      repoWorkspaces,
      new SecretsService(db),
    ))
    return app
  }

  describe('POST /:id/access', () => {
    it('records the access time for an existing repo', async () => {
      const app = createApp()
      const before = getRepoById(db, repo.id)?.lastAccessedAt ?? 0

      const res = await app.request(`/${repo.id}/access`, { method: 'POST' })
      const body = await readJson(res, z.object({ success: z.boolean() }))

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(getRepoById(db, repo.id)?.lastAccessedAt).toBeGreaterThanOrEqual(before)
    })

    it('returns 404 for an unknown repo', async () => {
      const res = await createApp().request('/999/access', { method: 'POST' })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(404)
      expect(body.error).toBe('Repo not found')
    })
  })

  describe('GET /:id/assistant-mode', () => {
    it('reports the assistant workspace status for the assistant repo', async () => {
      const res = await createApp().request('/0/assistant-mode')
      const body = await readJson(res, AssistantStatusSchema)

      expect(res.status).toBe(200)
      expect(body.repoId).toBe(0)
      expect(body.relativePath).toBe('repos/assistant')
      expect(body.files.agentsMd).toBeDefined()
    })

    it('reports the assistant workspace status for a repository', async () => {
      const res = await createApp().request(`/${repo.id}/assistant-mode`)
      const body = await readJson(res, AssistantStatusSchema)

      expect(res.status).toBe(200)
      expect(body.repoId).toBe(repo.id)
    })
  })

  describe('POST /:id/assistant-mode', () => {
    it('creates the assistant workspace files', async () => {
      const res = await createApp().request('/0/assistant-mode', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ overwriteAgentsMd: true }),
      })
      const body = await readJson(res, AssistantStatusSchema)

      expect(res.status).toBe(200)
      expect(body.repoId).toBe(0)
      expect(body.files.agentsMd.exists).toBe(true)
      expect(body.files.opencodeJson.exists).toBe(true)
      expect(existsSync(body.files.agentsMd.path)).toBe(true)
    })

    it('returns 500 when the assistant directory cannot be created', async () => {
      const assistantDirectory = path.join(workspace.path, 'repos', 'assistant')
      mkdirSync(path.dirname(assistantDirectory), { recursive: true })
      writeFileSync(assistantDirectory, 'not a directory')

      const res = await createApp().request('/0/assistant-mode', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(500)
      expect(body.error).not.toBe('')
    })
  })

  describe('POST /:id/reset-permissions', () => {
    it('removes every saved permission of the repo project', async () => {
      const savedRemove = vi.fn(async () => undefined)
      const client = createStubOpenCodeClient({
        api: {
          location: {
            get: vi.fn(async () => ({
              directory: repoPath,
              project: { id: 'project-A', directory: repoPath, canonical: repoPath },
            })),
          },
          permission: {
            saved: {
              list: vi.fn(async () => [
                { id: 'perm-1', projectID: 'project-A', action: 'bash', resource: '*', time: { created: 1, updated: 1 } },
                { id: 'perm-2', projectID: 'project-A', action: 'edit', resource: '*', time: { created: 2, updated: 2 } },
              ]),
              update: vi.fn(async () => ({
                id: 'perm-updated',
                projectID: 'project-A',
                action: 'bash',
                resource: '*',
                time: { created: 1, updated: 1 },
              })),
              remove: savedRemove,
            },
          },
        },
      })

      const res = await createApp(client).request(`/${repo.id}/reset-permissions`, { method: 'POST' })
      const body = await readJson(res, z.object({ removed: z.number() }))

      expect(res.status).toBe(200)
      expect(body.removed).toBe(2)
      expect(savedRemove).toHaveBeenCalledWith({ id: 'perm-1' })
      expect(savedRemove).toHaveBeenCalledWith({ id: 'perm-2' })
    })

    it('returns 404 for an unknown repo', async () => {
      const res = await createApp().request('/999/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('returns 502 when the OpenCode API call fails', async () => {
      const client = createStubOpenCodeClient({
        api: { location: { get: vi.fn(async () => { throw new ClientError('Transport') }) } },
      })

      const res = await createApp(client).request(`/${repo.id}/reset-permissions`, { method: 'POST' })
      const body = await readJson(res, z.object({ error: z.string(), code: z.string() }))

      expect(res.status).toBe(502)
      expect(body).toEqual({ error: 'Failed to reset permissions', code: 'ClientError' })
    })

    it('returns 500 when listing the saved permissions fails', async () => {
      const client = createStubOpenCodeClient({
        api: {
          location: {
            get: vi.fn(async () => ({
              directory: repoPath,
              project: { id: 'project-A', directory: repoPath, canonical: repoPath },
            })),
          },
          permission: {
            saved: {
              list: vi.fn(async () => {
                throw new Error('list failed')
              }),
              update: vi.fn(async () => ({
                id: 'perm-updated',
                projectID: 'project-A',
                action: 'bash',
                resource: '*',
                time: { created: 1, updated: 1 },
              })),
              remove: vi.fn(async () => undefined),
            },
          },
        },
      })

      const res = await createApp(client).request(`/${repo.id}/reset-permissions`, { method: 'POST' })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(500)
      expect(body.error).toBe('Failed to reset permissions')
    })
  })

  describe('POST /', () => {
    it('returns 400 when neither repoUrl nor localPath is provided', async () => {
      const res = await createApp().request('/', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(400)
      expect(body.error).toBe('Either repoUrl or localPath is required')
    })

    it('registers an existing local repository', async () => {
      const localPath = path.join(workspace.path, 'local-project')
      createCommittedRepo(localPath)

      const res = await createApp().request('/', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ localPath }),
      })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.localPath).toBe('local-project')
      expect(listRepos(db).map((entry) => entry.localPath)).toContain('local-project')
    })

    it('clones a remote repository', async () => {
      const otherOrigin = path.join(workspace.path, 'other-origin.git')
      createOrigin(otherOrigin, path.join(workspace.path, 'other-work'))

      const res = await createApp().request('/', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ repoUrl: otherOrigin, directoryName: 'cloned' }),
      })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.localPath).toBe('cloned')
      expect(existsSync(path.join(workspace.path, 'repos', 'cloned', '.git'))).toBe(true)
    })

    it('returns 500 when the repository cannot be created', async () => {
      const blocker = path.join(workspace.path, 'repos', 'blocker')
      mkdirSync(path.dirname(blocker), { recursive: true })
      writeFileSync(blocker, 'not a directory')

      const res = await createApp().request('/', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ localPath: 'blocker/child' }),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(500)
      expect(body.error).not.toBe('')
    })

    it('returns the client status for a user-input clone failure', async () => {
      const res = await createApp().request('/', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ repoUrl: path.join(workspace.path, 'missing-origin.git') }),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(400)
      expect(body.error).not.toBe('')
    })
  })

  describe('POST /discover', () => {
    it('returns 400 for an invalid body', async () => {
      const res = await createApp().request('/discover', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ rootPath: '' }),
      })

      expect(res.status).toBe(400)
    })

    it('returns the discovered repositories', async () => {
      const discoveryRoot = path.join(workspace.path, 'discovery')
      createCommittedRepo(path.join(discoveryRoot, 'sample-repo'))

      const res = await createApp().request('/discover', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ rootPath: discoveryRoot, maxDepth: 2 }),
      })
      const body = await readJson(res, DiscoverySchema)

      expect(res.status).toBe(200)
      expect(body.discoveredCount).toBe(1)
      expect(body.repos[0]?.localPath).toBe('sample-repo')
    })

    it('returns 400 when the discovery root does not exist', async () => {
      const missingRoot = path.join(workspace.path, 'missing-root')

      const res = await createApp().request('/discover', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ rootPath: missingRoot }),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(400)
      expect(body.error).not.toBe('')
    })
  })

  describe('GET /', () => {
    it('returns the repos with their current branch', async () => {
      const res = await createApp().request('/', { method: 'GET' })
      const body = await readJson(res, z.array(RepoSchema))

      expect(res.status).toBe(200)
      const listed = body.find((entry) => entry.id === repo.id)
      expect(listed?.currentBranch).toBe('main')
      expect(listed?.gitCredentialId).toBeUndefined()
    })
  })

  describe('PUT /order', () => {
    it('returns 400 when the order is not an array of numbers', async () => {
      const res = await createApp().request('/order', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ order: ['a', 'b'] }),
      })

      expect(res.status).toBe(400)
    })

    it('stores the requested repo order', async () => {
      const res = await createApp().request('/order', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ order: [repo.id] }),
      })
      const body = await readJson(res, z.object({ success: z.boolean() }))

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(new SettingsService(db).getSettings().preferences.repoOrder).toEqual([repo.id])
    })

    it('returns 500 when the body is not valid JSON', async () => {
      const res = await createApp().request('/order', {
        method: 'PUT',
        headers: jsonHeaders,
        body: 'not-json',
      })

      expect(res.status).toBe(500)
    })
  })

  describe('GET /:id', () => {
    it('returns the repo with its current branch', async () => {
      const res = await createApp().request(`/${repo.id}`, { method: 'GET' })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.id).toBe(repo.id)
      expect(body.currentBranch).toBe('main')
    })

    it('returns 404 when the repo does not exist', async () => {
      const res = await createApp().request('/999', { method: 'GET' })

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /:id/git-credential', () => {
    it('returns 404 when the repo does not exist', async () => {
      const res = await createApp().request('/999/git-credential', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 when the credential is not in settings', async () => {
      const res = await createApp().request(`/${repo.id}/git-credential`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(400)
      expect(body.error).toBe('Credential not found')
      expect(getRepoGitCredentialId(db, repo.id)).toBeNull()
    })

    it('sets the credential and returns the updated repo', async () => {
      seedSettings(db, {
        gitCredentials: [{ id: 'cred-1', name: 'test', host: 'github.com', type: 'pat', token: 'token-1' }],
      })

      const res = await createApp().request(`/${repo.id}/git-credential`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.gitCredentialId).toBe('cred-1')
      expect(getRepoGitCredentialId(db, repo.id)).toBe('cred-1')
    })

    it('clears the credential when none is provided', async () => {
      seedSettings(db, {
        gitCredentials: [{ id: 'cred-1', name: 'test', host: 'github.com', type: 'pat', token: 'token-1' }],
      })
      await createApp().request(`/${repo.id}/git-credential`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      const res = await createApp().request(`/${repo.id}/git-credential`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ credentialId: '' }),
      })

      expect(res.status).toBe(200)
      expect(getRepoGitCredentialId(db, repo.id)).toBeNull()
    })
  })

  describe('DELETE /:id', () => {
    it('returns 403 for the assistant repo id', async () => {
      const res = await createApp().request('/0', { method: 'DELETE' })

      expect(res.status).toBe(403)
    })

    it('returns 404 when the repo does not exist', async () => {
      const res = await createApp().request('/999', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })

    it('removes the checkout and the repo row', async () => {
      const res = await createApp().request(`/${repo.id}`, { method: 'DELETE' })
      const body = await readJson(res, z.object({ success: z.boolean() }))

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(existsSync(repoPath)).toBe(false)
      expect(getRepoById(db, repo.id)).toBeNull()
    })

    it('still deletes the repo when terminal cleanup fails', async () => {
      const client = createStubOpenCodeClient({ api: { pty: { list: vi.fn(async () => { throw new Error('pty cleanup failed') }) } } })

      const res = await createApp(client).request(`/${repo.id}`, { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(getRepoById(db, repo.id)).toBeNull()
    })
  })

  describe('POST /:id/pull', () => {
    it('pulls a commit pushed to the origin', async () => {
      git(['commit', '--allow-empty', '-m', 'Remote change'], workPath)
      git(['push', 'origin', 'main'], workPath)

      const res = await createApp().request(`/${repo.id}/pull`, { method: 'POST' })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.id).toBe(repo.id)
      expect(git(['log', '-1', '--format=%s'], repoPath)).toBe('Remote change')
    })

    it('returns 500 when the origin is unreachable', async () => {
      rmSync(originPath, { recursive: true, force: true })

      const res = await createApp().request(`/${repo.id}/pull`, { method: 'POST' })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(500)
      expect(body.error).not.toBe('')
    })
  })

  describe('POST /:id/branch/switch', () => {
    it('returns 404 when the repo does not exist', async () => {
      const res = await createApp().request('/999/branch/switch', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 when the branch is missing', async () => {
      const res = await createApp().request(`/${repo.id}/branch/switch`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('switches to an existing branch', async () => {
      git(['branch', 'feature'], repoPath)

      const res = await createApp().request(`/${repo.id}/branch/switch`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ branch: 'feature' }),
      })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.currentBranch).toBe('feature')
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('feature')
    })
  })

  describe('POST /:id/branch/create', () => {
    it('returns 404 when the repo does not exist', async () => {
      const res = await createApp().request('/999/branch/create', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 when the branch is missing', async () => {
      const res = await createApp().request(`/${repo.id}/branch/create`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('creates and checks out the branch', async () => {
      const res = await createApp().request(`/${repo.id}/branch/create`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ branch: 'feature' }),
      })
      const body = await readJson(res, RepoSchema)

      expect(res.status).toBe(200)
      expect(body.currentBranch).toBe('feature')
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('feature')
    })

    it('returns 400 for an invalid branch name', async () => {
      const res = await createApp().request(`/${repo.id}/branch/create`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ branch: 'bad name..x' }),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(400)
      expect(body.error).not.toBe('')
    })
  })

  describe('POST /:id/workspaces', () => {
    function createWorktreeClient(directory: string): StubClient {
      return createStubOpenCodeClient({ api: { worktree: { create: vi.fn(async () => ({ directory })) } } })
    }

    it('creates the workspace and reports no worktree setup', async () => {
      const worktreeDirectory = path.join(workspace.path, 'repos', 'repo-worktree')
      const res = await createApp(createWorktreeClient(worktreeDirectory)).request(`/${repo.id}/workspaces`, { method: 'POST' })
      const body = await readJson(res, WorkspaceSchema)

      expect(res.status).toBe(200)
      expect(body.directory).toBe(worktreeDirectory)
      expect(body.worktreeSetup).toEqual({ status: 'none' })
    })

    it('passes the requested worktree name to OpenCode', async () => {
      const create = vi.fn(async () => ({ directory: path.join(workspace.path, 'repos', 'feature-login') }))
      const client = createStubOpenCodeClient({ api: { worktree: { create } } })

      const res = await createApp(client).request(`/${repo.id}/workspaces`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: ' feature-login ' }),
      })

      expect(res.status).toBe(200)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'feature-login' }))
    })

    it('rejects a worktree name that is not a single folder name', async () => {
      const res = await createApp().request(`/${repo.id}/workspaces`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: '../escape' }),
      })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(400)
      expect(body.error).toBe('Directory name cannot contain dot-dot path segments')
    })

    it('reports a failed worktree setup when the setup terminal cannot start', async () => {
      const worktreeDirectory = path.join(workspace.path, 'repos', 'repo-setup-worktree')
      const projectConfigService = new ProjectConfigService(db, createGitService(createGitAuthService()), createGitAuthService())
      projectConfigService.setPersonalSetup(repo, ['pnpm install'])
      const client = createStubOpenCodeClient({
        api: {
          worktree: { create: vi.fn(async () => ({ directory: worktreeDirectory })) },
          pty: { create: vi.fn(async () => { throw new Error('spawn failed') }) },
        },
      })

      const res = await createApp(client).request(`/${repo.id}/workspaces`, { method: 'POST' })
      const body = await readJson(res, WorkspaceSchema)

      expect(res.status).toBe(200)
      expect(body.worktreeSetup).toEqual({ status: 'failed', error: 'spawn failed' })
    })

    it('skips repo commands when the worktree repo file is not trusted', async () => {
      const worktreeDirectory = path.join(workspace.path, 'repos', 'repo-untrusted-worktree')
      mkdirSync(path.join(worktreeDirectory, '.ocm'), { recursive: true })
      writeFileSync(
        path.join(worktreeDirectory, '.ocm', 'project.json'),
        JSON.stringify({ version: 1, setupWorktree: ['pnpm repo-setup'] }),
      )
      const projectConfigService = new ProjectConfigService(db, createGitService(createGitAuthService()), createGitAuthService())
      projectConfigService.setPersonalSetup(repo, ['pnpm install'])
      const client = createStubOpenCodeClient({
        api: {
          worktree: { create: vi.fn(async () => ({ directory: worktreeDirectory })) },
          pty: {
            create: vi.fn(async () => ({
              location: { directory: worktreeDirectory },
              data: { id: 'pty-setup', title: 'Worktree setup', command: '/bin/sh', args: [], cwd: worktreeDirectory, status: 'running' as const, pid: 1 },
            })),
          },
        },
      })

      const res = await createApp(client).request(`/${repo.id}/workspaces`, { method: 'POST' })
      const body = await readJson(res, WorkspaceSchema)

      expect(res.status).toBe(200)
      expect(body.worktreeSetup).toMatchObject({ status: 'started', repoCommandsSkipped: true })
    })
  })

  describe('GET /:id/download', () => {
    it('streams a zip archive of the repository', async () => {
      const res = await createApp().request(`/${repo.id}/download?includeGit=true&includePaths=src,docs`)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/zip')
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="repo.zip"')
      const body = Buffer.from(await res.arrayBuffer())
      expect(body.length).toBeGreaterThan(0)
      expect(res.headers.get('Content-Length')).toBe(String(body.length))
    })

    it('returns 404 when the repo does not exist', async () => {
      const res = await createApp().request('/999/download', { method: 'GET' })

      expect(res.status).toBe(404)
    })

    it('returns 500 when the archive cannot be created', async () => {
      const missingPath = path.join(workspace.path, 'repos', 'gone')
      const missing = seedRepo(db, { localPath: 'gone', sourcePath: missingPath, isLocal: false })

      const res = await createApp().request(`/${missing.id}/download`, { method: 'GET' })
      const body = await readJson(res, ErrorSchema)

      expect(res.status).toBe(500)
      expect(body.error).not.toBe('')
    })
  })
})
