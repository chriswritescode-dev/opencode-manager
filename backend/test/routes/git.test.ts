import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { createRepoRoutes } from '../../src/routes/repos'
import { createGitService } from '../../src/services/git/GitService'
import { ScheduleService } from '../../src/services/schedules'
import { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'
import { TerminalService } from '../../src/services/terminal'
import { ProjectConfigService } from '../../src/services/project-config'
import { SecretsService } from '../../src/services/secrets'
import { RepoWorkspaceService } from '../../src/services/repo-workspace'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createCommittedRepo, createGitAuthService, createOrigin, cloneOrigin, git } from '../helpers/git-fixtures'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace } from '../helpers/test-env'
import type { TempWorkspace } from '../helpers/test-env'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { readJson } from '../helpers/read-json'

const ErrorResponseSchema = z.object({ error: z.string() })

const GitFileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'copied']),
  staged: z.boolean(),
  oldPath: z.string().optional(),
})

const GitStatusSchema = z.object({
  branch: z.string(),
  ahead: z.number(),
  behind: z.number(),
  files: z.array(GitFileStatusSchema),
  hasChanges: z.boolean(),
  operation: z.union([
    z.null(),
    z.object({ kind: z.string(), conflictedFiles: z.array(z.string()) }),
  ]),
})

const GitLogSchema = z.object({
  commits: z.array(z.object({
    hash: z.string(),
    authorName: z.string(),
    authorEmail: z.string(),
    date: z.string(),
    message: z.string(),
    unpushed: z.boolean().optional(),
  })),
})

const FileDiffSchema = z.object({
  path: z.string(),
  status: z.string(),
  diff: z.string(),
  additions: z.number(),
  deletions: z.number(),
  isBinary: z.boolean(),
  truncated: z.boolean().optional(),
})

type GitStatus = z.infer<typeof GitStatusSchema>

function fileStatus(status: GitStatus, filePath: string): z.infer<typeof GitFileStatusSchema> | undefined {
  return status.files.find((file) => file.path === filePath)
}

