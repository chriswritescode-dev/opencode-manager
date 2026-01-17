import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import * as repoService from '../services/repo'
import { GitAuthenticationError as RepoGitAuthenticationError } from '../services/repo'
import * as archiveService from '../services/archive'
import { SettingsService } from '../services/settings'
import { writeFileContent } from '../services/file-operations'
import { opencodeServerManager } from '../services/opencode-single-server'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode, handleGitError } from '../utils/error-utils'
import { getOpenCodeConfigFilePath, getReposPath } from '@opencode-manager/shared/config/env'
import { GitFetchService } from '../services/git/GitFetchService'
import { GitCommitService } from '../services/git/GitCommitService'
import { GitPushService } from '../services/git/GitPushService'
import { GitLogService } from '../services/git/GitLogService'
import { GitStatusService } from '../services/git/GitStatusService'
import { GitFetchPullService } from '../services/git/GitFetchPullService'
import { GitBranchService } from '../services/git/GitBranchService'
import { GitAuthService } from '../utils/git-auth'
import { GitCommandHandler } from '../handlers/GitCommandHandler'
import { GitAuthenticationError, GitConflictError, GitNotFoundError, GitOperationError } from '../errors/git-errors'
import type { GitStatusResponse } from '../types/git'
import path from 'path'

