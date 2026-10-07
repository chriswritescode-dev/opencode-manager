import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoById } from '../db/queries'
import { logger } from '../utils/logger'
import { parseJsonBody, respondWithGitError } from '../utils/route-helpers'
import { buildCommitMessagePrompt, normalizeGeneratedCommitMessage } from '../services/git/commit-message-prompt'
import type { CommitMessageContext } from '../services/git/commit-message-prompt'
import { RenameBranchRequestSchema, DeleteBranchRequestSchema, StashPushRequestSchema, StashApplyRequestSchema, StashDropRequestSchema, IntegrateBranchRequestSchema } from '@opencode-manager/shared'
import type { GitService } from '../services/git/GitService'
import type { OpenCodeClient } from '../services/opencode/client'
import { GenerateTextTimeoutError, generateTextWithTimeout } from '../services/opencode/generate-text'
import type { GitStatusResponse } from '../types/git'
import type { Repo } from '../types/repo'
import { getErrorMessage } from '../utils/error-utils'

const DEFAULT_COMMIT_MESSAGE_TIMEOUT_MS = 30_000

export interface RepoGitRouteOptions {
  commitMessageTimeoutMs?: number
}

function parseStashIndex(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return null
  }
  return Number(raw)
}

export function createRepoGitRoutes(
  database: Database,
  git: GitService,
  openCodeClient: OpenCodeClient,
  options: RepoGitRouteOptions = {},
) {
  const app = new Hono()
  const commitMessageTimeoutMs = options.commitMessageTimeoutMs ?? DEFAULT_COMMIT_MESSAGE_TIMEOUT_MS

  async function withRepo(
    c: Context,
    logMessage: string,
    handler: (repo: Repo, id: number) => Promise<Response>,
  ): Promise<Response> {
    const id = parseInt(c.req.param('id'))
    const repo = getRepoById(database, id)

    if (!repo) {
      return c.json({ error: 'Repo not found' }, 404)
    }

    try {
      return await handler(repo, id)
    } catch (error: unknown) {
      return respondWithGitError(c, error, logMessage)
    }
  }

  app.get('/:id/git/status', (c) => withRepo(c, 'Failed to get git status:', async (_repo, id) => {
    const status = await git.getStatus(id, database)

    return c.json(status)
  }))

  app.post('/git-status-batch', async (c) => {
    try {
      const body = await c.req.json()
      const { repoIds } = body

      if (!Array.isArray(repoIds) || repoIds.some((id: unknown) => typeof id !== 'number')) {
        return c.json({ error: 'repoIds must be an array of numbers' }, 400)
      }

      const BATCH_CONCURRENCY = 3
      const results: Array<[number, GitStatusResponse] | null> = []
      for (let i = 0; i < repoIds.length; i += BATCH_CONCURRENCY) {
        const batch = repoIds.slice(i, i + BATCH_CONCURRENCY)
        const batchResults = await Promise.all(
          batch.map(async (id) => {
            try {
              const status = await git.getStatus(id, database)
              return [id, status] as [number, GitStatusResponse]
            } catch (error: unknown) {
              logger.error(`Failed to get git status for repo ${id}:`, error)
              return null
            }
          })
        )
        results.push(...batchResults)
      }

      const resultMap: Record<number, GitStatusResponse> = {}
      for (const entry of results) {
        if (entry) {
          const [id, status] = entry
          resultMap[id] = status
        }
      }

      return c.json(resultMap)
    } catch (error: unknown) {
      return respondWithGitError(c, error, 'Failed to get batch git status:')
    }
  })

  app.get('/:id/git/diff', (c) => {
    const filePath = c.req.query('path')

    if (!filePath) {
      return c.json({ error: 'path query parameter is required' }, 400)
    }

    return withRepo(c, 'Failed to get file diff:', async (_repo, id) => {
      const diff = await git.getDiff(id, filePath, database)

      return c.json(diff)
    })
  })

  app.get('/:id/git/diff-full', (c) => {
    const filePath = c.req.query('path')
    const includeStaged = c.req.query('includeStaged') === 'true'

    if (!filePath) {
      return c.json({ error: 'path query parameter is required' }, 400)
    }

    return withRepo(c, 'Failed to get full file diff:', async (_repo, id) => {
      const diffResponse = await git.getFullDiff(id, filePath, database, includeStaged)

      return c.json(diffResponse)
    })
  })

  app.post('/:id/git/fetch', (c) => withRepo(c, 'Failed to fetch git:', async (_repo, id) => {
    await git.fetch(id, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/pull', (c) => withRepo(c, 'Failed to pull git:', async (_repo, id) => {
    await git.pull(id, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/commit', (c) => withRepo(c, 'Failed to commit git:', async (_repo, id) => {
    const body = await c.req.json()
    const { message, stagedPaths } = body

    if (!message) {
      return c.json({ error: 'message is required' }, 400)
    }

    await git.commit(id, message, database, stagedPaths)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/commit-message', (c) => withRepo(c, 'Failed to generate commit message:', async (_repo, id) => {
    let context: CommitMessageContext
    try {
      context = await git.getCommitMessageContext(id, database)
    } catch (error: unknown) {
      logger.error('Failed to build commit message context:', error)
      return c.json({ error: getErrorMessage(error) }, 400)
    }

    try {
      const text = await generateTextWithTimeout(
        openCodeClient,
        { prompt: buildCommitMessagePrompt(context) },
        commitMessageTimeoutMs,
      )
      const message = normalizeGeneratedCommitMessage(text)

      if (!message) {
        return c.json({ error: 'Model returned an empty commit message' }, 502)
      }

      return c.json({ message })
    } catch (error: unknown) {
      if (error instanceof GenerateTextTimeoutError) {
        return c.json({ error: 'Commit message generation timed out' }, 502)
      }
      logger.error('Failed to generate commit message:', error)
      return c.json({ error: getErrorMessage(error) }, 502)
    }
  }))

  app.post('/:id/git/push', (c) => withRepo(c, 'Failed to push git:', async (_repo, id) => {
    const body = await c.req.json()
    const { setUpstream } = body

    await git.push(id, { setUpstream: setUpstream || false }, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/stage', (c) => withRepo(c, 'Failed to stage files:', async (_repo, id) => {
    const body = await c.req.json()
    const { paths } = body

    if (!paths || !Array.isArray(paths)) {
      return c.json({ error: 'paths is required and must be an array' }, 400)
    }

    await git.stageFiles(id, paths, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/unstage', (c) => withRepo(c, 'Failed to unstage files:', async (_repo, id) => {
    const body = await c.req.json()
    const { paths } = body

    if (!paths || !Array.isArray(paths)) {
      return c.json({ error: 'paths is required and must be an array' }, 400)
    }

    await git.unstageFiles(id, paths, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/discard', (c) => withRepo(c, 'Failed to discard changes:', async (_repo, id) => {
    const body = await c.req.json()
    const { paths, staged } = body

    if (!paths || !Array.isArray(paths)) {
      return c.json({ error: 'paths is required and must be an array' }, 400)
    }

    await git.discardChanges(id, paths, staged ?? false, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.get('/:id/git/commit/:hash', (c) => withRepo(c, 'Failed to get commit details:', async (_repo, id) => {
    const hash = c.req.param('hash')

    if (!hash) {
      return c.json({ error: 'hash is required' }, 400)
    }

    const commitDetails = await git.getCommitDetails(id, hash, database)

    if (!commitDetails) {
      return c.json({ error: 'Commit not found' }, 404)
    }

    return c.json(commitDetails)
  }))

  app.get('/:id/git/commit/:hash/diff', (c) => withRepo(c, 'Failed to get commit diff:', async (_repo, id) => {
    const hash = c.req.param('hash')
    const filePath = c.req.query('path')

    if (!hash) {
      return c.json({ error: 'hash is required' }, 400)
    }

    if (!filePath) {
      return c.json({ error: 'path query parameter is required' }, 400)
    }

    const diff = await git.getCommitDiff(id, hash, filePath, database)
    return c.json(diff)
  }))

  app.get('/:id/git/log', (c) => withRepo(c, 'Failed to get git log:', async (_repo, id) => {
    const limit = parseInt(c.req.query('limit') || '10', 10)
    const branch = c.req.query('branch') || undefined
    const commits = await git.getLog(id, database, limit, branch)

    return c.json({ commits })
  }))

  app.post('/:id/git/reset', (c) => withRepo(c, 'Failed to reset to commit:', async (_repo, id) => {
    const body = await c.req.json()
    const { commitHash } = body

    if (!commitHash) {
      return c.json({ error: 'commitHash is required' }, 400)
    }

    await git.resetToCommit(id, commitHash, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.get('/:id/git/branches', (c) => withRepo(c, 'Failed to get branches:', async (_repo, id) => {
    const branches = await git.getBranches(id, database)
    const status = await git.getBranchStatus(id, database)

    return c.json({ branches, status })
  }))

  app.post('/:id/git/branches/rename', (c) => withRepo(c, 'Failed to rename branch:', async (_repo, id) => {
    const parsed = await parseJsonBody(c, RenameBranchRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    await git.renameBranch(id, parsed.data.from, parsed.data.to, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.delete('/:id/git/branches', (c) => withRepo(c, 'Failed to delete branch:', async (_repo, id) => {
    const parsed = await parseJsonBody(c, DeleteBranchRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    const result = await git.deleteBranch(id, parsed.data, database)

    const status = await git.getStatus(id, database)
    return c.json({ ...result, status })
  }))

  app.post('/:id/git/integrate', (c) => withRepo(c, 'Failed to integrate branch:', async (_repo, id) => {
    const parsed = await parseJsonBody(c, IntegrateBranchRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    const result = await git.integrateBranch(id, parsed.data, database)

    const targetStatus = await git.getStatus(result.targetRepoId, database)
    return c.json({ ...result, targetStatus })
  }))

  app.get('/:id/git/stash', (c) => withRepo(c, 'Failed to list stashes:', async (_repo, id) => {
    const stashes = await git.listStashes(id, database)
    return c.json({ stashes })
  }))

  app.post('/:id/git/stash', (c) => withRepo(c, 'Failed to push stash:', async (_repo, id) => {
    const parsed = await parseJsonBody(c, StashPushRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    await git.pushStash(id, parsed.data, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/stash/:index/apply', (c) => withRepo(c, 'Failed to apply stash:', async (_repo, id) => {
    const index = parseStashIndex(c.req.param('index'))
    if (index === null) {
      return c.json({ error: 'index must be a non-negative integer' }, 400)
    }

    const parsed = await parseJsonBody(c, StashApplyRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    await git.applyStash(id, index, parsed.data.hash, parsed.data.pop, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.delete('/:id/git/stash/:index', (c) => withRepo(c, 'Failed to drop stash:', async (_repo, id) => {
    const index = parseStashIndex(c.req.param('index'))
    if (index === null) {
      return c.json({ error: 'index must be a non-negative integer' }, 400)
    }

    const parsed = await parseJsonBody(c, StashDropRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    await git.dropStash(id, index, parsed.data.hash, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/operation/continue', (c) => withRepo(c, 'Failed to continue git operation:', async (_repo, id) => {
    await git.continueOperation(id, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  app.post('/:id/git/operation/abort', (c) => withRepo(c, 'Failed to abort git operation:', async (_repo, id) => {
    await git.abortOperation(id, database)

    const status = await git.getStatus(id, database)
    return c.json(status)
  }))

  return app
}