describe('git routes', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let repoPath: string
  let originPath: string
  let workPath: string
  let app: Hono

  function jsonHeaders() {
    return { 'Content-Type': 'application/json' }
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-git-routes-')
    db = createTestDatabase()
    originPath = path.join(workspace.path, 'origin.git')
    workPath = path.join(workspace.path, 'work')
    createOrigin(originPath, workPath)
    repoPath = path.join(workspace.path, 'git-test-repo')
    cloneOrigin(originPath, repoPath)
    repo = seedRepo(db, { localPath: 'git-test-repo', sourcePath: repoPath, isLocal: true })

    const gitAuthService = createGitAuthService()
    const openCodeClient = createStubOpenCodeClient()
    const gitService = createGitService(gitAuthService)
    const projectConfigService = new ProjectConfigService(db, gitService, gitAuthService)
    const terminalService = new TerminalService(
      { client: openCodeClient, baseUrl: () => 'http://127.0.0.1:5551', includeLocalEnv: false },
      new CredentialProvider(db),
      createStubRepoEnvService(),
    )
    const scheduleService = new ScheduleService(db, openCodeClient, new ScheduleWorktreeManager(gitAuthService, db))
    const repoWorkspaces = new RepoWorkspaceService(
      db,
      openCodeClient,
      gitAuthService,
      projectConfigService,
      terminalService,
      scheduleService,
    )
    app = new Hono()
    app.route('/repos', createRepoRoutes(
      db,
      gitAuthService,
      scheduleService,
      openCodeClient,
      terminalService,
      projectConfigService,
      repoWorkspaces,
      new SecretsService(db),
    ))
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('returns 404 for every git endpoint when the repo does not exist', async () => {
    const endpoints = [
      { method: 'GET', path: '/repos/999/git/status' },
      { method: 'GET', path: '/repos/999/git/log' },
      { method: 'GET', path: '/repos/999/git/diff?path=file.ts' },
      { method: 'POST', path: '/repos/999/git/fetch' },
      { method: 'POST', path: '/repos/999/git/pull' },
      { method: 'POST', path: '/repos/999/git/push' },
    ]

    for (const endpoint of endpoints) {
      const response = await app.request(endpoint.path, { method: endpoint.method })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(404)
      expect(body.error).toBe('Repo not found')
    }
  })

  it('reports a clean checkout on the cloned branch', async () => {
    const response = await app.request(`/repos/${repo.id}/git/status`)
    const body = await readJson(response, GitStatusSchema)

    expect(response.status).toBe(200)
    expect(body.branch).toBe('main')
    expect(body.hasChanges).toBe(false)
    expect(body.files).toEqual([])
  })

  it('stages and unstages a new file', async () => {
    writeFileSync(path.join(repoPath, 'notes.txt'), 'hello\n')

    const untrackedStatus = await readJson(
      await app.request(`/repos/${repo.id}/git/status`),
      GitStatusSchema,
    )
    expect(fileStatus(untrackedStatus, 'notes.txt')).toEqual({ path: 'notes.txt', status: 'untracked', staged: false })

    const stagedResponse = await app.request(`/repos/${repo.id}/git/stage`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ paths: ['notes.txt'] }),
    })
    const staged = await readJson(stagedResponse, GitStatusSchema)

    expect(stagedResponse.status).toBe(200)
    expect(fileStatus(staged, 'notes.txt')).toEqual({ path: 'notes.txt', status: 'added', staged: true })

    const unstagedResponse = await app.request(`/repos/${repo.id}/git/unstage`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ paths: ['notes.txt'] }),
    })
    const unstaged = await readJson(unstagedResponse, GitStatusSchema)

    expect(unstagedResponse.status).toBe(200)
    expect(fileStatus(unstaged, 'notes.txt')).toEqual({ path: 'notes.txt', status: 'untracked', staged: false })
  })

  it('commits staged paths and reports the commit in the log', async () => {
    writeFileSync(path.join(repoPath, 'notes.txt'), 'hello\n')
    await app.request(`/repos/${repo.id}/git/stage`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ paths: ['notes.txt'] }),
    })

    const commitResponse = await app.request(`/repos/${repo.id}/git/commit`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ message: 'Add notes' }),
    })
    const status = await readJson(commitResponse, GitStatusSchema)

    expect(commitResponse.status).toBe(200)
    expect(status.hasChanges).toBe(false)

    const log = await readJson(await app.request(`/repos/${repo.id}/git/log`), GitLogSchema)
    expect(log.commits[0]?.message).toBe('Add notes')
    expect(log.commits[0]?.unpushed).toBe(true)
  })

  it('applies the requested log limit and returns the newest commits first', async () => {
    git(['commit', '--allow-empty', '-m', 'second'], repoPath)
    git(['commit', '--allow-empty', '-m', 'third'], repoPath)

    const response = await app.request(`/repos/${repo.id}/git/log?limit=2`)
    const body = await readJson(response, GitLogSchema)

    expect(response.status).toBe(200)
    expect(body.commits.map((commit) => commit.message)).toEqual(['third', 'second'])
  })

  it('returns the working tree diff for a modified file', async () => {
    writeFileSync(path.join(repoPath, 'greeting.txt'), 'old line\n')
    git(['add', 'greeting.txt'], repoPath)
    git(['commit', '-m', 'add greeting'], repoPath)
    writeFileSync(path.join(repoPath, 'greeting.txt'), 'new line\n')

    const diffResponse = await app.request(`/repos/${repo.id}/git/diff?path=greeting.txt`)
    const diff = await readJson(diffResponse, z.string())

    expect(diffResponse.status).toBe(200)
    expect(diff).toContain('-old line')
    expect(diff).toContain('+new line')

    const fullDiffResponse = await app.request(`/repos/${repo.id}/git/diff-full?path=greeting.txt`)
    const fullDiff = await readJson(fullDiffResponse, FileDiffSchema)

    expect(fullDiffResponse.status).toBe(200)
    expect(fullDiff.status).toBe('modified')
    expect(fullDiff.additions).toBe(1)
    expect(fullDiff.deletions).toBe(1)
  })

  it('fetches from the origin', async () => {
    const response = await app.request(`/repos/${repo.id}/git/fetch`, { method: 'POST' })
    const body = await readJson(response, GitStatusSchema)

    expect(response.status).toBe(200)
    expect(body.branch).toBe('main')
  })

  it('pushes a new commit to the origin', async () => {
    writeFileSync(path.join(repoPath, 'notes.txt'), 'hello\n')
    await app.request(`/repos/${repo.id}/git/stage`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ paths: ['notes.txt'] }),
    })
    await app.request(`/repos/${repo.id}/git/commit`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ message: 'Pushed from the manager' }),
    })

    const response = await app.request(`/repos/${repo.id}/git/push`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)
    expect(git(['log', '--format=%s', '-1', 'main'], originPath)).toBe('Pushed from the manager')
  })

  it('pulls a commit pushed to the origin from another checkout', async () => {
    git(['commit', '--allow-empty', '-m', 'Remote change'], workPath)
    git(['push', 'origin', 'main'], workPath)

    const response = await app.request(`/repos/${repo.id}/git/pull`, { method: 'POST' })
    const status = await readJson(response, GitStatusSchema)

    expect(response.status).toBe(200)
    expect(status.branch).toBe('main')
    expect(git(['log', '--format=%s', '-1', 'main'], repoPath)).toBe('Remote change')
  })

  it('resets the branch to the requested commit', async () => {
    const baseHash = git(['rev-parse', 'HEAD'], repoPath)
    git(['commit', '--allow-empty', '-m', 'later'], repoPath)

    const response = await app.request(`/repos/${repo.id}/git/reset`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ commitHash: baseHash }),
    })
    const status = await readJson(response, GitStatusSchema)

    expect(response.status).toBe(200)
    expect(status.hasChanges).toBe(false)
    const log = await readJson(await app.request(`/repos/${repo.id}/git/log`), GitLogSchema)
    expect(log.commits.map((commit) => commit.message)).toEqual(['init'])
  })

  it.each([
    { label: 'commit without a message', path: 'commit', body: {}, error: 'message is required' },
    { label: 'stage with a non-array paths', path: 'stage', body: { paths: 'not-an-array' }, error: 'paths is required and must be an array' },
    { label: 'unstage without paths', path: 'unstage', body: {}, error: 'paths is required and must be an array' },
    { label: 'reset without a commit hash', path: 'reset', body: {}, error: 'commitHash is required' },
  ])('rejects $label', async ({ path: endpoint, body: requestBody, error }) => {
    const response = await app.request(`/repos/${repo.id}/git/${endpoint}`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(requestBody),
    })
    const body = await readJson(response, ErrorResponseSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe(error)
  })

  it('rejects a diff request without a path', async () => {
    const response = await app.request(`/repos/${repo.id}/git/diff`)
    const body = await readJson(response, ErrorResponseSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('path query parameter is required')
  })

  it('rejects an out-of-range discovery depth', async () => {
    const response = await app.request('/repos/discover', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ rootPath: '/tmp/projects', maxDepth: 99 }),
    })
    const body = await readJson(response, ErrorResponseSchema)

    expect(response.status).toBe(400)
    expect(body.error).not.toBe('')
  })

  it('discovers local repositories under the requested root', async () => {
    const localRepoPath = path.join(workspace.path, 'discovered', 'sample-repo')
    createCommittedRepo(localRepoPath)

    const response = await app.request('/repos/discover', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ rootPath: path.join(workspace.path, 'discovered'), maxDepth: 2 }),
    })
    const body = await readJson(response, z.object({
      discoveredCount: z.number(),
      existingCount: z.number(),
      repos: z.array(z.object({ localPath: z.string() })),
    }))

    expect(response.status).toBe(200)
    expect(body.discoveredCount).toBe(1)
    expect(body.repos[0]?.localPath).toBe('sample-repo')
  })
})
