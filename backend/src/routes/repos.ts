import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { DiscoverReposRequestSchema, AssistantModeInitRequestSchema } from '@opencode-manager/shared/schemas'
import { listRepos, getRepoById, updateLastAccessed, updateRepoConfigName } from '../db/queries'
import * as repoService from '../services/repo'
import * as archiveService from '../services/archive'
import { SettingsService } from '../services/settings'
import { writeFileContent } from '../services/file-operations'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import type { OpenCodeClient } from '../services/opencode/client'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'
import { getOpenCodeConfigFilePath } from '@opencode-manager/shared/config/env'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { createRepoGitRoutes } from './repo-git'
import { createScheduleRoutes } from './schedules'
import type { GitAuthService } from '../services/git-auth'
import { ScheduleService } from '../services/schedules'
import { ensureAssistantMode, getAssistantModeStatus, buildAssistantRepo } from '../services/assistant-mode'
import path from 'path'

async function restartOpenCode(openCodeSupervisor?: OpenCodeSupervisor): Promise<void> {
  if (openCodeSupervisor) {
    await openCodeSupervisor.restart('settings_restart')
    return
  }

  opencodeServerManager.clearStartupError()
  await opencodeServerManager.restart()
}

function resolveRepo(database: Database, id: number): Repo | null {
  return getRepoById(database, id) ?? (id === ASSISTANT_REPO_ID ? buildAssistantRepo() : null)
}

