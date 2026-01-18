import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import * as repoService from '../services/repo'
import * as archiveService from '../services/archive'
import { SettingsService } from '../services/settings'
import { writeFileContent } from '../services/file-operations'
import { opencodeServerManager } from '../services/opencode-single-server'
import { proxyToOpenCodeWithDirectory } from '../services/proxy'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'
import { getOpenCodeConfigFilePath, getReposPath } from '@opencode-manager/shared/config/env'
import { createRepoGitRoutes } from './repo-git'
import type { GitAuthService } from '../services/git-auth'
import path from 'path'

export function createRepoRoutes(database: Database, gitAuthService: GitAuthService) {
  const app = new Hono()

  app.route('/', createRepoGitRoutes(database, gitAuthService))

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
          gitAuthService,
          localPath,
          branch
        )
      } else {
        repo = await repoService.cloneRepo(
          database,
          gitAuthService,
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
          const env = gitAuthService.getGitEnvironment()
          const currentBranch = await repoService.getCurrentBranch(repo, env)
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
      
      const currentBranch = await repoService.getCurrentBranch(repo, gitAuthService.getGitEnvironment())
      
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
      await repoService.pullRepo(database, gitAuthService, id)
      
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
      
      await repoService.switchBranch(database, gitAuthService, id, branch)
      
      const updatedRepo = db.getRepoById(database, id)
      const currentBranch = await repoService.getCurrentBranch(updatedRepo!, gitAuthService.getGitEnvironment())
      
      return c.json({ ...updatedRepo, currentBranch })
    } catch (error: unknown) {
      logger.error('Failed to switch branch:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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
      
      await repoService.createBranch(database, gitAuthService, id, branch)
      
      const updatedRepo = db.getRepoById(database, id)
      const currentBranch = await repoService.getCurrentBranch(updatedRepo!, gitAuthService.getGitEnvironment())
      
      return c.json({ ...updatedRepo, currentBranch })
    } catch (error: unknown) {
      logger.error('Failed to create branch:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
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

  app.post('/:id/reset-permissions', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const response = await proxyToOpenCodeWithDirectory(
        '/instance/dispose',
        'POST',
        repo.fullPath
      )
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`Failed to reset permissions for repo ${id}:`, errorText)
        return c.json({ error: 'Failed to reset permissions' }, 500)
      }
      
      logger.info(`Reset permissions for repo ${id} (${repo.fullPath})`)
      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to reset permissions:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })
  
  return app
}
