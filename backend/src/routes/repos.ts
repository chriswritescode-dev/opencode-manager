import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import * as repoService from '../services/repo'
import * as gitOperations from '../services/git-operations'
import { SettingsService } from '../services/settings'
import { writeFileContent } from '../services/file-operations'
import { opencodeServerManager } from '../services/opencode-single-server'
import { logger } from '../utils/logger'
import { withTransactionAsync } from '../db/transactions'
import { getOpenCodeConfigFilePath, getReposPath } from '@opencode-webui/shared'
import path from 'path'

export function createRepoRoutes(database: Database) {
  const app = new Hono()
  
  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const { repoUrl, branch, openCodeConfigName, useWorktree } = body
      
      if (!repoUrl) {
        return c.json({ error: 'repoUrl is required' }, 400)
      }
      
      const repo = await repoService.cloneRepo(
        database,
        repoUrl,
        branch,
        useWorktree
      )
      
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
    } catch (error: any) {
      logger.error('Failed to create repo:', error)
      return c.json({ error: error.message }, 500)
    }
  })
  
  app.get('/', async (c) => {
    try {
      const repos = db.listRepos(database)
      const reposWithCurrentBranch = await Promise.all(
        repos.map(async (repo) => {
          const currentBranch = await repoService.getCurrentBranch(repo)
          return { ...repo, currentBranch }
        })
      )
      return c.json(reposWithCurrentBranch)
    } catch (error: any) {
      logger.error('Failed to list repos:', error)
      return c.json({ error: error.message }, 500)
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
    } catch (error: any) {
      logger.error('Failed to get repo:', error)
      return c.json({ error: error.message }, 500)
    }
  })
  
  app.delete('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      await withTransactionAsync(database, async (db) => {
        await repoService.deleteRepoFiles(db, id)
      })
      
      return c.json({ success: true })
    } catch (error: any) {
      logger.error('Failed to delete repo:', error)
      return c.json({ error: error.message }, 500)
    }
  })
  
  app.post('/:id/pull', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      await repoService.pullRepo(database, id)
      
      const repo = db.getRepoById(database, id)
      return c.json(repo)
    } catch (error: any) {
      logger.error('Failed to pull repo:', error)
      return c.json({ error: error.message }, 500)
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
    } catch (error: any) {
      logger.error('Failed to switch repo config:', error)
      return c.json({ error: error.message }, 500)
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
    } catch (error: any) {
      logger.error('Failed to switch branch:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  app.get('/:id/branches', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const branches = await repoService.listBranches(repo)
      
      return c.json(branches)
    } catch (error: any) {
      logger.error('Failed to list branches:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  app.get('/:id/git/status', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = db.getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const repoPath = path.resolve(getReposPath(), repo.localPath)
      const status = await gitOperations.getGitStatus(repoPath)
      
      return c.json(status)
    } catch (error: any) {
      logger.error('Failed to get git status:', error)
      return c.json({ error: error.message }, 500)
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
      
      const repoPath = path.resolve(getReposPath(), repo.localPath)
      const diff = await gitOperations.getFileDiff(repoPath, filePath)
      
      return c.json(diff)
    } catch (error: any) {
      logger.error('Failed to get file diff:', error)
      return c.json({ error: error.message }, 500)
    }
  })
  
  return app
}