export function createRepoRoutes(
  database: Database,
  gitAuthService: GitAuthService,
  scheduleService: ScheduleService,
  openCodeClient: OpenCodeClient,
  openCodeSupervisor?: OpenCodeSupervisor,
) {
  const app = new Hono()

  app.route('/', createRepoGitRoutes(database, gitAuthService))
  app.route('/:id/schedules', createScheduleRoutes(scheduleService))

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const { repoUrl, localPath, branch, directoryName, openCodeConfigName, useWorktree, skipSSHVerification, provider, baseBranch } = body

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
          { branch, directoryName, useWorktree, skipSSHVerification, baseBranch }
        )
      }
      
      if (openCodeConfigName) {
        const settingsService = new SettingsService(database)
        const configContent = settingsService.getOpenCodeConfigContent(openCodeConfigName)
        
        if (configContent) {
          const openCodeConfigPath = getOpenCodeConfigFilePath()
          await writeFileContent(openCodeConfigPath, configContent)
          updateRepoConfigName(database, repo.id, openCodeConfigName)
          logger.info(`Applied config '${openCodeConfigName}' to: ${openCodeConfigPath}`)
        }
      }
      
      return c.json(repo)
    } catch (error: unknown) {
      logger.error('Failed to create repo:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  app.post('/discover', async (c) => {
    try {
      const body = await c.req.json()
      const result = DiscoverReposRequestSchema.safeParse(body)

      if (!result.success) {
        return c.json({ error: result.error.issues[0]?.message || 'Invalid request' }, 400)
      }

      const discovery = await repoService.discoverLocalRepos(
        database,
        gitAuthService,
        result.data.rootPath,
        result.data.maxDepth
      )

      return c.json(discovery)
    } catch (error: unknown) {
      logger.error('Failed to discover repos:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

app.get('/', async (c) => {
    try {
      const settingsService = new SettingsService(database)
      const settings = settingsService.getSettings()
      const repos = listRepos(database, settings.preferences.repoOrder)

      const reposWithCurrentBranch = await Promise.all(
        repos.map(async (repo) => {
          const env = gitAuthService.getGitEnvironment()
          const currentBranch = repo.id === ASSISTANT_REPO_ID ? undefined : await repoService.getCurrentBranch(repo, env)
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

      const repo: Repo | null = resolveRepo(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const currentBranch = id === ASSISTANT_REPO_ID ? undefined : await repoService.getCurrentBranch(repo, gitAuthService.getGitEnvironment())
      
      return c.json({ ...repo, currentBranch })
    } catch (error: unknown) {
      logger.error('Failed to get repo:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.get('/:id/siblings', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (Number.isNaN(id)) return c.json({ error: 'Invalid repo id' }, 400)
      const siblings = await repoService.getSiblingRepos(
        database,
        id,
        gitAuthService.getGitEnvironment(),
        openCodeClient,
      )
      return c.json(siblings)
    } catch (error: unknown) {
      logger.error('Failed to list sibling repos:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/access', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      updateLastAccessed(database, id)
      
      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to update repo access:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.delete('/:id/workspaces/:workspaceId', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (Number.isNaN(id)) return c.json({ error: 'Invalid repo id' }, 400)

      const repo = getRepoById(database, id)
      if (!repo || repo.cloneStatus !== 'ready') return c.json({ error: 'Repo not found' }, 404)

      const workspaceId = c.req.param('workspaceId')
      if (!workspaceId.startsWith('wrk')) return c.json({ error: 'Invalid workspace id' }, 400)

      const response = await openCodeClient.forward({
        method: 'DELETE',
        path: `/experimental/workspace/${encodeURIComponent(workspaceId)}`,
        directory: repo.fullPath,
      })

      if (!response.ok) {
        return c.json({ error: await response.text() || 'Failed to delete workspace' }, response.status as ContentfulStatusCode)
      }

      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to delete workspace:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/workspaces', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (Number.isNaN(id)) return c.json({ error: 'Invalid repo id' }, 400)

      const repo = getRepoById(database, id)
      if (!repo || repo.cloneStatus !== 'ready') return c.json({ error: 'Repo not found' }, 404)

      const response = await openCodeClient.forward({
        method: 'POST',
        path: '/experimental/workspace',
        directory: repo.fullPath,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'worktree', branch: null }),
      })

      const body = await response.text()
      if (!response.ok) {
        return c.json({ error: body || 'Failed to create workspace' }, response.status as ContentfulStatusCode)
      }

      return c.json(body ? JSON.parse(body) : { success: true })
    } catch (error: unknown) {
      logger.error('Failed to create workspace:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))

      if (id === ASSISTANT_REPO_ID) {
        return c.json({ error: 'Cannot delete the assistant repository' }, 403)
      }

      const repo = getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      scheduleService.prepareRepoDelete(id)
      
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
      
      const repo = getRepoById(database, id)
      return c.json(repo)
    } catch (error: unknown) {
      logger.error('Failed to pull repo:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/config/switch', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = getRepoById(database, id)
      
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
      
      updateRepoConfigName(database, id, configName)
      
      logger.info(`Switched config for repo ${id} to '${configName}'`)
      logger.info(`Updated OpenCode config: ${openCodeConfigPath}`)
      
      logger.info('Restarting OpenCode server due to workspace config change')
      await restartOpenCode(openCodeSupervisor)
      
      const updatedRepo = getRepoById(database, id)
      return c.json(updatedRepo)
    } catch (error: unknown) {
      logger.error('Failed to switch repo config:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/branch/switch', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const body = await c.req.json()
      const { branch } = body
      
      if (!branch) {
        return c.json({ error: 'branch is required' }, 400)
      }
      
      await repoService.switchBranch(database, gitAuthService, id, branch)
      
      const updatedRepo = getRepoById(database, id)
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
      const repo = getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      
      const body = await c.req.json()
      const { branch } = body
      
      if (!branch) {
        return c.json({ error: 'branch is required' }, 400)
      }
      
      await repoService.createBranch(database, gitAuthService, id, branch)
      
      const updatedRepo = getRepoById(database, id)
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
      const repo = getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const repoPath = repo.fullPath
      const repoName = path.basename(repo.fullPath)

      const includeGit = c.req.query('includeGit') === 'true'
      const includePathsParam = c.req.query('includePaths')
      const includePaths = includePathsParam ? includePathsParam.split(',').map(p => p.trim()) : undefined

      const options: import('../services/archive').ArchiveOptions = {
        includeGit,
        includePaths
      }

      logger.info(`Starting archive creation for repo ${id}: ${repoPath}`)
      const archivePath = await archiveService.createRepoArchive(repoPath, options)
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
      const repo = getRepoById(database, id)
      
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      if (!repo.fullPath) {
        return c.json({ error: 'Repo has no directory to reset' }, 400)
      }

      const response = await openCodeClient.forward({
        method: 'POST',
        path: '/instance/dispose',
        directory: repo.fullPath,
      })
      
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

  app.get('/:id/assistant-mode', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))

      const repo: Repo | null = resolveRepo(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const status = await getAssistantModeStatus(repo)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to get assistant mode status:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/assistant-mode', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))

      const repo: Repo | null = resolveRepo(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json().catch(() => ({}))
      const options = AssistantModeInitRequestSchema.parse(body)
      const protocol = c.req.header('x-forwarded-proto') || 'http'
      const host = c.req.header('host') || 'localhost:5003'
      const apiBaseUrl = `${protocol}://${host}/api/internal`

      const status = await ensureAssistantMode(repo, { db: database, apiBaseUrl }, options)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to initialize assistant mode:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })
  
  return app
}
