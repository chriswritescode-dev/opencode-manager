import type { Database } from 'bun:sqlite'
import { openCodeLocation, parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { sanitizeRepoDirectoryName } from '@opencode-manager/shared/utils'
import { getRepoById } from '../db/queries'
import type { Repo } from '../types/repo'
import { getErrorMessage } from '../utils/error-utils'
import type { OpenCodeClient } from './opencode/client'
import { resolveOpenCodeModel, type ResolvedOpenCodeModel } from './opencode-models'
import type { RepoWorkspaceService } from './repo-workspace'

type SessionCreateInput = NonNullable<Parameters<OpenCodeClient['api']['session']['create']>[0]>

interface LaunchSessionInput {
  repoId: number
  prompt: string
  title?: string
  model?: string
  agent?: string
  workspace?: { name?: string; ref?: string }
  permissions?: SessionCreateInput['permissions']
}

export interface LaunchedSession {
  sessionId: string
  repoId: number
  directory: string
  workspaceDirectory: string | null
  model: string
  title: string | null
}

export class SessionLaunchError extends Error {
  readonly status: 400 | 404 | 502
  readonly workspaceDirectory: string | null
  readonly sessionId: string | null

  constructor(
    message: string,
    status: 400 | 404 | 502,
    workspaceDirectory: string | null = null,
    sessionId: string | null = null,
  ) {
    super(message)
    this.name = 'SessionLaunchError'
    this.status = status
    this.workspaceDirectory = workspaceDirectory
    this.sessionId = sessionId
  }
}

function withWorkspace(message: string, workspaceDirectory: string | null): string {
  return workspaceDirectory ? `${message} (workspace: ${workspaceDirectory})` : message
}

export function requireReadyRepo(db: Database, repoId: number): Repo {
  const repo = getRepoById(db, repoId)
  if (!repo || repo.cloneStatus !== 'ready') {
    throw new SessionLaunchError('Repository not found or not ready', 404)
  }
  return repo
}

export class SessionLauncher {
  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly repoWorkspaces: RepoWorkspaceService,
  ) {}

  async resolveModel(repo: Repo, requestedModel?: string): Promise<ResolvedOpenCodeModel> {
    let resolved: ResolvedOpenCodeModel
    try {
      resolved = await resolveOpenCodeModel(this.openCodeClient, repo.fullPath, {
        preferredModel: requestedModel,
      })
    } catch (error) {
      throw new SessionLaunchError(getErrorMessage(error) || 'Failed to resolve OpenCode model', 502)
    }

    if (requestedModel) {
      const requestedRef = parseOpenCodeModelRef(requestedModel)
      if (!requestedRef || resolved.providerID !== requestedRef.providerID || resolved.id !== requestedRef.id) {
        throw new SessionLaunchError(`Model ${requestedModel} is not available`, 400)
      }
    }

    return resolved
  }

  async launch(input: LaunchSessionInput): Promise<LaunchedSession> {
    const repo = requireReadyRepo(this.db, input.repoId)
    const model = await this.resolveModel(repo, input.model)

    let directory = repo.fullPath
    let workspaceDirectory: string | null = null

    if (input.workspace) {
      try {
        const workspace = await this.repoWorkspaces.create(repo, {
          name: sanitizeRepoDirectoryName(input.workspace.name ?? '', 'session'),
          ...(input.workspace.ref ? { ref: input.workspace.ref } : {}),
        })
        directory = workspace.directory
        workspaceDirectory = workspace.directory
      } catch (error) {
        throw new SessionLaunchError(getErrorMessage(error) || 'Failed to create workspace', 502)
      }
    }

    let session: { id: string; title?: string | null }
    try {
      session = await this.openCodeClient.api.session.create({
        ...(input.title ? { title: input.title } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.permissions ? { permissions: input.permissions } : {}),
        model: {
          providerID: model.providerID,
          id: model.id,
          ...(model.variant ? { variant: model.variant } : {}),
        },
        ...openCodeLocation(directory),
      })
    } catch (error) {
      throw new SessionLaunchError(
        withWorkspace(getErrorMessage(error) || 'Failed to create OpenCode session', workspaceDirectory),
        502,
        workspaceDirectory,
      )
    }

    try {
      await this.openCodeClient.api.session.prompt({ sessionID: session.id, text: input.prompt })
    } catch (error) {
      throw new SessionLaunchError(
        withWorkspace(getErrorMessage(error) || 'Failed to create OpenCode session', workspaceDirectory),
        502,
        workspaceDirectory,
        session.id,
      )
    }

    return {
      sessionId: session.id,
      repoId: repo.id,
      directory,
      workspaceDirectory,
      model: model.model,
      title: session.title ?? input.title ?? null,
    }
  }
}
