import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import {
  ProjectActionSchema,
  RepoProjectFileSchema,
  WorktreeSetupCommandsSchema,
  type MoveProjectItemRequest,
  type ProjectAction,
  type ProjectConfigResponse,
  type RepoProjectFile,
  type RunProjectActionResponse,
  type WorktreeSetupResult,
} from '@opencode-manager/shared/schemas'
import { isRunningActionTerminal } from '@opencode-manager/shared/utils'
import { getRepoByDirectory, getRepoSetting, setRepoSetting } from '../db/queries'
import { executeCommand } from '../utils/process'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { canonicalPathSync, writeFileAtomicSync } from '../utils/fs-safe'
import type { GitService } from './git/GitService'
import type { GitAuthService } from './git-auth'
import type { TerminalService } from './terminal'

const PROJECT_ACTIONS_KEY = 'projectActions'
const WORKTREE_SETUP_KEY = 'worktreeSetupCommands'
const REPO_CONFIG_TRUST_KEY = 'repoConfigTrustHash'
const REPO_FILE_RELATIVE_PATH = path.join('.ocm', 'project.json')
const REPO_CONFIG_SYMLINK_MESSAGE = '.ocm/project.json must not be a symbolic link'

function describeZodIssue(issue: { path?: PropertyKey[]; message: string } | undefined): string {
  if (!issue) {
    return 'Invalid value'
  }
  const issuePath = (issue.path ?? []).map(String).join('.')
  return issuePath ? `${issuePath}: ${issue.message}` : issue.message
}

export interface RepoFileState {
  exists: boolean
  file: RepoProjectFile | null
  hash: string | null
  error?: string
}

interface MoveCommit {
  repoFile: RepoProjectFile | null
  personalActions?: ProjectAction[]
  personalSetup?: string[]
  trustHash: string | null
}

interface RepoFileSnapshot {
  exists: boolean
  content: Buffer | null
}

export class ProjectConfigError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ProjectConfigError'
  }
}

export class ProjectConfigService {
  private readonly actionRunQueues = new Map<string, Promise<void>>()

  constructor(
    private readonly database: Database,
    private readonly git: GitService,
    private readonly gitAuthService: GitAuthService,
  ) {}

  async resolveProjectRepo(repo: Repo): Promise<Repo> {
    if (!repo.isWorktree) {
      return repo
    }
    const mainCheckout = await this.git.getMainCheckoutPath(repo.fullPath)
    return getRepoByDirectory(this.database, mainCheckout) ?? repo
  }

  getPersonalActions(projectRepo: Repo): ProjectAction[] {
    return this.readStoredJson(projectRepo.id, PROJECT_ACTIONS_KEY, z.array(ProjectActionSchema)) ?? []
  }

  setPersonalActions(projectRepo: Repo, actions: ProjectAction[]): void {
    const ids = new Set<string>()
    for (const action of actions) {
      if (ids.has(action.id)) {
        throw new ProjectConfigError('Duplicate action id', 400)
      }
      ids.add(action.id)
    }
    setRepoSetting(this.database, projectRepo.id, PROJECT_ACTIONS_KEY, JSON.stringify(actions))
  }

  getPersonalSetup(projectRepo: Repo): string[] {
    return this.readStoredJson(projectRepo.id, WORKTREE_SETUP_KEY, WorktreeSetupCommandsSchema) ?? []
  }

  setPersonalSetup(projectRepo: Repo, commands: string[]): void {
    setRepoSetting(this.database, projectRepo.id, WORKTREE_SETUP_KEY, JSON.stringify(commands))
  }