export function createRepoRoutes(database: Database) {
  const app = new Hono()
  const gitAuthService = new GitAuthService()
  const gitFetchPullService = new GitFetchPullService(gitAuthService)
  const gitBranchService = new GitBranchService(gitAuthService)
  const gitFetchService = new GitFetchService(gitFetchPullService, gitBranchService)
  const gitCommitService = new GitCommitService(gitAuthService)
  const gitPushService = new GitPushService(gitAuthService)
  const gitLogService = new GitLogService(gitAuthService)
  const gitStatusService = new GitStatusService(gitAuthService)
  const gitCommandHandler = new GitCommandHandler(gitFetchService, gitCommitService, gitPushService, gitLogService, gitStatusService)

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const { repoUrl, localPath, branch, openCodeConfigName, useWorktree, provider } = body

      if (!repoUrl && !localPath) {
        return c.json({ error: 'Either repoUrl or localPath is required' }, 400)
      }

      logger.info(`Creating repo - URL: ${repoUrl}, Provider: ${provider || 'auto-detect'}`)
      
      let repo
      if (localPath) {
        repo = await repoService.initLocalRepo(
          database,
          localPath,
          branch
        )
      } else {
        repo = await repoService.cloneRepo(
          database,
          repoUrl!,
          branch,
          useWorktree
        )
      }
      
      if (openCodeConfigName) {
        const settingsService = new SettingsService(database)
        const configContent = settingsService.getOpenCodeConfigContent(openCodeConfigName)
        
        if (configContent) {
          const openCodeConfigPath = getOpenCodeConfigFilePath()
          await writeFileContent(openCodeConfigPath, configContent)
          db.updateRepoConfigName(database, repo.id, openCodeConfigName)
          logger.info(`Applied config '${openCodeConfigName}' to: ${openCodeConfigPath}`)
        }
      }
      
      return c.json(repo)
    } catch (error: unknown) {
      logger.error('Failed to create repo:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })
  
app.get('/', async (c) => {
    try {
      const settingsService = new SettingsService(database)
      const settings = settingsService.getSettings()
      const repos = db.listRepos(database, settings.preferences.repoOrder)

      const reposWithCurrentBranch = await Promise.all(
        repos.map(async (repo) => {
          const currentBranch = await repoService.getCurrentBranch(repo)
          return { ...repo, currentBranch }
        })
      )
      return c.json(reposWithCurrentBranch)
    } catch (error: unknown) {
      logger.error('Failed to list repos:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.put('/order', async (c) => {
    try {
      const body = await c.req.json()

      if (!Array.isArray(body.order) || body.order.some((id: unknown) => typeof id !== 'number')) {
        return c.json({ error: 'order must be an array of numbers' }, 400)
      }

      const settingsService = new SettingsService(database)
      settingsService.updateSettings({
        repoOrder: body.order,
      })

      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to update repo order:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.get('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const currentBranch = await repoService.getCurrentBranch(repo)
      
      return c.json({ ...repo, currentBranch })
    } catch (error: unknown) {
      logger.error('Failed to get repo:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })
  
  app.delete('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      await repoService.deleteRepoFiles(database, id)
      
      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to delete repo:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })
  
  app.post('/:id/pull', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      await repoService.pullRepo(database, id)
      
      const repo = db.getRepoById(database, id)
      return c.json(repo)
    } catch (error: unknown) {
      logger.error('Failed to pull repo:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/config/switch', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const body = await c.req.json()
      const { configName } = body
      
      if (!configName) {
        return c.json({ error: 'configName is required' }, 400)
      }
      
      const settingsService = new SettingsService(database)
      const configContent = settingsService.getOpenCodeConfigContent(configName)
      
      if (!configContent) {
        return c.json({ error: `Config '${configName}' not found` }, 404)
      }
      
      const openCodeConfigPath = getOpenCodeConfigFilePath()
      
      await writeFileContent(openCodeConfigPath, configContent)
      
      db.updateRepoConfigName(database, id, configName)
      
      logger.info(`Switched config for repo ${id} to '${configName}'`)
      logger.info(`Updated OpenCode config: ${openCodeConfigPath}`)
      
      logger.info('Restarting OpenCode server due to workspace config change')
      await opencodeServerManager.stop()
      await opencodeServerManager.start()
      
      const updatedRepo = db.getRepoById(database, id)
      return c.json(updatedRepo)
    } catch (error: unknown) {
      logger.error('Failed to switch repo config:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/branch/switch', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const body = await c.req.json()
      const { branch } = body
      
      if (!branch) {
        return c.json({ error: 'branch is required' }, 400)
      }
      
      await repoService.switchBranch(database, id, branch)
      
      const updatedRepo = db.getRepoById(database, id)
      const currentBranch = await repoService.getCurrentBranch(updatedRepo!)
      
      return c.json({ ...updatedRepo, currentBranch })
    } catch (error: unknown) {
      logger.error('Failed to switch branch:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
    }
  })

  app.post('/:id/branch/create', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const body = await c.req.json()
      const { branch } = body
      
      if (!branch) {
        return c.json({ error: 'branch is required' }, 400)
      }
      
      await repoService.createBranch(database, id, branch)
      
      const updatedRepo = db.getRepoById(database, id)
      const currentBranch = await repoService.getCurrentBranch(updatedRepo!)
      
      return c.json({ ...updatedRepo, currentBranch })
    } catch (error: unknown) {
      logger.error('Failed to create branch:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
    }
  })

  app.get('/:id/branches', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
       const branches = await repoService.listBranches(database, repo)

      
      return c.json(branches)
    } catch (error: unknown) {
      logger.error('Failed to list branches:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.get('/:id/git/status', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const status = await gitCommandHandler.getStatus(id, database)

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
            const status = await gitCommandHandler.getStatus(id, database)
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

      const diff = await gitCommandHandler.getDiff(id, filePath, database)

      return c.json(diff)
    } catch (error: unknown) {
      logger.error('Failed to get file diff:', error)
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

      await gitCommandHandler.fetch(id, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to fetch git:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
    }
  })

  app.post('/:id/git/pull', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      await gitCommandHandler.pull(id, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to pull git:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
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

      await gitCommandHandler.commit(id, message, stagedPaths, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to commit git:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
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

      await gitCommandHandler.push(id, { setUpstream: setUpstream || false }, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to push git:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
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

      await gitCommandHandler.stageFiles(id, paths, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to stage files:', error)
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return handleGitError(error, c)
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

      await gitCommandHandler.unstageFiles(id, paths, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to unstage files:', error)
      if (error instanceof GitAuthenticationError) {
        return c.json({ error: error.message, code: 'AUTH_FAILED' }, 401)
      }
      if (error instanceof GitConflictError) {
        return c.json({ error: error.message, code: 'CONFLICT' }, 409)
      }
      if (error instanceof GitNotFoundError) {
        return c.json({ error: error.message, code: 'NOT_FOUND' }, 404)
      }
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
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
      const log = await gitCommandHandler.getLog(id, limit, database)

      return c.json(log)
    } catch (error: unknown) {
      logger.error('Failed to get git log:', error)
      if (error instanceof GitAuthenticationError) {
        return c.json({ error: error.message, code: 'AUTH_FAILED' }, 401)
      }
      if (error instanceof GitConflictError) {
        return c.json({ error: error.message, code: 'CONFLICT' }, 409)
      }
      if (error instanceof GitNotFoundError) {
        return c.json({ error: error.message, code: 'NOT_FOUND' }, 404)
      }
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
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

      await gitCommandHandler.resetToCommit(id, commitHash, database)

      const status = await gitCommandHandler.getStatus(id, database)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to reset to commit:', error)
      if (error instanceof GitAuthenticationError) {
        return c.json({ error: error.message, code: 'AUTH_FAILED' }, 401)
      }
      if (error instanceof GitConflictError) {
        return c.json({ error: error.message, code: 'CONFLICT' }, 409)
      }
      if (error instanceof GitNotFoundError) {
        return c.json({ error: error.message, code: 'NOT_FOUND' }, 404)
      }
      if (error instanceof GitOperationError || error instanceof RepoGitAuthenticationError) {
        return c.json({ error: error.message, code: 'OPERATION_FAILED' }, 500)
      }
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  app.get('/:id/download', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const repoPath = path.resolve(getReposPath(), repo.localPath)
      const repoName = path.basename(repo.localPath)
      
      logger.info(`Starting archive creation for repo ${id}: ${repoPath}`)
      const archivePath = await archiveService.createRepoArchive(repoPath)
      const archiveSize = await archiveService.getArchiveSize(archivePath)
      const archiveStream = archiveService.getArchiveStream(archivePath)
      
      archiveStream.on('end', () => {
        archiveService.deleteArchive(archivePath)
      })
      
      archiveStream.on('error', () => {
        archiveService.deleteArchive(archivePath)
      })

      return new Response(archiveStream as unknown as ReadableStream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${repoName}.zip"`,
          'Content-Length': archiveSize.toString(),
        }
      })
    } catch (error: unknown) {
      logger.error('Failed to create repo archive:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })
  
  return app
}
