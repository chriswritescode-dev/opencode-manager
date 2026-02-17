import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import * as db from '../db/queries'
import { logger } from '../utils/logger'
import { parseGitError } from '../utils/git-errors'
import { GitService } from '../services/git/GitService'
import type { GitAuthService } from '../services/git-auth'
import { SettingsService } from '../services/settings'
import type { GitStatusResponse } from '../types/git'

export function createRepoGitRoutes(database: Database, gitAuthService: GitAuthService) {
  const app = new Hono()
  const settingsService = new SettingsService(database)
  const git = new GitService(gitAuthService, settingsService)

  app.get('/:id/git/status', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const status = await git.getStatus(id, database)

      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to get git status:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

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

      const statuses = results

      const resultMap: Record<number, GitStatusResponse> = {}
      for (const entry of statuses) {
        if (entry) {
          const [id, status] = entry
          resultMap[id] = status
        }
      }


      return c.json(resultMap)
    } catch (error: unknown) {
      logger.error('Failed to get batch git status:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.get('/:id/git/diff', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const filePath = c.req.query('path')

      if (!filePath) {
        return c.json({ error: 'path query parameter is required' }, 400)
      }

      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const diff = await git.getDiff(id, filePath, database)

      return c.json(diff)
    } catch (error: unknown) {
      logger.error('Failed to get file diff:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  // Add new endpoint for full diff details
  app.get('/:id/git/diff-full', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const filePath = c.req.query('path')
      const includeStaged = c.req.query('includeStaged') === 'true'

      if (!filePath) {
        return c.json({ error: 'path query parameter is required' }, 400)
      }

      const repo = db.getRepoById(database, id)
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const diffResponse = await git.getFullDiff(id, filePath, database, includeStaged)
      return c.json(diffResponse)
    } catch (error: unknown) {
      logger.error('Failed to get full file diff:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/fetch', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      await git.fetch(id, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to fetch git:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/pull', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      await git.pull(id, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to pull git:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/commit', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const { message, stagedPaths } = body

      if (!message) {
        return c.json({ error: 'message is required' }, 400)
      }

      await git.commit(id, message, database, stagedPaths)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to commit git:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/push', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const { setUpstream } = body

      await git.push(id, { setUpstream: setUpstream || false }, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to push git:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/stage', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const { paths } = body

      if (!paths || !Array.isArray(paths)) {
        return c.json({ error: 'paths is required and must be an array' }, 400)
      }

      await git.stageFiles(id, paths, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to stage files:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/unstage', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const { paths } = body

      if (!paths || !Array.isArray(paths)) {
        return c.json({ error: 'paths is required and must be an array' }, 400)
      }

      await git.unstageFiles(id, paths, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to unstage files:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/discard', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const { paths, staged } = body

      if (!paths || !Array.isArray(paths)) {
        return c.json({ error: 'paths is required and must be an array' }, 400)
      }

      await git.discardChanges(id, paths, staged ?? false, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to discard changes:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.get('/:id/git/commit/:hash', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const hash = c.req.param('hash')
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      if (!hash) {
        return c.json({ error: 'hash is required' }, 400)
      }

      const commitDetails = await git.getCommitDetails(id, hash, database)

      if (!commitDetails) {
        return c.json({ error: 'Commit not found' }, 404)
      }

      return c.json(commitDetails)
    } catch (error: unknown) {
      logger.error('Failed to get commit details:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.get('/:id/git/commit/:hash/diff', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const hash = c.req.param('hash')
      const filePath = c.req.query('path')
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      if (!hash) {
        return c.json({ error: 'hash is required' }, 400)
      }

      if (!filePath) {
        return c.json({ error: 'path query parameter is required' }, 400)
      }

      const diff = await git.getCommitDiff(id, hash, filePath, database)
      return c.json(diff)
    } catch (error: unknown) {
      logger.error('Failed to get commit diff:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.get('/:id/git/log', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const limit = parseInt(c.req.query('limit') || '10', 10)
      const commits = await git.getLog(id, database, limit)

      return c.json({ commits })
    } catch (error: unknown) {
      logger.error('Failed to get git log:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.post('/:id/git/reset', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const { commitHash } = body

      if (!commitHash) {
        return c.json({ error: 'commitHash is required' }, 400)
      }

      await git.resetToCommit(id, commitHash, database)

      const status = await git.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to reset to commit:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  app.get('/:id/git/branches', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const branches = await git.getBranches(id, database)
      const status = await git.getBranchStatus(id, database)

      return c.json({ branches, status })
    } catch (error: unknown) {
      logger.error('Failed to get branches:', error)
      const gitError = parseGitError(error)
      return c.json(
        { error: gitError.summary, detail: gitError.detail, code: gitError.code },
        gitError.statusCode as ContentfulStatusCode
      )
    }
  })

  return app
}