  async getConfig(repo: Repo, directory: string): Promise<ProjectConfigResponse> {
    const projectRepo = await this.resolveProjectRepo(repo)
    const repoFile = this.readRepoFile(directory)
    const warnings: string[] = []

    const actions: ProjectConfigResponse['actions'] = this.getPersonalActions(projectRepo).map((action) => ({
      ...action,
      source: 'personal' as const,
    }))
    const actionIds = new Set(actions.map((action) => action.id))

    for (const action of repoFile.file?.projectActions ?? []) {
      if (actionIds.has(action.id)) {
        warnings.push(`Repository action "${action.id}" was ignored because a personal action uses the same id`)
        continue
      }
      actionIds.add(action.id)
      actions.push({ ...action, source: 'repo' })
    }

    const worktreeSetup: ProjectConfigResponse['worktreeSetup'] = this.getPersonalSetup(projectRepo).map((command) => ({
      command,
      source: 'personal' as const,
    }))
    for (const command of repoFile.file?.setupWorktree ?? []) {
      worktreeSetup.push({ command, source: 'repo' })
    }

    const trusted = this.isRepoFileTrusted(projectRepo, repoFile)

    const resolvedActions = await Promise.all(
      actions.map(async (action) =>
        action.url ? { ...action, resolvedUrl: await this.resolveActionUrl(action.url, directory) } : action,
      ),
    )

    return {
      actions: resolvedActions,
      worktreeSetup,
      repoFile: {
        path: '.ocm/project.json',
        exists: repoFile.exists,
        trusted,
        hash: repoFile.hash,
        executable: repoFile.file ? this.buildRepoFileExecutable(repoFile.file) : null,
        ...(repoFile.error ? { error: repoFile.error } : {}),
        warnings,
      },
    }
  }

  async resolveActionUrl(template: string, directory: string): Promise<string> {
    const withWorktree = template.replaceAll('{worktree}', path.basename(directory))
    if (!withWorktree.includes('{branch}')) {
      return withWorktree
    }

    try {
      const branch = (
        await executeCommand(['git', '-C', directory, 'rev-parse', '--abbrev-ref', 'HEAD'], {
          env: this.gitAuthService.getGitEnvironment(),
          silent: true,
        })
      ).trim()
      return withWorktree.replaceAll('{branch}', branch)
    } catch {
      return template
    }
  }

  async runAction(
    repo: Repo,
    directory: string,
    actionId: string,
    terminalService: TerminalService,
  ): Promise<RunProjectActionResponse> {
    const config = await this.getConfig(repo, directory)
    const action = config.actions.find((item) => item.id === actionId)
    if (!action) {
      throw new ProjectConfigError('Action not found', 404)
    }

    if (action.source === 'repo' && !config.repoFile.trusted) {
      throw new ProjectConfigError('Repository commands are not trusted', 409, 'REPO_CONFIG_UNTRUSTED', {
        hash: config.repoFile.hash,
      })
    }

    const key = this.actionRunKey(directory, actionId)
    return this.enqueueActionRun(key, async () => {
      const terminals = await terminalService.list(directory)
      const running = terminals.find((terminal) => isRunningActionTerminal(terminal, actionId))
      const terminal =
        running ??
        (await terminalService.create(directory, {
          kind: 'action',
          actionId,
          name: action.name,
          command: '/bin/sh',
          args: ['-c', action.command],
        }))

      return {
        terminal,
        alreadyRunning: running !== undefined,
        ...(action.resolvedUrl ? { resolvedUrl: action.resolvedUrl } : {}),
        autoOpenUrl: action.autoOpenUrl,
      }
    })
  }

  private actionRunKey(directory: string, actionId: string): string {
    const canonical = canonicalPathSync(path.resolve(directory))
    return `${canonical}\u0000${actionId}`
  }

