import type { Database } from 'bun:sqlite'
import type { FileDiffInfo, SessionInfo } from '@opencode-manager/shared/opencode'
import {
  ChangeSourceSchema,
  DEFAULT_CHANGE_SOURCE,
  describeChangeSource,
  type ChangeSource,
  type OutputParams,
} from '@opencode-manager/shared/schemas'
import { getErrorMessage } from '../../utils/error-utils'
import type { GitAuthService } from '../git-auth'
import type { GitService } from '../git/GitService'
import type { OpenCodeClient } from '../opencode/client'
import { resolveRepoForDirectory } from '../repo'
import {
  buildChangesInput,
  computeChangesHash,
  formatChangedFile,
  formatChangesOutline,
} from './change-outline'
import { deletePullRequestRef, fetchPullRequestRef, readChanges } from './change-sources'
import { OutputError } from './output-error'

export interface OutputProviderFormatContext {
  title: string
  sourceDescription: string
}

export interface OutputProvider {
  prepare(session: SessionInfo, params: OutputParams): Promise<void>
  read(session: SessionInfo, params: OutputParams): Promise<FileDiffInfo[]>
  hash(input: FileDiffInfo[]): string
  assertUsable(input: FileDiffInfo[], params: OutputParams): void
  format(input: FileDiffInfo[], context: OutputProviderFormatContext, file?: string): string
  cacheable(params: OutputParams): boolean
  deleteSessionRefs(sessionId: string): void
}

function sourceChangesVerb(source: ChangeSource): string {
  return source.kind === 'branch' || source.kind === 'pullRequest' ? 'contains' : 'contain'
}

function noChangesMessage(source: ChangeSource): string {
  if (source.kind === 'session') {
    return 'This session has no changes to walk through'
  }
  return `The ${describeChangeSource(source)} ${sourceChangesVerb(source)} no changes to walk through`
}

function noTextChangesMessage(source: ChangeSource): string {
  if (source.kind === 'session') {
    return 'This session has no text changes to walk through'
  }
  return `The ${describeChangeSource(source)} ${sourceChangesVerb(source)} no text changes`
}

export class ChangesOutputProvider implements OutputProvider {
  private readonly pullRequestRefs = new Map<string, Set<string>>()

  constructor(
    private readonly openCodeClient: OpenCodeClient,
    private readonly gitAuthService: GitAuthService,
    private readonly gitService: GitService,
    private readonly db: Database,
  ) {}

  async prepare(session: SessionInfo, params: OutputParams): Promise<void> {
    const source = this.resolveSource(params)
    if (source.kind !== 'pullRequest') {
      return
    }

    const directory = session.location.directory
    const repo = await resolveRepoForDirectory(this.db, directory)
    const target = repo
      ? { id: repo.id, repoUrl: repo.repoUrl, fullPath: repo.fullPath }
      : { fullPath: directory }
    const refs = await fetchPullRequestRef(
      directory,
      session.id,
      source,
      this.gitAuthService.getGitEnvironment(true),
      (remote, refspecs, timeoutMs) =>
        this.gitService.fetchRemoteRef(target, remote, refspecs, this.db, timeoutMs),
    )
    for (const ref of refs) {
      this.recordPullRequestRef(session.id, directory, ref)
    }
  }

  async read(session: SessionInfo, params: OutputParams): Promise<FileDiffInfo[]> {
    try {
      return await readChanges({
        client: this.openCodeClient,
        session,
        source: this.resolveSource(params),
        gitEnv: this.gitAuthService.getGitEnvironment(true),
      })
    } catch (error) {
      if (error instanceof OutputError) {
        throw error
      }
      throw new OutputError(getErrorMessage(error) || 'Failed to read session changes', 502, {
        code: 'OUTPUT_CHANGES_UNAVAILABLE',
      })
    }
  }

  hash(input: FileDiffInfo[]): string {
    return computeChangesHash(input)
  }

  assertUsable(input: FileDiffInfo[], params: OutputParams): void {
    const source = this.resolveSource(params)
    if (input.length === 0) {
      throw new OutputError(noChangesMessage(source), 409, {
        code: 'OUTPUT_NO_CHANGES',
      })
    }
    const changes = buildChangesInput(input)
    if (changes.hunks.length === 0 && changes.mechanicalHunks.length === 0) {
      throw new OutputError(noTextChangesMessage(source), 409, {
        code: 'OUTPUT_NO_TEXT_CHANGES',
      })
    }
  }

  format(input: FileDiffInfo[], context: OutputProviderFormatContext, file?: string): string {
    if (file === undefined) {
      return formatChangesOutline({
        title: context.title,
        sourceDescription: context.sourceDescription,
        changes: input,
      })
    }

    const text = formatChangedFile(input, file)
    if (text === null) {
      throw new OutputError(`The file is not part of the changes: ${file}`, 404, {
        code: 'OUTPUT_FILE_NOT_CHANGED',
      })
    }
    return text
  }

  cacheable(params: OutputParams): boolean {
    return this.resolveSource(params).kind === 'session'
  }

  deleteSessionRefs(sessionId: string): void {
    const entries = this.pullRequestRefs.get(sessionId)
    if (!entries) {
      return
    }
    this.pullRequestRefs.delete(sessionId)
    const gitEnv = this.gitAuthService.getGitEnvironment(true)
    for (const entry of entries) {
      const separator = entry.indexOf('\0')
      const directory = entry.slice(0, separator)
      const ref = entry.slice(separator + 1)
      void deletePullRequestRef(directory, ref, gitEnv).catch(() => {})
    }
  }

  private resolveSource(params: OutputParams): ChangeSource {
    for (const value of Object.values(params)) {
      const parsed = ChangeSourceSchema.safeParse(value)
      if (parsed.success) {
        return parsed.data
      }
    }
    return DEFAULT_CHANGE_SOURCE
  }

  private recordPullRequestRef(sessionId: string, directory: string, ref: string): void {
    const entry = `${directory}\0${ref}`
    const existing = this.pullRequestRefs.get(sessionId)
    if (existing) {
      existing.add(entry)
      return
    }
    this.pullRequestRefs.set(sessionId, new Set([entry]))
  }
}
