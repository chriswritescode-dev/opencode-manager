import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import { logger } from '../utils/logger'
import { getErrorMessage } from '../utils/error-utils'
import { GitCommitService } from '../services/git/GitCommitService'
import { GitPushService } from '../services/git/GitPushService'
import { GitLogService } from '../services/git/GitLogService'
import { GitStatusService } from '../services/git/GitStatusService'
import { GitFetchPullService } from '../services/git/GitFetchPullService'
import { GitBranchService } from '../services/git/GitBranchService'
import type { GitAuthService } from '../services/git-auth'
import { GitDiffService } from '../services/git/GitDiffService'
import type { GitStatusResponse } from '../types/git'

export function createRepoGitRoutes(database: Database, gitAuthService: GitAuthService) {
  const app = new Hono()
  const gitDiffService = new GitDiffService(gitAuthService)
  const gitFetchPullService = new GitFetchPullService(gitAuthService)
  const gitBranchService = new GitBranchService(gitAuthService)
  const gitCommitService = new GitCommitService(gitAuthService)
  const gitPushService = new GitPushService(gitAuthService)
  const gitLogService = new GitLogService(gitAuthService, gitDiffService)
  const gitStatusService = new GitStatusService(gitAuthService)

  app.get('/:id/git/status', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const status = await gitStatusService.getStatus(id, database)

      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to get git status:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/git-status-batch', async (c) => {
    try {
      const body = await c.req.json()
      const { repoIds } = body

      if (!Array.isArray(repoIds) || repoIds.some((id: unknown) => typeof id !== 'number')) {
        return c.json({ error: 'repoIds must be an array of numbers' }, 400)
      }

      const statuses = await Promise.all(
        repoIds.map(async (id) => {
          try {
            const status = await gitStatusService.getStatus(id, database)
            return [id, status]
          } catch (error: unknown) {
            logger.error(`Failed to get git status for repo ${id}:`, error)
            return null
          }
        })
      )

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
      return c.json({ error: getErrorMessage(error) }, 500)
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

      const diff = await gitLogService.getDiff(id, filePath, database)

      return c.json(diff)
    } catch (error: unknown) {
      logger.error('Failed to get file diff:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  // Add new endpoint for full diff details
  app.get('/:id/git/diff-full', async (c) => {
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

      const diffResponse = await gitLogService.getFullDiff(id, filePath, database)
      return c.json(diffResponse)
    } catch (error: unknown) {
      logger.error('Failed to get full file diff:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/git/fetch', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      await gitFetchPullService.fetch(id, database)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to fetch git:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/git/pull', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      await gitFetchPullService.pull(id, database)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to pull git:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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

      await gitCommitService.commit(id, message, database, stagedPaths)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to commit git:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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

      await gitPushService.push(id, { setUpstream: setUpstream || false }, database)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to push git:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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

      await gitCommitService.stageFiles(id, paths, database)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to stage files:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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

      await gitCommitService.unstageFiles(id, paths, database)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to unstage files:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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
      const commits = await gitLogService.getLog(id, database, limit)

      return c.json({ commits })
    } catch (error: unknown) {
      logger.error('Failed to get git log:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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

      await gitCommitService.resetToCommit(id, commitHash, database)

      const status = await gitStatusService.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to reset to commit:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.get('/:id/git/branches', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const branches = await gitBranchService.getBranches(id, database)
      const status = await gitBranchService.getBranchStatus(id, database)

      return c.json({ branches, status })
    } catch (error: unknown) {
      logger.error('Failed to get branches:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}