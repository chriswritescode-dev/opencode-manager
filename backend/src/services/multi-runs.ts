import type { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import type { FuseMultiRunRequest, LaunchMultiRunRequest, MultiRun } from '@opencode-manager/shared/schemas'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import {
  createMultiRunWithEntries,
  getMultiRun,
  getMultiRunEntry,
  getMultiRunFusionByRequest,
  insertMultiRunFusion,
  listMultiRuns,
  updateMultiRunEntry,
  updateMultiRunFusion,
  type MultiRunEntryRecord,
  type MultiRunFusionRecord,
  type MultiRunRecord,
} from '../db/multi-runs'
import { getRepoById } from '../db/queries'
import type { Repo } from '../types/repo'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { ServiceError } from '../utils/service-error'
import { buildFusionPrompt, buildFusionSourcePermissionRuleset, collectFusionSources } from './multi-run-fusion'
import type { OpenCodeClient } from './opencode/client'
import { RepoWorkspaceError } from './repo'
import type { RepoWorkspaceService } from './repo-workspace'
import { requireReadyRepo, SessionLauncher, SessionLaunchError, type LaunchedSession } from './session-launcher'
import type { SessionPermissionModeService } from './session-permission-modes'

const MULTI_RUN_LIST_LIMIT = 20

export class MultiRunError extends ServiceError {}

function toMultiRun(record: MultiRunRecord): MultiRun {
  return {
    id: record.id,
    repoId: record.repoId,
    name: record.name,
    prompt: record.prompt,
    isolated: record.isolated,
    baseRef: record.baseRef,
    createdAt: record.createdAt,
    entries: record.entries.map((entry) => ({
      id: entry.id,
      model: entry.model,
      status: entry.status,
      sessionId: entry.sessionId,
      directory: entry.directory,
      isolated: entry.isolated,
      error: entry.error,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
    fusions: record.fusions.map((fusion) => ({
      id: fusion.id,
      requestId: fusion.requestId,
      model: fusion.model,
      instructions: fusion.instructions,
      isolated: fusion.isolated,
      baseRef: fusion.baseRef,
      status: fusion.status,
      sessionId: fusion.sessionId,
      directory: fusion.directory,
      error: fusion.error,
      sources: fusion.sources,
      createdAt: fusion.createdAt,
      updatedAt: fusion.updatedAt,
    })),
  }
}

export class MultiRunService {
  private readonly sessionLauncher: SessionLauncher
  private readonly discardingEntries = new Set<number>()

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly repoWorkspaces: RepoWorkspaceService,
    private readonly permissionModes: SessionPermissionModeService,
  ) {
    this.sessionLauncher = new SessionLauncher(db, openCodeClient, repoWorkspaces)
  }

  async launch(request: LaunchMultiRunRequest): Promise<MultiRun> {
    let repo: Repo
    try {
      repo = requireReadyRepo(this.db, request.repoId)
    } catch (error) {
      throw new MultiRunError(getErrorMessage(error) || 'Repository unavailable', 404)
    }

    const record = createMultiRunWithEntries(
      this.db,
      {
        repoId: request.repoId,
        name: request.name,
        prompt: request.prompt,
        isolated: request.isolate,
        baseRef: request.baseRef ?? null,
      },
      request.models,
    )

    const validations = await Promise.all(
      record.entries.map(async (entry) => {
        try {
          await this.sessionLauncher.resolveModel(repo, entry.model)
          return { entry, ok: true as const }
        } catch (error) {
          return { entry, ok: false as const, error }
        }
      }),
    )

    const launchable: Array<{ entry: MultiRunEntryRecord; index: number }> = []
    validations.forEach((validation, index) => {
      if (validation.ok) {
        launchable.push({ entry: validation.entry, index })
        return
      }

      updateMultiRunEntry(this.db, validation.entry.id, ['starting'], {
        status: 'failed',
        error: getErrorMessage(validation.error) || 'Failed to launch session',
      })
    })

    const results = await Promise.allSettled(
      launchable.map(({ entry, index }) => this.launchEntry(entry, index, request)),
    )

    results.forEach((result, resultIndex) => {
      const launch = launchable[resultIndex]
      if (!launch) {
        return
      }

      if (result.status === 'fulfilled') {
        updateMultiRunEntry(this.db, launch.entry.id, ['starting'], {
          status: 'started',
          sessionId: result.value.sessionId,
          directory: result.value.directory,
        })
        return
      }

      const launchError = result.reason instanceof SessionLaunchError ? result.reason : null
      const workspaceDirectory = launchError?.workspaceDirectory ?? null
      updateMultiRunEntry(this.db, launch.entry.id, ['starting'], {
        status: 'failed',
        error: getErrorMessage(result.reason) || 'Failed to launch session',
        ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
        ...(launchError?.sessionId ? { sessionId: launchError.sessionId } : {}),
      })
    })

    return this.reload(record.id)
  }

  async fuse(multiRunId: number, request: FuseMultiRunRequest): Promise<{ run: MultiRun; created: boolean }> {
    const record = getMultiRun(this.db, multiRunId)
    if (!record) {
      throw new MultiRunError('Multi-run not found', 404)
    }

    if (getMultiRunFusionByRequest(this.db, multiRunId, request.requestId)) {
      return { run: this.reload(multiRunId), created: false }
    }

    if (record.repoId === ASSISTANT_REPO_ID) {
      throw new MultiRunError('Fusion needs a Git repository because it always runs in a new worktree.', 409, {
        code: 'FUSION_REQUIRES_GIT_REPOSITORY',
      })
    }

    let repo: Repo
    try {
      repo = requireReadyRepo(this.db, record.repoId)
    } catch (error) {
      throw new MultiRunError(getErrorMessage(error) || 'Repository unavailable', 404)
    }

    const entriesById = new Map(record.entries.map((entry) => [entry.id, entry]))
    const selectedEntries = request.entryIds.map((entryId) => {
      const entry = entriesById.get(entryId)
      if (!entry) {
        throw new MultiRunError(`Unknown multi-run entry ${entryId}`, 400)
      }
      return entry
    })

    const sourcePermissions = buildFusionSourcePermissionRuleset(
      selectedEntries
        .map((entry) => entry.directory)
        .filter((directory): directory is string => directory !== null),
    )

    try {
      await this.sessionLauncher.resolveModel(repo, request.model)
    } catch (error) {
      if (error instanceof SessionLaunchError) {
        throw new MultiRunError(error.message, error.status)
      }
      throw new MultiRunError(getErrorMessage(error) || 'Failed to resolve model', 502)
    }

    await this.reconcileUncertainFusions(record)

    const collection = await collectFusionSources(this.openCodeClient, selectedEntries)
    if (collection.unavailable.length > 0) {
      throw new MultiRunError('Some selected results are not ready to fuse', 409, {
        code: 'FUSION_SOURCES_UNAVAILABLE',
        details: { unavailableSources: collection.unavailable },
      })
    }

    const built = buildFusionPrompt({
      runName: record.name,
      objective: record.prompt,
      instructions: request.instructions,
      sources: collection.ready,
    })

    const { fusion, created } = insertMultiRunFusion(this.db, {
      multiRunId,
      requestId: request.requestId,
      model: request.model,
      instructions: request.instructions ?? null,
      isolated: true,
      baseRef: request.baseRef ?? null,
      sources: built.sources,
    })

    if (!created) {
      return { run: this.reload(multiRunId), created: false }
    }

    let launched: LaunchedSession | null = null
    try {
      launched = await this.sessionLauncher.launch({
        repoId: record.repoId,
        prompt: built.prompt,
        model: request.model,
        title: `${record.name} · fusion`,
        ...(request.agent ? { agent: request.agent } : {}),
        permissions: sourcePermissions,
        workspace: {
          name: `${record.name}-fusion-${fusion.id}`,
          ...(request.baseRef ? { ref: request.baseRef } : {}),
        },
      })

      updateMultiRunFusion(this.db, fusion.id, ['starting'], {
        status: 'started',
        sessionId: launched.sessionId,
        directory: launched.directory,
      })
    } catch (error) {
      const launchError = error instanceof SessionLaunchError ? error : null
      const workspaceDirectory = launchError?.workspaceDirectory ?? null
      updateMultiRunFusion(this.db, fusion.id, ['starting'], {
        status: 'failed',
        error: getErrorMessage(error) || 'Failed to launch session',
        ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
        ...(launchError?.sessionId ? { sessionId: launchError.sessionId } : {}),
      })
    }

    if (launched) {
      try {
        await this.permissionModes.applyDefaultMode(launched.sessionId, launched.directory)
      } catch (error) {
        logger.error(`Failed to apply the default permission mode to fusion session ${launched.sessionId}:`, error)
      }
    }

    return { run: this.reload(multiRunId), created: true }
  }

  list(repoId: number): MultiRun[] {
    return listMultiRuns(this.db, repoId, MULTI_RUN_LIST_LIMIT).map(toMultiRun)
  }

  async discard(multiRunId: number, entryId: number): Promise<MultiRun> {
    const record = getMultiRun(this.db, multiRunId)
    if (!record) {
      throw new MultiRunError('Multi-run not found', 404)
    }

    const entry = getMultiRunEntry(this.db, multiRunId, entryId)
    if (!entry) {
      throw new MultiRunError('Multi-run entry not found', 404)
    }

    if (entry.status !== 'started' && entry.status !== 'failed') {
      throw new MultiRunError('Multi-run entry cannot be discarded from its current state', 409)
    }

    if (this.discardingEntries.has(entryId)) {
      throw new MultiRunError('Multi-run entry discard already in progress', 409)
    }
    this.discardingEntries.add(entryId)

    try {
      if (entry.isolated && entry.directory && existsSync(entry.directory)) {
        const repo = getRepoById(this.db, record.repoId)
        if (!repo) {
          throw new MultiRunError('Repository not found', 404)
        }

        try {
          await this.repoWorkspaces.remove(repo, entry.directory)
        } catch (error) {
          const status = error instanceof RepoWorkspaceError ? error.status : 502
          throw new MultiRunError(getErrorMessage(error) || 'Failed to remove workspace', status)
        }
      }

      const updated = updateMultiRunEntry(this.db, entryId, ['started', 'failed'], { status: 'discarded' })
      if (!updated) {
        throw new MultiRunError('Multi-run entry cannot be discarded from its current state', 409)
      }

      return this.reload(multiRunId)
    } finally {
      this.discardingEntries.delete(entryId)
    }
  }

  private async launchEntry(
    entry: MultiRunEntryRecord,
    index: number,
    request: LaunchMultiRunRequest,
  ): Promise<LaunchedSession> {
    return this.sessionLauncher.launch({
      repoId: request.repoId,
      prompt: request.prompt,
      model: entry.model,
      title: `${request.name} · ${entry.model}`,
      ...(request.agent ? { agent: request.agent } : {}),
      ...(request.isolate
        ? { workspace: { name: `${request.name}-${index + 1}`, ...(request.baseRef ? { ref: request.baseRef } : {}) } }
        : {}),
    })
  }

  private async reconcileUncertainFusions(record: MultiRunRecord): Promise<void> {
    const uncertain = record.fusions.filter(
      (fusion): fusion is MultiRunFusionRecord & { sessionId: string } =>
        fusion.status === 'failed' && fusion.sessionId !== null,
    )
    if (uncertain.length === 0) {
      return
    }

    const recovered = (
      await Promise.all(
        uncertain.map(async (fusion) => {
          try {
            const response = await this.openCodeClient.api.message.list({
              sessionID: fusion.sessionId,
              type: 'user',
              order: 'asc',
              limit: 1,
            })
            if (response.data.length === 0) {
              return null
            }
          } catch {
            return null
          }

          updateMultiRunFusion(this.db, fusion.id, ['failed'], { status: 'started', error: null })
          return { fusionId: fusion.id, sessionId: fusion.sessionId }
        }),
      )
    ).filter((entry): entry is { fusionId: number; sessionId: string } => entry !== null)

    if (recovered.length > 0) {
      throw new MultiRunError('An earlier fusion attempt is already running', 409, {
        code: 'FUSION_ATTEMPT_RECOVERED',
        details: { fusions: recovered },
      })
    }
  }

  private reload(multiRunId: number): MultiRun {
    const record = getMultiRun(this.db, multiRunId)
    if (!record) {
      throw new MultiRunError('Multi-run not found', 404)
    }
    return toMultiRun(record)
  }
}
