import { Hono } from 'hono'
import { z } from 'zod'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { DiscoverReposRequestSchema, AssistantModeInitRequestSchema, UpdateRepoRequestSchema } from '@opencode-manager/shared/schemas'
import { listRepos, getRepoById, updateLastAccessed, getRepoGitCredentialId, setRepoGitCredentialId, updateRepoName } from '../db/queries'
import * as repoService from '../services/repo'
import * as archiveService from '../services/archive'
import { SettingsService } from '../services/settings'
import type { OpenCodeClient } from '../services/opencode/client'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'
import { handleOpenCodeError } from '../utils/route-helpers'
import { ASSISTANT_REPO_ID, isWorktreeSibling } from '@opencode-manager/shared/utils'
import { isWorktreeError, openCodeLocation } from '@opencode-manager/shared/opencode'
import { createRepoGitRoutes } from './repo-git'
import { createScheduleRoutes } from './schedules'
import type { GitAuthService } from '../services/git-auth'
import { ScheduleService } from '../services/schedules'
import { ensureAssistantMode, getAssistantModeStatus, buildAssistantRepo } from '../services/assistant-mode'
import { canonicalPathSync } from '../utils/fs-safe'
import path from 'path'

function resolveRepo(database: Database, id: number): Repo | null {
  return getRepoById(database, id) ?? (id === ASSISTANT_REPO_ID ? buildAssistantRepo() : null)
}

const DeleteWorkspaceRequestSchema = z.object({
  directory: z.string().trim().min(1),
})

function withRepoSettings(database: Database, repo: Repo): Repo {
  return {
    ...repo,
    gitCredentialId: getRepoGitCredentialId(database, repo.id) ?? undefined,
  }
}

export function createRepoRoutes(
  database: Database,
  gitAuthService: GitAuthService,
  scheduleService: ScheduleService,
  openCodeClient: OpenCodeClient,
) {
  const app = new Hono()

  app.route('/', createRepoGitRoutes(database, gitAuthService))
  app.route('/:id/schedules', createScheduleRoutes(scheduleService))

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const { repoUrl, localPath, branch, directoryName, useWorktree, skipSSHVerification, provider, baseBranch } = body

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
          return { ...withRepoSettings(database, repo), currentBranch }
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
      
      return c.json({ ...withRepoSettings(database, repo), currentBranch })
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

  app.patch('/:id/git-credential', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      const repo = getRepoById(database, id)

      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }

      const body = await c.req.json()
      const credentialId = typeof body.credentialId === 'string' && body.credentialId.trim() !== ''
        ? body.credentialId.trim()
        : null

      if (credentialId) {
        const settingsService = new SettingsService(database)
        const settings = settingsService.getSettings()
        if (!(settings.preferences.gitCredentials || []).some((credential) => credential.id === credentialId)) {
          return c.json({ error: 'Credential not found' }, 400)
        }
      }

      setRepoGitCredentialId(database, id, credentialId)
      return c.json(withRepoSettings(database, repo))
    } catch (error: unknown) {
      logger.error('Failed to update repo git credential:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.patch('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (Number.isNaN(id)) return c.json({ error: 'Invalid repo id' }, 400)
      if (id === ASSISTANT_REPO_ID) {
        return c.json({ error: 'Assistant repository cannot be renamed' }, 400)
      }
      const repo = getRepoById(database, id)
      if (!repo) {
        return c.json({ error: 'Repo not found' }, 404)
      }
      const body = await c.req.json()
      const parsed = UpdateRepoRequestSchema.safeParse(body)
      if (!parsed.success) {
        return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)
      }
      const trimmed = parsed.data.name?.trim()
      updateRepoName(database, id, trimmed && trimmed.length > 0 ? trimmed : null)
      const updated = getRepoById(database, id)
      return c.json(withRepoSettings(database, updated ?? repo))
    } catch (error: unknown) {
      logger.error('Failed to rename repo:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.delete('/:id/workspaces', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (Number.isNaN(id)) return c.json({ error: 'Invalid repo id' }, 400)

      const repo = getRepoById(database, id)
      if (!repo || repo.cloneStatus !== 'ready') return c.json({ error: 'Repo not found' }, 404)

      const body = await c.req.json().catch(() => null)
      const parsed = DeleteWorkspaceRequestSchema.safeParse(body)
      if (!parsed.success) return c.json({ error: 'directory is required' }, 400)
      const directory = parsed.data.directory

      const siblings = await repoService.getSiblingRepos(database, id, gitAuthService.getGitEnvironment(), openCodeClient)
      const requestedDirectory = canonicalPathSync(path.resolve(directory))
      const worktree = siblings.find(
        (sibling) => isWorktreeSibling(sibling) && canonicalPathSync(path.resolve(sibling.fullPath)) === requestedDirectory,
      )
      if (!worktree) return c.json({ error: 'Not a deletable worktree of this repo' }, 400)

      try {
        const projectID = await repoService.resolveRepoProjectId(openCodeClient, repo.fullPath)
        await openCodeClient.api.worktree.remove({ projectID, directory: worktree.fullPath, force: true })
      } catch (error: unknown) {
        if (isWorktreeError(error)) {
          return c.json({ error: error.data.message }, 409)
        }
        throw error
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

      try {
        const projectID = await repoService.resolveRepoProjectId(openCodeClient, repo.fullPath)
        const worktree = await openCodeClient.api.worktree.create({ projectID })
        return c.json(worktree)
      } catch (error: unknown) {
        if (isWorktreeError(error)) {
          return c.json({ error: error.data.message }, 409)
        }
        logger.error('Failed to create workspace:', error)
        return c.json({ error: getErrorMessage(error) }, 500)
      }
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

      const location = await openCodeClient.api.location.get(openCodeLocation(repo.fullPath))
      const savedPermissions = await openCodeClient.api.permission.saved.list({ projectID: location.project.id })

      for (const permission of savedPermissions) {
        await openCodeClient.api.permission.saved.remove({ id: permission.id })
      }

      logger.info(`Reset permissions for repo ${id} (${repo.fullPath}): removed ${savedPermissions.length}`)
      return c.json({ removed: savedPermissions.length })
    } catch (error: unknown) {
      logger.error('Failed to reset permissions:', error)
      return handleOpenCodeError(c, error, 'Failed to reset permissions')
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

      const status = await ensureAssistantMode(repo, options)
      return c.json(status)
    } catch (error: unknown) {
      logger.error('Failed to initialize assistant mode:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })
  
  return app
}
