import type { Database } from 'bun:sqlite'
import { openCodeLocation, parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID, type MultiRunTarget } from '@opencode-manager/shared/schemas'
import { sanitizeRepoDirectoryName } from '@opencode-manager/shared/utils'
import { getRepoById } from '../db/queries'
import type { Repo } from '../types/repo'
import { getErrorMessage } from '../utils/error-utils'
import type { OpenCodeClient } from './opencode/client'
import { resolveOpenCodeModel, type ResolvedOpenCodeModel } from './opencode-models'
import { resolveRepoProjectId } from './repo'
import type { RepoWorkspaceService } from './repo-workspace'

type SessionCreateInput = NonNullable<Parameters<OpenCodeClient['api']['session']['create']>[0]>

interface LaunchSessionCommon {
  prompt: string
  title?: string
  model?: string
  agent?: string
  workspace?: { name?: string; ref?: string }
  permissions?: SessionCreateInput['permissions']
}

export type LaunchSessionInput = LaunchSessionCommon &
  ({ repoId: number } | { serverId: string; directory: string })

export interface LaunchedSession {
  sessionId: string
  repoId: number | null
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

export interface SessionTargetDeps {
  db: Database
  openCodeClient: OpenCodeClient
  repoWorkspaces: RepoWorkspaceService
  getServerClient?: (serverId: string) => OpenCodeClient
}

/**
 * A resolved place to run sessions: the local repository checkout or a directory on a linked
 * OpenCode server. Workspaces and models are resolved through the same client the sessions run on.
 */
export interface ResolvedSessionTarget {
  client: OpenCodeClient
  directory: string
  repo: Repo | null
  resolveModel(requestedModel?: string): Promise<ResolvedOpenCodeModel>
  createWorkspace(options?: { name?: string; ref?: string }): Promise<string>
  removeWorkspace(directory: string): Promise<void>
}

function withWorkspace(message: string, workspaceDirectory: string | null): string {
  return workspaceDirectory ? `${message} (workspace: ${workspaceDirectory})` : message
}

function requireReadyRepo(db: Database, repoId: number): Repo {
  const repo = getRepoById(db, repoId)
  if (!repo || repo.cloneStatus !== 'ready') {
    throw new SessionLaunchError('Repository not found or not ready', 404)
  }
  return repo
}

export function sessionTargetInput(
  target: MultiRunTarget,
): { repoId: number } | { serverId: string; directory: string } {
  return target.kind === 'repo'
    ? { repoId: target.repoId }
    : { serverId: target.serverId, directory: target.directory }
}

export function sessionTargetOfRun(run: {
  repoId: number | null
  serverId: string
  directory: string | null
}): MultiRunTarget | null {
  if (run.repoId !== null) {
    return { kind: 'repo', repoId: run.repoId }
  }
  if (run.serverId === LOCAL_OPENCODE_SERVER_ID || run.directory === null) {
    return null
  }
  return { kind: 'server', serverId: run.serverId, directory: run.directory }
}

async function resolveModelIn(
  client: OpenCodeClient,
  directory: string,
  requestedModel?: string,
): Promise<ResolvedOpenCodeModel> {
  let resolved: ResolvedOpenCodeModel
  try {
    resolved = await resolveOpenCodeModel(client, directory, { preferredModel: requestedModel })
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

function repoSessionTarget(deps: SessionTargetDeps, repoId: number): ResolvedSessionTarget {
  const repo = requireReadyRepo(deps.db, repoId)
  const client = deps.openCodeClient

  return {
    client,
    directory: repo.fullPath,
    repo,
    resolveModel: (requestedModel) => resolveModelIn(client, repo.fullPath, requestedModel),
    createWorkspace: async (options) => (await deps.repoWorkspaces.create(repo, options)).directory,
    removeWorkspace: (directory) => deps.repoWorkspaces.remove(repo, directory),
  }
}

function serverSessionTarget(
  deps: SessionTargetDeps,
  serverId: string,
  directory: string,
): ResolvedSessionTarget {
  if (!deps.getServerClient) {
    throw new SessionLaunchError('Remote OpenCode servers are not available', 400)
  }

  const client = deps.getServerClient(serverId)

  return {
    client,
    directory,
    repo: null,
    resolveModel: (requestedModel) => resolveModelIn(client, directory, requestedModel),
    createWorkspace: async (options) => {
      const projectID = await resolveRepoProjectId(client, directory)
      const worktree = await client.api.worktree.create({
        projectID,
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.ref ? { branch: options.ref } : {}),
      })
      return worktree.directory
    },
    removeWorkspace: async (workspaceDirectory) => {
      const projectID = await resolveRepoProjectId(client, directory)
      await client.api.worktree.remove({ projectID, directory: workspaceDirectory, force: true })
    },
  }
}

export async function resolveSessionTarget(
  deps: SessionTargetDeps,
  target: MultiRunTarget,
): Promise<ResolvedSessionTarget> {
  return target.kind === 'repo'
    ? repoSessionTarget(deps, target.repoId)
    : serverSessionTarget(deps, target.serverId, target.directory)
}

export class SessionLauncher {
  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly repoWorkspaces: RepoWorkspaceService,
    private readonly getServerClient?: (serverId: string) => OpenCodeClient,
  ) {}

  async launch(input: LaunchSessionInput): Promise<LaunchedSession> {
    const target = await resolveSessionTarget(
      {
        db: this.db,
        openCodeClient: this.openCodeClient,
        repoWorkspaces: this.repoWorkspaces,
        ...(this.getServerClient ? { getServerClient: this.getServerClient } : {}),
      },
      'repoId' in input
        ? { kind: 'repo', repoId: input.repoId }
        : { kind: 'server', serverId: input.serverId, directory: input.directory },
    )
    const model = await target.resolveModel(input.model)

    let directory = target.directory
    let workspaceDirectory: string | null = null

    if (input.workspace) {
      try {
        directory = await target.createWorkspace({
          name: sanitizeRepoDirectoryName(input.workspace.name ?? '', 'session'),
          ...(input.workspace.ref ? { ref: input.workspace.ref } : {}),
        })
        workspaceDirectory = directory
      } catch (error) {
        throw new SessionLaunchError(getErrorMessage(error) || 'Failed to create workspace', 502)
      }
    }

    let session: { id: string; title?: string | null }
    try {
      session = await target.client.api.session.create({
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
      await target.client.api.session.prompt({ sessionID: session.id, text: input.prompt })
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
      repoId: target.repo?.id ?? null,
      directory,
      workspaceDirectory,
      model: model.model,
      title: session.title ?? input.title ?? null,
    }
  }
}
