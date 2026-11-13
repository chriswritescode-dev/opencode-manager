import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { GitStashEntrySchema } from '@opencode-manager/shared/schemas'
import { createRepoGitRoutes } from '../../src/routes/repo-git'
import { createGitService } from '../../src/services/git/GitService'
import { createStubOpenCodeClient, stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { createCommittedRepo, cloneOrigin, createGitAuthService, createOrigin, git } from '../helpers/git-fixtures'
import { readJson } from '../helpers/read-json'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import type { Repo } from '@opencode-manager/shared/types'

const GitFileStatusSchema = z.object({
  path: z.string(),
  status: z.string(),
  staged: z.boolean(),
  oldPath: z.string().optional(),
})

const GitStatusSchema = z.object({
  branch: z.string(),
  ahead: z.number(),
  behind: z.number(),
  files: z.array(GitFileStatusSchema),
  hasChanges: z.boolean(),
  operation: z.union([z.null(), z.object({ kind: z.string(), conflictedFiles: z.array(z.string()) })]),
})

const BranchSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'remote']),
  current: z.boolean(),
  upstream: z.string().optional(),
  ahead: z.number().optional(),
  behind: z.number().optional(),
  isWorktree: z.boolean().optional(),
})

const BranchesResponseSchema = z.object({
  branches: z.array(BranchSchema),
  status: z.object({ ahead: z.number(), behind: z.number() }),
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

const CommitDetailsSchema = z.object({
  hash: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  message: z.string(),
  files: z.array(z.object({ path: z.string(), status: z.string() })),
})

const StashesResponseSchema = z.object({ stashes: z.array(GitStashEntrySchema) })
const ErrorSchema = z.object({ error: z.string() })
const CodedErrorSchema = z.object({ code: z.string(), error: z.string() })
const BatchStatusSchema = z.record(z.string(), GitStatusSchema)

const jsonHeaders = { 'Content-Type': 'application/json' }

function createRepoApp(db: Database, repoPath: string, originPath: string, generateText = vi.fn()) {
  const client = createStubOpenCodeClient({
    api: {
      ...stubLoadedModelCatalog(),
      generate: { text: generateText },
    },
  })
  return createRepoGitRoutes(db, createGitService(createGitAuthService()), client, { commitMessageTimeoutMs: 50 })
}

describe('repo git routes', () => {
  let workspace: TempWorkspace
  let db: Database
  let originPath: string
  let workPath: string
  let repoPath: string
  let repo: Repo
  let app: Hono
  let generateText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-repo-git-routes-')
    db = createTestDatabase()
    originPath = path.join(workspace.path, 'origin.git')
    workPath = path.join(workspace.path, 'work')
    createOrigin(originPath, workPath, ['feature'])
    repoPath = path.join(workspace.path, 'repos', 'repo')
    cloneOrigin(originPath, repoPath)
    repo = seedRepo(db, { localPath: 'repo', sourcePath: repoPath, repoUrl: originPath, defaultBranch: 'main' })
    generateText = vi.fn(async () => ({ text: 'feat: generated message' }))
    app = createRepoApp(db, repoPath, originPath, generateText)
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  function writeTrackedFile(name: string, content: string): void {
    writeFileSync(path.join(repoPath, name), content)
    git(['add', name], repoPath)
    git(['commit', '-m', `update ${name}`], repoPath)
  }

  function commitFile(name: string, content: string, message: string): void {
    writeFileSync(path.join(repoPath, name), content)
    git(['add', name], repoPath)
    git(['commit', '-m', message], repoPath)
  }

  describe('POST /git-status-batch', () => {
    it.each([
      { label: 'not an array', repoIds: 'not-an-array' },
      { label: 'contains non-numbers', repoIds: [1, 'two', 3] },
    ])('returns 400 when repoIds is $label', async ({ repoIds }) => {
      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ repoIds }),
      })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('repoIds must be an array of numbers')
    })

    it('returns empty object when no repos are found', async () => {
      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ repoIds: [999] }),
      })
      const body = await readJson(response, BatchStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({})
    })

    it('returns the status of every known repo and skips unknown ids', async () => {
      const secondPath = path.join(workspace.path, 'repos', 'repo-two')
      cloneOrigin(originPath, secondPath)
      const second = seedRepo(db, { localPath: 'repo-two', sourcePath: secondPath, repoUrl: originPath })

      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ repoIds: [repo.id, second.id, 999] }),
      })
      const body = await readJson(response, BatchStatusSchema)

      expect(response.status).toBe(200)
      expect(Object.keys(body).sort()).toEqual([String(repo.id), String(second.id)].sort())
      expect(body[String(repo.id)]?.branch).toBe('main')
    })
  })

  describe('GET /:id/git/diff-full', () => {
    it('returns 400 when path parameter is missing', async () => {
      const response = await app.request(`/${repo.id}/git/diff-full`)
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('path query parameter is required')
    })

    it('includes staged changes only when includeStaged is true', async () => {
      writeTrackedFile('file.ts', 'old line\n')
      writeFileSync(path.join(repoPath, 'file.ts'), 'new line\n')
      git(['add', 'file.ts'], repoPath)

      const unstagedResponse = await app.request(`/${repo.id}/git/diff-full?path=file.ts`)
      const unstaged = await readJson(unstagedResponse, FileDiffSchema)
      expect(unstagedResponse.status).toBe(200)
      expect(unstaged.additions).toBe(0)
      expect(unstaged.deletions).toBe(0)

      const stagedResponse = await app.request(`/${repo.id}/git/diff-full?path=file.ts&includeStaged=true`)
      const staged = await readJson(stagedResponse, FileDiffSchema)
      expect(stagedResponse.status).toBe(200)
      expect(staged.status).toBe('modified')
      expect(staged.additions).toBe(1)
      expect(staged.deletions).toBe(1)
      expect(staged.diff).toContain('+new line')
      expect(staged.diff).toContain('-old line')
    })

    it('returns an empty diff when the checkout is not a git repository', async () => {
      const plainPath = path.join(workspace.path, 'repos', 'plain')
      mkdirSync(plainPath, { recursive: true })
      const plain = seedRepo(db, { localPath: 'plain', sourcePath: plainPath })

      const response = await app.request(`/${plain.id}/git/diff-full?path=file.ts`)
      const body = await readJson(response, FileDiffSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ path: 'file.ts', status: 'modified', diff: '', additions: 0, deletions: 0, isBinary: false })
    })
  })

  describe('GET /:id/git/branches', () => {
    it('returns the local branches and the branch status', async () => {
      git(['branch', 'feature-local'], repoPath)

      const response = await app.request(`/${repo.id}/git/branches`)
      const body = await readJson(response, BranchesResponseSchema)

      expect(response.status).toBe(200)
      expect(body.branches.filter((branch) => branch.type === 'local').map((branch) => branch.name).sort())
        .toEqual(['feature-local', 'main'])
      expect(body.branches.find((branch) => branch.current)?.name).toBe('main')
      expect(body.status).toEqual({ ahead: 0, behind: 0 })
    })

    it('returns 400 NOT_A_REPO when the checkout is not a git repository', async () => {
      const plainPath = path.join(workspace.path, 'repos', 'plain-branches')
      mkdirSync(plainPath, { recursive: true })
      const plain = seedRepo(db, { localPath: 'plain-branches', sourcePath: plainPath })

      const response = await app.request(`/${plain.id}/git/branches`)
      const body = await readJson(response, CodedErrorSchema)

      expect(response.status).toBe(400)
      expect(body.code).toBe('NOT_A_REPO')
    })
  })

  describe('POST /:id/git/discard', () => {
    it.each([
      { label: 'is not an array', body: { paths: 'not-an-array' } },
      { label: 'is missing', body: {} },
    ])('returns 400 when paths $label', async ({ body: requestBody }) => {
      const response = await app.request(`/${repo.id}/git/discard`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(requestBody),
      })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('paths is required and must be an array')
    })

    it('restores a modified file and removes an untracked file', async () => {
      writeTrackedFile('file.ts', 'committed\n')
      writeFileSync(path.join(repoPath, 'file.ts'), 'changed\n')
      writeFileSync(path.join(repoPath, 'untracked.txt'), 'scratch\n')

      const response = await app.request(`/${repo.id}/git/discard`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ paths: ['file.ts', 'untracked.txt'], staged: false }),
      })
      const body = await readJson(response, GitStatusSchema)

      expect(response.status).toBe(200)
      expect(body.hasChanges).toBe(false)
      expect(body.files).toEqual([])
    })

    it('returns 400 NOT_A_REPO when the checkout is not a git repository', async () => {
      const plainPath = path.join(workspace.path, 'repos', 'plain-discard')
      mkdirSync(plainPath, { recursive: true })
      const plain = seedRepo(db, { localPath: 'plain-discard', sourcePath: plainPath })

      const response = await app.request(`/${plain.id}/git/discard`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ paths: ['file1.ts'], staged: false }),
      })
      const body = await readJson(response, CodedErrorSchema)

      expect(response.status).toBe(400)
      expect(body.code).toBe('NOT_A_REPO')
    })
  })

  describe('POST /:id/git/commit-message', () => {
    it('returns 400 when there are no staged changes', async () => {
      const response = await app.request(`/${repo.id}/git/commit-message`, { method: 'POST' })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('No staged changes')
      expect(generateText).not.toHaveBeenCalled()
    })

    it('returns the normalized message with the staged diff in the prompt', async () => {
      mkdirSync(path.join(repoPath, 'src'), { recursive: true })
      writeTrackedFile('src/index.ts', 'before\n')
      commitFile('src/index.ts', 'after\n', 'feat: prior change')
      writeFileSync(path.join(repoPath, 'src/index.ts'), 'and more\n')
      git(['add', 'src/index.ts'], repoPath)
      generateText.mockResolvedValue({ text: '```\nfeat: add thing\n```' })

      const response = await app.request(`/${repo.id}/git/commit-message`, { method: 'POST' })
      const body = await readJson(response, z.object({ message: z.string() }))

      expect(response.status).toBe(200)
      expect(body.message).toBe('feat: add thing')
      const prompt = generateText.mock.calls[0]?.[0]
      expect(prompt).toMatchObject({ prompt: expect.stringContaining('src/index.ts') })
    })

    it.each([
      { label: 'empty text', text: '   ' },
      { label: 'labeled empty fence', text: 'Commit message:\n```\n```' },
    ])('returns 502 when the model returns $label', async ({ text }) => {
      writeFileSync(path.join(repoPath, 'file.ts'), 'staged\n')
      git(['add', 'file.ts'], repoPath)
      generateText.mockResolvedValue({ text })

      const response = await app.request(`/${repo.id}/git/commit-message`, { method: 'POST' })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(502)
      expect(body.error).toBe('Model returned an empty commit message')
    })

    it('returns 502 when the client throws', async () => {
      writeFileSync(path.join(repoPath, 'file.ts'), 'staged\n')
      git(['add', 'file.ts'], repoPath)
      generateText.mockRejectedValue(new Error('Model unavailable'))

      const response = await app.request(`/${repo.id}/git/commit-message`, { method: 'POST' })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(502)
      expect(body.error).toBe('Model unavailable')
    })

    it('returns 502 when generation times out', async () => {
      writeFileSync(path.join(repoPath, 'file.ts'), 'staged\n')
      git(['add', 'file.ts'], repoPath)
      generateText.mockImplementation(() => new Promise(() => {}))

      const response = await app.request(`/${repo.id}/git/commit-message`, { method: 'POST' })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(502)
      expect(body.error).toBe('Commit message generation timed out')
    })
  })

  describe('GET /:id/git/commit/:hash', () => {
    it('returns the commit details and the file diff of that commit', async () => {
      commitFile('notes.txt', 'hello\n', 'Add notes')
      const hash = git(['rev-parse', 'HEAD'], repoPath)

      const detailsResponse = await app.request(`/${repo.id}/git/commit/${hash}`)
      const details = await readJson(detailsResponse, CommitDetailsSchema)

      expect(detailsResponse.status).toBe(200)
      expect(details.message).toBe('Add notes')
      expect(details.files.map((file) => file.path)).toEqual(['notes.txt'])

      const diffResponse = await app.request(`/${repo.id}/git/commit/${hash}/diff?path=notes.txt`)
      const diff = await readJson(diffResponse, FileDiffSchema)

      expect(diffResponse.status).toBe(200)
      expect(diff.additions).toBe(1)
      expect(diff.diff).toContain('+hello')
    })

    it('fails when the commit does not exist', async () => {
      const response = await app.request(`/${repo.id}/git/commit/${'0'.repeat(40)}`)
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(500)
      expect(body.error).not.toBe('')
    })

    it('returns 400 when the commit diff has no path', async () => {
      const hash = git(['rev-parse', 'HEAD'], repoPath)

      const response = await app.request(`/${repo.id}/git/commit/${hash}/diff`)
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('path query parameter is required')
    })
  })

  describe('POST /:id/git/branches/rename', () => {
    it('renames the checked-out branch and returns the refreshed status', async () => {
      const response = await app.request(`/${repo.id}/git/branches/rename`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ from: 'main', to: 'renamed' }),
      })
      const body = await readJson(response, GitStatusSchema)

      expect(response.status).toBe(200)
      expect(body.branch).toBe('renamed')
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('renamed')
    })

    it('returns 400 when the request body is invalid', async () => {
      const response = await app.request(`/${repo.id}/git/branches/rename`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ from: 'main' }),
      })

      expect(response.status).toBe(400)
    })

    it('returns 400 for an option-like source branch name', async () => {
      const response = await app.request(`/${repo.id}/git/branches/rename`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ from: '--force', to: 'victim' }),
      })
      const body = await readJson(response, ErrorSchema)

      expect(response.status).toBe(400)
      expect(body.error).not.toBe('')
    })

    it('returns 409 when the branch is checked out in another worktree', async () => {
      const worktreePath = path.join(workspace.path, 'repos', 'repo-feature')
      git(['worktree', 'add', worktreePath, 'feature'], repoPath)

      const response = await app.request(`/${repo.id}/git/branches/rename`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ from: 'feature', to: 'feature-renamed' }),
      })
      const body = await readJson(response, CodedErrorSchema)

      expect(response.status).toBe(409)
      expect(body.code).toBe('BRANCH_IN_OTHER_WORKTREE')
    })
  })

  describe('DELETE /:id/git/branches', () => {
    it('deletes the branch and keeps the remote branch', async () => {
      git(['branch', 'feature-local'], repoPath)

      const response = await app.request(`/${repo.id}/git/branches`, {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'feature-local', force: false, deleteRemote: false }),
      })
      const body = await readJson(response, z.object({ remoteDeleted: z.boolean(), status: GitStatusSchema }))

      expect(response.status).toBe(200)
      expect(body.remoteDeleted).toBe(false)
      expect(body.status.branch).toBe('main')
      expect(git(['branch', '--format=%(refname:short)'], repoPath).split('\n')).not.toContain('feature-local')
    })

    it('returns 400 when the request body is invalid', async () => {
      const response = await app.request(`/${repo.id}/git/branches`, {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
    })

    it('returns 409 when deleting the checked-out branch', async () => {
      const response = await app.request(`/${repo.id}/git/branches`, {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'main', force: true, deleteRemote: false }),
      })
      const body = await readJson(response, CodedErrorSchema)

      expect(response.status).toBe(409)
      expect(body.code).toBe('BRANCH_CHECKED_OUT')
    })

    it('returns 400 for an option-like branch name', async () => {
      const response = await app.request(`/${repo.id}/git/branches`, {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ name: '--force', force: true }),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('POST /:id/git/integrate', () => {
    function createFeatureWorktree() {
      const worktreePath = path.join(workspace.path, 'repos', 'repo-feature')
      git(['worktree', 'add', worktreePath, 'feature'], repoPath)
      return {
        worktreePath,
        worktreeRepo: seedRepo(db, {
          localPath: 'repo-feature',
          sourcePath: worktreePath,
          defaultBranch: 'feature',
          branch: 'feature',
          isWorktree: true,
        }),
      }
    }

    it('returns 400 when the request body is invalid', async () => {
      const response = await app.request(`/${repo.id}/git/integrate`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ strategy: 'merge' }),
      })

      expect(response.status).toBe(400)
    })

    it('merges the source branch into the target checkout', async () => {
      const { worktreePath, worktreeRepo } = createFeatureWorktree()
      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'feature work'], worktreePath)

      const expectedCommits = Number(git(['rev-list', '--count', 'main..feature'], worktreePath))

      const response = await app.request(`/${worktreeRepo.id}/git/integrate`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ targetBranch: 'main', strategy: 'merge' }),
      })
      const body = await readJson(response, z.object({
        targetRepoId: z.number(),
        integratedCommits: z.number(),
        targetStatus: GitStatusSchema,
      }))

      expect(response.status).toBe(200)
      expect(body.targetRepoId).toBe(repo.id)
      expect(body.integratedCommits).toBe(expectedCommits)
      expect(body.targetStatus.branch).toBe('main')
      expect(git(['show', 'main:feature.txt'], repoPath)).toBe('feature')
    })

    it('returns 409 with the conflict body shape when the merge stops on conflicts', async () => {
      const { worktreePath, worktreeRepo } = createFeatureWorktree()
      commitFile('file.txt', 'from main\n', 'main change')
      writeFileSync(path.join(worktreePath, 'file.txt'), 'from feature\n')
      git(['add', 'file.txt'], worktreePath)
      git(['commit', '-m', 'feature change'], worktreePath)

      const response = await app.request(`/${worktreeRepo.id}/git/integrate`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ targetBranch: 'main', strategy: 'merge' }),
      })
      const body = await readJson(response, z.object({
        error: z.string(),
        detail: z.string(),
        code: z.string(),
        details: z.object({
          targetRepoId: z.number(),
          operation: z.object({ kind: z.string(), conflictedFiles: z.array(z.string()) }),
        }),
      }))

      expect(response.status).toBe(409)
      expect(body).toEqual({
        error: 'Merge conflict detected. Resolve the conflicts before continuing.',
        detail: 'Integration stopped on conflicts',
        code: 'MERGE_CONFLICT',
        details: { targetRepoId: repo.id, operation: { kind: 'merge', conflictedFiles: ['file.txt'] } },
      })
    })
  })

  describe('stashes', () => {
    it('pushes, lists, applies, and drops a stash', async () => {
      writeTrackedFile('file.txt', 'committed\n')
      writeFileSync(path.join(repoPath, 'file.txt'), 'work in progress\n')

      const pushResponse = await app.request(`/${repo.id}/git/stash`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ message: 'wip note', includeUntracked: true }),
      })
      const pushedStatus = await readJson(pushResponse, GitStatusSchema)
      expect(pushResponse.status).toBe(200)
      expect(pushedStatus.hasChanges).toBe(false)

      const listResponse = await app.request(`/${repo.id}/git/stash`)
      const list = await readJson(listResponse, StashesResponseSchema)
      expect(listResponse.status).toBe(200)
      expect(list.stashes).toHaveLength(1)
      expect(list.stashes[0]).toMatchObject({ index: 0, ref: 'stash@{0}', message: 'wip note' })
      const stashHash = list.stashes[0]?.hash ?? ''

      const applyResponse = await app.request(`/${repo.id}/git/stash/0/apply`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ hash: stashHash, pop: false }),
      })
      const appliedStatus = await readJson(applyResponse, GitStatusSchema)
      expect(applyResponse.status).toBe(200)
      expect(appliedStatus.hasChanges).toBe(true)

      const dropResponse = await app.request(`/${repo.id}/git/stash/0`, {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ hash: stashHash }),
      })
      expect(dropResponse.status).toBe(200)

      const remaining = await readJson(await app.request(`/${repo.id}/git/stash`), StashesResponseSchema)
      expect(remaining.stashes).toEqual([])
    })

    it('returns 409 with STASH_CHANGED when the stash hash no longer matches', async () => {
      writeTrackedFile('file.txt', 'committed\n')
      writeFileSync(path.join(repoPath, 'file.txt'), 'work in progress\n')
      await app.request(`/${repo.id}/git/stash`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ message: 'wip note' }),
      })

      const applyResponse = await app.request(`/${repo.id}/git/stash/0/apply`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ hash: 'stale', pop: false }),
      })
      expect(applyResponse.status).toBe(409)
      expect((await readJson(applyResponse, CodedErrorSchema)).code).toBe('STASH_CHANGED')

      const dropResponse = await app.request(`/${repo.id}/git/stash/0`, {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ hash: 'stale' }),
      })
      expect(dropResponse.status).toBe(409)
      expect((await readJson(dropResponse, CodedErrorSchema)).code).toBe('STASH_CHANGED')
    })

    it.each([
      { label: 'push with an invalid body', method: 'POST', stashPath: '', body: { message: 123 } },
      { label: 'apply with a non-integer index', method: 'POST', stashPath: '/abc/apply', body: { pop: false } },
      { label: 'apply without a hash', method: 'POST', stashPath: '/2/apply', body: { pop: true } },
      { label: 'drop with a non-integer index', method: 'DELETE', stashPath: '/1.5', body: {} },
      { label: 'drop without a hash', method: 'DELETE', stashPath: '/0', body: {} },
    ])('returns 400 for $label', async ({ method, stashPath, body: requestBody }) => {
      const response = await app.request(`/${repo.id}/git/stash${stashPath}`, {
        method,
        headers: jsonHeaders,
        body: JSON.stringify(requestBody),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('git operations', () => {
    function startConflictedMerge(): void {
      const base = git(['rev-parse', 'HEAD'], repoPath)
      commitFile('file.txt', 'from main\n', 'main change')
      git(['checkout', '-b', 'topic', base], repoPath)
      writeFileSync(path.join(repoPath, 'file.txt'), 'from topic\n')
      git(['add', 'file.txt'], repoPath)
      git(['commit', '-m', 'topic change'], repoPath)
      git(['checkout', 'main'], repoPath)
      try {
        git(['merge', 'topic'], repoPath)
      } catch {
        return
      }
      throw new Error('expected the merge to conflict')
    }

    it('reports 409 when continuing without a git operation', async () => {
      const response = await app.request(`/${repo.id}/git/operation/continue`, { method: 'POST' })
      const body = await readJson(response, CodedErrorSchema)

      expect(response.status).toBe(409)
      expect(body.code).toBe('NO_OPERATION_IN_PROGRESS')
    })

    it('reports 409 when aborting without a git operation', async () => {
      const response = await app.request(`/${repo.id}/git/operation/abort`, { method: 'POST' })
      const body = await readJson(response, CodedErrorSchema)

      expect(response.status).toBe(409)
      expect(body.code).toBe('NO_OPERATION_IN_PROGRESS')
    })

    it('continues a conflicted merge after the conflicts are resolved', async () => {
      startConflictedMerge()
      writeFileSync(path.join(repoPath, 'file.txt'), 'resolved\n')
      git(['add', 'file.txt'], repoPath)

      const response = await app.request(`/${repo.id}/git/operation/continue`, { method: 'POST' })
      const body = await readJson(response, GitStatusSchema)

      expect(response.status).toBe(200)
      expect(body.branch).toBe('main')
      expect(body.operation).toBeNull()
      expect(git(['log', '-1', '--format=%s'], repoPath)).toBe('Merge branch \'topic\'')
    })

    it('aborts a conflicted merge and restores the working tree', async () => {
      startConflictedMerge()

      const response = await app.request(`/${repo.id}/git/operation/abort`, { method: 'POST' })
      const body = await readJson(response, GitStatusSchema)

      expect(response.status).toBe(200)
      expect(body.branch).toBe('main')
      expect(body.operation).toBeNull()
      expect(git(['log', '-1', '--format=%s'], repoPath)).toBe('main change')
    })
  })

  describe('repo lookup', () => {
    it.each([
      { endpoint: 'git/diff-full?path=file.ts', method: 'GET', body: undefined },
      { endpoint: 'git/branches', method: 'GET', body: undefined },
      { endpoint: 'git/discard', method: 'POST', body: { paths: ['file.ts'] } },
      { endpoint: 'git/commit-message', method: 'POST', body: undefined },
      { endpoint: 'git/commit/abc123', method: 'GET', body: undefined },
      { endpoint: 'git/commit/abc123/diff?path=file.ts', method: 'GET', body: undefined },
      { endpoint: 'git/branches/rename', method: 'POST', body: { from: 'main', to: 'renamed' } },
      { endpoint: 'git/branches', method: 'DELETE', body: { name: 'feature' } },
      { endpoint: 'git/integrate', method: 'POST', body: { targetBranch: 'main' } },
      { endpoint: 'git/stash', method: 'GET', body: undefined },
      { endpoint: 'git/stash', method: 'POST', body: {} },
      { endpoint: 'git/stash/0/apply', method: 'POST', body: { hash: 'abc' } },
      { endpoint: 'git/stash/0', method: 'DELETE', body: { hash: 'abc' } },
      { endpoint: 'git/operation/continue', method: 'POST', body: undefined },
      { endpoint: 'git/operation/abort', method: 'POST', body: undefined },
    ])('returns 404 for $method $endpoint on an unknown repo', async ({ endpoint, method, body }) => {
      const init = body === undefined
        ? { method }
        : { method, headers: jsonHeaders, body: JSON.stringify(body) }

      const response = await app.request(`/999/${endpoint}`, init)
      const payload = await readJson(response, ErrorSchema)

      expect(response.status).toBe(404)
      expect(payload.error).toBe('Repo not found')
    })
  })

  describe('unchanged fixtures', () => {
    it('keeps a repo without commits usable through the status route', async () => {
      const freshPath = path.join(workspace.path, 'repos', 'fresh')
      createCommittedRepo(freshPath)
      const fresh = seedRepo(db, { localPath: 'fresh', sourcePath: freshPath })

      const response = await app.request(`/${fresh.id}/git/status`)
      const body = await readJson(response, GitStatusSchema)

      expect(response.status).toBe(200)
      expect(body.hasChanges).toBe(false)
    })
  })
})