  private enqueueActionRun<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.actionRunQueues.get(key) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.actionRunQueues.set(key, tail)
    void tail.then(() => {
      if (this.actionRunQueues.get(key) === tail) {
        this.actionRunQueues.delete(key)
      }
    })
    return result
  }

  async runWorktreeSetup(
    projectRepo: Repo,
    worktreeDirectory: string,
    terminalService: TerminalService,
  ): Promise<WorktreeSetupResult> {
    const commands = [...this.getPersonalSetup(projectRepo)]
    const repoFile = this.readRepoFile(worktreeDirectory)
    const repoCommands = repoFile.file?.setupWorktree ?? []
    const repoCommandsSkipped = repoCommands.length > 0 && !this.isRepoFileTrusted(projectRepo, repoFile)
    if (!repoCommandsSkipped) {
      commands.push(...repoCommands)
    }

    if (commands.length === 0) {
      return repoCommandsSkipped ? { status: 'skipped', reason: 'untrusted' } : { status: 'none' }
    }

    try {
      const terminal = await terminalService.create(worktreeDirectory, {
        kind: 'setup',
        name: 'Worktree setup',
        command: '/bin/sh',
        args: ['-c', ['set -e', ...commands].join('\n')],
        env: { ROOT_PROJECT_PATH: projectRepo.fullPath },
      })
      return { status: 'started', terminal, repoCommandsSkipped }
    } catch (error: unknown) {
      logger.warn(`Failed to start worktree setup for ${worktreeDirectory}:`, error)
      return { status: 'failed', error: getErrorMessage(error) }
    }
  }

  async runWorktreeSetupForRepo(
    repo: Repo,
    worktreeDirectory: string,
    terminalService: TerminalService,
  ): Promise<WorktreeSetupResult> {
    try {
      const projectRepo = await this.resolveProjectRepo(repo)
      return await this.runWorktreeSetup(projectRepo, worktreeDirectory, terminalService)
    } catch (error: unknown) {
      logger.warn(`Failed to prepare worktree setup for ${worktreeDirectory}:`, error)
      return { status: 'failed', error: getErrorMessage(error) }
    }
  }

  isRepoFileTrusted(projectRepo: Repo, repoFile: RepoFileState): boolean {
    return (
      repoFile.hash !== null &&
      repoFile.hash === getRepoSetting(this.database, projectRepo.id, REPO_CONFIG_TRUST_KEY)
    )
  }

  readRepoFile(directory: string): RepoFileState {
    const filePath = this.getRepoFilePath(directory)
    try {
      if (this.isSymbolicLink(path.dirname(filePath)) || this.isSymbolicLink(filePath)) {
        return { exists: true, file: null, hash: null, error: REPO_CONFIG_SYMLINK_MESSAGE }
      }
      if (!fs.existsSync(filePath)) {
        return { exists: false, file: null, hash: null }
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      } catch {
        return { exists: true, file: null, hash: null, error: 'Invalid JSON' }
      }

      const parsed = RepoProjectFileSchema.safeParse(parsedJson)
      if (!parsed.success) {
        return { exists: true, file: null, hash: null, error: `Does not match the project file schema: ${describeZodIssue(parsed.error.issues[0])}` }
      }
      return { exists: true, file: parsed.data, hash: this.hashRepoFile(parsed.data) }
    } catch {
      return { exists: fs.existsSync(filePath), file: null, hash: null, error: 'Invalid repository config' }
    }
  }

  buildRepoFileExecutable(file: RepoProjectFile): NonNullable<ProjectConfigResponse['repoFile']['executable']> {
    const executable: NonNullable<ProjectConfigResponse['repoFile']['executable']> = {
      actions: (file.projectActions ?? []).map((action) => ({
        id: action.id,
        name: action.name,
        command: action.command,
        url: action.url ?? null,
        autoOpenUrl: action.autoOpenUrl,
      })),
      setup: file.setupWorktree ?? [],
    }
    if (file.environment !== undefined) {
      executable.environment = file.environment
    }
    if (file.env && Object.keys(file.env).length > 0) {
      executable.env = file.env
    }
    return executable
  }

  hashRepoFile(file: RepoProjectFile): string {
    return createHash('sha256').update(JSON.stringify(this.buildRepoFileExecutable(file))).digest('hex')
  }

  async trustRepoFile(repo: Repo, directory: string, hash: string): Promise<void> {
    const projectRepo = await this.resolveProjectRepo(repo)
    const repoFile = this.readRepoFile(directory)
    if (repoFile.hash === null || repoFile.hash !== hash) {
      throw new ProjectConfigError('Repository config changed', 409, 'REPO_CONFIG_CHANGED')
    }
    this.setRepoTrust(projectRepo, repoFile.hash)
  }

  async moveItem(repo: Repo, directory: string, request: MoveProjectItemRequest): Promise<void> {
    const projectRepo = await this.resolveProjectRepo(repo)
    const filePath = this.getRepoFilePath(directory)
    this.assertRepoFilePathNotSymlink(filePath)
    const state = this.readRepoFile(directory)
    const commit =
      request.to === 'repo'
        ? this.planMoveToRepo(projectRepo, state, request)
        : this.planMoveToPersonal(projectRepo, state, request)

    this.commitMove(projectRepo, filePath, commit)
  }

  private planMoveToRepo(projectRepo: Repo, state: RepoFileState, request: MoveProjectItemRequest): MoveCommit {
    if (state.exists && !state.file) {
      throw new ProjectConfigError('Repository config is invalid', 409)
    }

    const file: RepoProjectFile = state.file ? { ...state.file } : { version: 1 }

    if (request.kind === 'action') {
      const personal = this.getPersonalActions(projectRepo)
      const action = personal.find((item) => item.id === request.id)
      if (!action) {
        throw new ProjectConfigError('Action not found', 404)
      }
      const repoActions = file.projectActions ?? []
      if (repoActions.some((existing) => existing.id === action.id)) {
        throw new ProjectConfigError('Action already exists in repository config', 409)
      }
      const nextFile: RepoProjectFile = { ...file, projectActions: [...repoActions, action] }
      this.assertRepoFileValid(nextFile)
      return {
        repoFile: nextFile,
        personalActions: personal.filter((item) => item.id !== action.id),
        trustHash: this.resolveTrustAfterMove(projectRepo, state, this.hashRepoFile(nextFile)),
      }
    }

    const personal = this.getPersonalSetup(projectRepo)
    const index = personal.indexOf(request.command)
    if (index === -1) {
      throw new ProjectConfigError('Setup command not found', 404)
    }
    const nextFile: RepoProjectFile = {
      ...file,
      setupWorktree: [...(file.setupWorktree ?? []), request.command],
    }
    const nextPersonal = personal.filter((_, itemIndex) => itemIndex !== index)
    this.assertRepoFileValid(nextFile)
    this.assertPersonalSetupValid(nextPersonal)
    return {
      repoFile: nextFile,
      personalSetup: nextPersonal,
      trustHash: this.resolveTrustAfterMove(projectRepo, state, this.hashRepoFile(nextFile)),
    }
  }

  private planMoveToPersonal(projectRepo: Repo, state: RepoFileState, request: MoveProjectItemRequest): MoveCommit {
    const file = state.file
    if (!file) {
      throw new ProjectConfigError('Item not found', 404)
    }

    if (request.kind === 'action') {
      const repoActions = file.projectActions ?? []
      const action = repoActions.find((item) => item.id === request.id)
      if (!action) {
        throw new ProjectConfigError('Action not found', 404)
      }
      const nextFile = this.pruneRepoFile({
        ...file,
        projectActions: repoActions.filter((item) => item.id !== action.id),
      })
      const personalActions = [...this.getPersonalActions(projectRepo), action]
      return nextFile
        ? {
            repoFile: nextFile,
            personalActions,
            trustHash: this.resolveTrustAfterMove(projectRepo, state, this.hashRepoFile(nextFile)),
          }
        : { repoFile: null, personalActions, trustHash: null }
    }

    const repoSetup = file.setupWorktree ?? []
    const index = repoSetup.indexOf(request.command)
    if (index === -1) {
      throw new ProjectConfigError('Setup command not found', 404)
    }
    const nextFile = this.pruneRepoFile({
      ...file,
      setupWorktree: repoSetup.filter((_, itemIndex) => itemIndex !== index),
    })
    const personalSetup = [...this.getPersonalSetup(projectRepo), request.command]
    this.assertPersonalSetupValid(personalSetup)
    return nextFile
      ? {
          repoFile: nextFile,
          personalSetup,
          trustHash: this.resolveTrustAfterMove(projectRepo, state, this.hashRepoFile(nextFile)),
        }
      : { repoFile: null, personalSetup, trustHash: null }
  }

  private resolveTrustAfterMove(projectRepo: Repo, state: RepoFileState, nextHash: string | null): string | null {
    if (nextHash === null) {
      return null
    }
    if (this.hasUntrustedExecutableContent(projectRepo, state)) {
      return getRepoSetting(this.database, projectRepo.id, REPO_CONFIG_TRUST_KEY)
    }
    return nextHash
  }

  private hasUntrustedExecutableContent(projectRepo: Repo, state: RepoFileState): boolean {
    if (!state.exists || !state.file) {
      return false
    }
    const hasExecutable =
      (state.file.projectActions?.length ?? 0) > 0 ||
      (state.file.setupWorktree?.length ?? 0) > 0 ||
      (state.file.env !== undefined && Object.keys(state.file.env).length > 0) ||
      state.file.environment !== undefined
    return hasExecutable && !this.isRepoFileTrusted(projectRepo, state)
  }

  private pruneRepoFile(file: RepoProjectFile): RepoProjectFile | null {
    const next: RepoProjectFile = { ...file }
    if (next.projectActions && next.projectActions.length === 0) {
      delete next.projectActions
    }
    if (next.setupWorktree && next.setupWorktree.length === 0) {
      delete next.setupWorktree
    }
    if (Object.keys(next).every((key) => key === 'version')) {
      return null
    }
    this.assertRepoFileValid(next)
    return next
  }

  private commitMove(projectRepo: Repo, filePath: string, commit: MoveCommit): void {
    const snapshot = this.snapshotFile(filePath)
    let fileMutated = false

    try {
      this.database.transaction(() => {
        if (commit.repoFile === null) {
          fs.rmSync(filePath, { force: true })
        } else {
          this.writeRepoFile(filePath, commit.repoFile)
        }
        fileMutated = true

        if (commit.personalActions !== undefined) {
          this.setPersonalActions(projectRepo, commit.personalActions)
        }
        if (commit.personalSetup !== undefined) {
          this.setPersonalSetup(projectRepo, commit.personalSetup)
        }
        this.setRepoTrust(projectRepo, commit.trustHash)
      })()
    } catch (error) {
      if (fileMutated) {
        this.restoreFile(filePath, snapshot)
      }
      throw error
    }

    if (commit.repoFile === null) {
      this.removeOcmDirIfEmpty(filePath)
    }
  }

  private assertRepoFileValid(file: RepoProjectFile): void {
    const result = RepoProjectFileSchema.safeParse(file)
    if (!result.success) {
      throw new ProjectConfigError(
        'Repository config limit exceeded',
        409,
        'PROJECT_CONFIG_LIMIT_EXCEEDED',
        result.error.flatten(),
      )
    }
  }

  private assertPersonalSetupValid(commands: string[]): void {
    const result = WorktreeSetupCommandsSchema.safeParse(commands)
    if (!result.success) {
      throw new ProjectConfigError(
        'Personal setup command limit exceeded',
        409,
        'PROJECT_CONFIG_LIMIT_EXCEEDED',
        result.error.flatten(),
      )
    }
  }

  private setRepoTrust(projectRepo: Repo, hash: string | null): void {
    setRepoSetting(this.database, projectRepo.id, REPO_CONFIG_TRUST_KEY, hash)
  }

  private getRepoFilePath(directory: string): string {
    return path.join(directory, REPO_FILE_RELATIVE_PATH)
  }

  private writeRepoFile(filePath: string, file: RepoProjectFile): void {
    writeFileAtomicSync(filePath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o644 })
  }

  private isSymbolicLink(target: string): boolean {
    try {
      return fs.lstatSync(target).isSymbolicLink()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }

  private assertRepoFilePathNotSymlink(filePath: string): void {
    if (this.isSymbolicLink(path.dirname(filePath)) || this.isSymbolicLink(filePath)) {
      throw new ProjectConfigError(REPO_CONFIG_SYMLINK_MESSAGE, 400, 'REPO_CONFIG_SYMLINK')
    }
  }

  private snapshotFile(filePath: string): RepoFileSnapshot {
    try {
      return { exists: true, content: fs.readFileSync(filePath) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { exists: false, content: null }
      }
      throw error
    }
  }

  private restoreFile(filePath: string, snapshot: RepoFileSnapshot): void {
    if (!snapshot.exists || snapshot.content === null) {
      fs.rmSync(filePath, { force: true })
      return
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, snapshot.content)
  }

  private removeOcmDirIfEmpty(filePath: string): void {
    const dir = path.dirname(filePath)
    try {
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  private readStoredJson<T>(repoId: number, key: string, schema: z.ZodType<T>): T | null {
    const raw = getRepoSetting(this.database, repoId, key)
    if (!raw) {
      return null
    }
    try {
      const result = schema.safeParse(JSON.parse(raw))
      return result.success ? result.data : null
    } catch {
      return null
    }
  }
}
