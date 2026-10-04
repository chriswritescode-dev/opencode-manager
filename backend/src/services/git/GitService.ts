import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { getRepoById, getRepoByDirectory, updateRepoBranch, listRepos } from '../../db/queries'
import { updateScheduleJobsBranch } from '../../db/schedules'
import { isSSHUrl, getBranchNameError } from '@opencode-manager/shared/utils'
import { GitOperationError, isNoUpstreamError, parseGitError } from '../../utils/git-errors'
import { resolveMainCheckoutPath } from '../repo'
import { MAX_COMMIT_PROMPT_DIFF_CHARS, type CommitMessageContext } from './commit-message-prompt'
import type { Database } from 'bun:sqlite'
import type { DeleteBranchResult, GitOperationKind, GitOperationState, GitStashEntry, IntegrateBranchRequest, IntegrateBranchResult, StashPushRequest } from '@opencode-manager/shared'
import type { GitBranch, GitCommit, FileDiffResponse, GitDiffOptions, GitStatusResponse, GitFileStatus, GitFileStatusType, CommitDetails, CommitFile } from '../../types/git'
import { canonicalPathSync } from '../../utils/fs-safe'
import path from 'path'
import { existsSync } from 'node:fs'

function assertValidBranchName(name: string): void {
  const error = getBranchNameError(name)
  if (error) {
    throw new Error(error)
  }
}

function assertValidStashIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid stash index: ${index}`)
  }
}

export class GitIntegrationConflictError extends GitOperationError {
  constructor(
    readonly targetRepoId: number,
    readonly operation: GitOperationState
  ) {
    super('MERGE_CONFLICT', 'Integration stopped on conflicts', { targetRepoId, operation })
    this.name = 'GitIntegrationConflictError'
  }
}

export class BranchDeleteError extends Error {
  constructor(
    message: string,
    readonly localDeleted: boolean,
    readonly remoteDeleted: boolean
  ) {
    super(message)
    this.name = 'BranchDeleteError'
  }
}

export interface WorktreeBranchDeletionResult {
  name: string
  deleted: boolean
  remoteDeleted: boolean
  error?: string
}

export class GitService {
  constructor(private gitAuthService: GitAuthService) {}

  async getStatus(repoId: number, database: Database): Promise<GitStatusResponse> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      const [branch, branchStatus, porcelainOutput, operation] = await Promise.all([
        this.getCurrentBranch(repoPath, env),
        this.getBranchStatusFromPath(repoPath, env),
        executeCommand(['git', '-C', repoPath, 'status', '--porcelain'], { env }),
        this.getOperationState(repoPath, env)
      ])

      const files = this.parsePorcelainOutput(porcelainOutput)
      const hasChanges = files.length > 0

      return {
        branch,
        ahead: branchStatus.ahead,
        behind: branchStatus.behind,
        files,
        hasChanges,
        operation
      }
    } catch (error: unknown) {
      logger.error(`Failed to get status for repo ${repoId}:`, error)
      throw error
    }
  }

  private async getOperationState(repoPath: string, env: Record<string, string>): Promise<GitOperationState | null> {
    const output = await executeCommand(
      [
        'git', '-C', repoPath, 'rev-parse',
        '--git-path', 'rebase-merge',
        '--git-path', 'rebase-apply',
        '--git-path', 'MERGE_HEAD',
        '--git-path', 'CHERRY_PICK_HEAD',
        '--git-path', 'REVERT_HEAD',
      ],
      { env, silent: true }
    )

    const markerPaths = output.split('\n').map((entry) => entry.trim())
    const markerExists = (index: number): boolean => {
      const gitPath = markerPaths[index]
      if (!gitPath) return false
      const resolved = path.isAbsolute(gitPath) ? gitPath : path.resolve(repoPath, gitPath)
      return existsSync(resolved)
    }

    const kind: GitOperationKind | null =
      markerExists(0) || markerExists(1) ? 'rebase'
        : markerExists(2) ? 'merge'
          : markerExists(3) ? 'cherry-pick'
            : markerExists(4) ? 'revert'
              : null

    if (!kind) {
      return null
    }

    const conflictOutput = await executeCommand(
      ['git', '-C', repoPath, 'diff', '--name-only', '--diff-filter=U', '-z'],
      { env, silent: true }
    )
    const conflictedFiles = conflictOutput.split('\0').filter((entry) => entry.length > 0)

    return { kind, conflictedFiles }
  }

  async getFileDiff(repoId: number, filePath: string, database: Database, options?: GitDiffOptions & { includeStaged?: boolean }): Promise<FileDiffResponse> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found: ${repoId}`)
    }

    const repoPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()
    const includeStaged = options?.includeStaged ?? true

    const status = await this.getFileStatus(repoPath, filePath, env)

    if (status.status === 'untracked') {
      return this.getUntrackedFileDiff(repoPath, filePath, env)
    }

    if (status.status === 'clean') {
      return {
        path: filePath,
        status: 'modified',
        diff: '',
        additions: 0,
        deletions: 0,
        isBinary: false
      }
    }

    return this.getTrackedFileDiff(repoPath, filePath, env, includeStaged, options)
  }

  async getFullDiff(repoId: number, filePath: string, database: Database, includeStaged?: boolean): Promise<FileDiffResponse> {
    return this.getFileDiff(repoId, filePath, database, { includeStaged })
  }

  async getLog(repoId: number, database: Database, limit: number = 10, branch?: string): Promise<GitCommit[]> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(repo.fullPath)
      const logArgs = [
        'git',
        '-C',
        repoPath,
        'log',
        branch?.trim() || 'HEAD',
        `-n`,
        String(limit),
        '--format=%H|%an|%ae|%at|%s'
      ]
      const logEnv = this.gitAuthService.getGitEnvironment(true)
      const output = await executeCommand(logArgs, { env: logEnv })

      const lines = output.trim().split('\n')
      const commits: GitCommit[] = []

      for (const line of lines) {
        if (!line.trim()) continue

        const parts = line.split('|')
        const [hash, authorName, authorEmail, timestamp, ...messageParts] = parts
        const message = messageParts.join('|')

        if (hash) {
          commits.push({
            hash,
            authorName: authorName || '',
            authorEmail: authorEmail || '',
            date: timestamp || '',
            message: message || ''
          })
        }
      }

      const unpushedCommits = await this.getUnpushedCommitHashes(repoPath, logEnv)

      return commits.map(commit => ({
        ...commit,
        unpushed: unpushedCommits.has(commit.hash)
      }))
    } catch (error: unknown) {
      logger.error(`Failed to get git log for repo ${repoId}:`, error)
      throw new Error(`Failed to get git log: ${getErrorMessage(error)}`)
    }
  }

  async getCommit(repoId: number, hash: string, database: Database): Promise<GitCommit | null> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(repo.fullPath)
      const logArgs = [
        'git',
        '-C',
        repoPath,
        'log',
        '--format=%H|%an|%ae|%at|%s',
        hash,
        '-1'
      ]
      const env = this.gitAuthService.getGitEnvironment(true)

      const output = await executeCommand(logArgs, { env })

      if (!output.trim()) {
        return null
      }

      const parts = output.trim().split('|')
      const [commitHash, authorName, authorEmail, timestamp, ...messageParts] = parts
      const message = messageParts.join('|')

      if (!commitHash) {
        return null
      }

      return {
        hash: commitHash,
        authorName: authorName || '',
        authorEmail: authorEmail || '',
        date: timestamp || '',
        message: message || ''
      }
    } catch (error: unknown) {
      logger.error(`Failed to get commit ${hash} for repo ${repoId}:`, error)
      throw new Error(`Failed to get commit: ${getErrorMessage(error)}`)
    }
  }

  async getDiff(repoId: number, filePath: string, database: Database): Promise<string> {
    const result = await this.getFileDiff(repoId, filePath, database)
    return result.diff
  }

  async commit(repoId: number, message: string, database: Database, stagedPaths?: string[]): Promise<string> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.getEnvironmentForRepo(repo)

      const args = ['git', '-C', repoPath, 'commit', '-m', message]

      if (stagedPaths && stagedPaths.length > 0) {
        args.push('--')
        args.push(...stagedPaths)
      }

      const result = await executeCommand(args, { env })

      return result
    } catch (error: unknown) {
      logger.error(`Failed to commit changes for repo ${repoId}:`, error)
      throw error
    }
  }

  async getCommitMessageContext(repoId: number, database: Database): Promise<CommitMessageContext> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const repoPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    const stagedStat = await executeCommand(
      ['git', '-C', repoPath, 'diff', '--cached', '--stat'],
      { env }
    )

    if (!stagedStat.trim()) {
      throw new Error('No staged changes')
    }

    const [stagedDiff, recentSubjects] = await Promise.all([
      executeCommand(['git', '-C', repoPath, 'diff', '--cached'], { env, maxOutputChars: MAX_COMMIT_PROMPT_DIFF_CHARS + 1 }),
      this.getRecentCommitSubjects(repoPath, env),
    ])

    return { stagedStat, stagedDiff, recentSubjects }
  }

  private async getRecentCommitSubjects(repoPath: string, env: Record<string, string>): Promise<string[]> {
    if (!(await this.hasCommits(repoPath))) {
      return []
    }

    try {
      const output = await executeCommand(
        ['git', '-C', repoPath, 'log', '-n', '10', '--format=%s'],
        { env, silent: true }
      )
      return output.split('\n').map(line => line.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  async stageFiles(repoId: number, paths: string[], database: Database): Promise<string> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      if (paths.length === 0) {
        return ''
      }

      const args = ['git', '-C', repoPath, 'add', '--', ...paths]
      const result = await executeCommand(args, { env })

      return result
    } catch (error: unknown) {
      logger.error(`Failed to stage files for repo ${repoId}:`, error)
      throw error
    }
  }

  async unstageFiles(repoId: number, paths: string[], database: Database): Promise<string> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      if (paths.length === 0) {
        return ''
      }

      const args = ['git', '-C', repoPath, 'restore', '--staged', '--', ...paths]
      const result = await executeCommand(args, { env })

      return result
    } catch (error: unknown) {
      logger.error(`Failed to unstage files for repo ${repoId}:`, error)
      throw error
    }
  }

  async discardChanges(repoId: number, paths: string[], staged: boolean, database: Database): Promise<string> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      if (paths.length === 0) {
        return ''
      }

      if (staged) {
        const args = ['git', '-C', repoPath, 'restore', '--staged', '--worktree', '--source', 'HEAD', '--', ...paths]
        return await executeCommand(args, { env })
      }

      const statusOutput = await executeCommand(
        ['git', '-C', repoPath, 'status', '--porcelain', '-u', '--', ...paths],
        { env }
      )

      const untrackedPaths: string[] = []
      const trackedPaths: string[] = []

      for (const line of statusOutput.split('\n')) {
        if (!line.trim()) continue
        const statusCode = line.substring(0, 2)
        const filePath = line.substring(3).trim()
        
        if (statusCode === '??') {
          untrackedPaths.push(filePath)
        } else {
          trackedPaths.push(filePath)
        }
      }

      const results: string[] = []

      if (trackedPaths.length > 0) {
        const args = ['git', '-C', repoPath, 'checkout', '--', ...trackedPaths]
        results.push(await executeCommand(args, { env }))
      }

      if (untrackedPaths.length > 0) {
        try {
          const args = ['git', '-C', repoPath, 'clean', '-fd', '--', ...untrackedPaths]
          results.push(await executeCommand(args, { env }))
        } catch (error: unknown) {
          logger.error(`Failed to clean untracked files for repo ${repoId}:`, error)
          throw error
        }
      }

      return results.join('\n')
    } catch (error: unknown) {
      logger.error(`Failed to discard changes for repo ${repoId}:`, error)
      throw error
    }
  }

  private normalizeRenamePath(path: string): string {
    const renamePattern = /\{[^=]+=>\s*([^}]+)\}/
    let normalized = path
    while (renamePattern.test(normalized)) {
      normalized = normalized.replace(renamePattern, '$1')
    }
    return normalized.trim()
  }

  private parseNumstatOutput(output: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>()
    const lines = output.trim().split('\n')

    for (const line of lines) {
      if (!line.trim()) continue

      const parts = line.split('\t')
      if (parts.length >= 3) {
        const additions = parts[0]
        const deletions = parts[1]
        const filePath = parts.slice(2).join('\t')
        const normalizedPath = this.normalizeRenamePath(filePath)

        if (
          additions?.match(/^\d+$/) &&
          deletions?.match(/^\d+$/) &&
          normalizedPath
        ) {
          map.set(normalizedPath, {
            additions: parseInt(additions, 10),
            deletions: parseInt(deletions, 10)
          })
        }
      }
    }

    return map
  }

  private parseCommitFiles(
    output: string,
    numstatMap: Map<string, { additions: number; deletions: number }>
  ): CommitFile[] {
    const files: CommitFile[] = []
    const lines = output.trim().split('\n')

    for (const line of lines) {
      if (!line.trim()) continue

      const parts = line.split('\t')
      if (parts.length >= 2 && parts[0] && parts[0].match(/^[AMDRC]/)) {
        const statusCode = parts[0]
        const fromPath = parts[1] || ''
        const toPath = parts[2] || parts[1] || ''
        const isRename = statusCode.startsWith('R')
        const isCopy = statusCode.startsWith('C')

        let status: GitFileStatusType = 'modified'
        switch (statusCode.charAt(0)) {
          case 'A':
            status = 'added'
            break
          case 'D':
            status = 'deleted'
            break
          case 'R':
            status = 'renamed'
            break
          case 'C':
            status = 'copied'
            break
          case 'M':
            status = 'modified'
            break
        }

        const numstatData = numstatMap.get(toPath)
        const additions = numstatData?.additions ?? 0
        const deletions = numstatData?.deletions ?? 0

        files.push({
          path: toPath,
          status,
          oldPath: isRename || isCopy ? fromPath : undefined,
          additions,
          deletions
        })
      }
    }

    return files
  }

  async getCommitDetails(repoId: number, hash: string, database: Database): Promise<CommitDetails | null> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment(true)

      const commitOutput = await executeCommand(
        ['git', '-C', repoPath, 'log', '-1', '--format=%H%x00%an%x00%ae%x00%at%x00%B', hash],
        { env }
      )

      if (!commitOutput.trim()) {
        return null
      }

      const parts = commitOutput.trim().split('\0')
      const [commitHash, authorName, authorEmail, timestamp, message] = parts

      if (!commitHash) {
        return null
      }

      const filesOutput = await executeCommand(
        ['git', '-C', repoPath, 'show', '-M', '--name-status', '--format=', hash],
        { env }
      )

      const numstatOutput = await executeCommand(
        ['git', '-C', repoPath, 'show', '-M', '--numstat', '--format=', hash],
        { env }
      )

      const numstatMap = this.parseNumstatOutput(numstatOutput)
      const files = this.parseCommitFiles(filesOutput, numstatMap)

      return {
        hash: commitHash,
        authorName: authorName || '',
        authorEmail: authorEmail || '',
        date: timestamp || '',
        message: message || '',
        unpushed: await this.isCommitUnpushed(repoPath, commitHash, env),
        files
      }
    } catch (error: unknown) {
      logger.error(`Failed to get commit details for repo ${repoId}:`, error)
      throw new Error(`Failed to get commit details: ${getErrorMessage(error)}`)
    }
  }

  async getCommitDiff(repoId: number, hash: string, filePath: string, database: Database): Promise<FileDiffResponse> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment(true)

      const diff = await executeCommand(
        ['git', '-C', repoPath, 'show', '--format=', hash, '--', filePath],
        { env }
      )

      const status = this.detectDiffStatus(diff)
      return this.parseDiffOutput(diff, status, filePath)
    } catch (error: unknown) {
      logger.error(`Failed to get commit diff for repo ${repoId}:`, error)
      throw new Error(`Failed to get commit diff: ${getErrorMessage(error)}`)
    }
  }

  private detectDiffStatus(diff: string): GitFileStatusType {
    if (diff.includes('new file mode')) {
      return 'added'
    }
    if (diff.includes('deleted file mode')) {
      return 'deleted'
    }
    if (diff.includes('rename from') || diff.includes('rename to')) {
      return 'renamed'
    }
    return 'modified'
  }

  private async setupSSHIfNeeded(repoUrl: string | undefined, database?: Database): Promise<void> {
    await this.gitAuthService.setupSSHForRepoUrl(repoUrl, database)
  }

  private async cleanupSSHForRepo(): Promise<void> {
    await this.gitAuthService.cleanupSSHKey()
  }

  private getEnvironmentForRepo(repo: { id?: number; repoUrl?: string; fullPath: string }, silent: boolean = false): Record<string, string> {
    const repoContextEnv = {
      ...(repo.id ? { OCM_GIT_REPO_ID: String(repo.id) } : {}),
      OCM_GIT_REPO_CWD: repo.fullPath,
    }

    if (!repo.repoUrl) {
      return { ...this.gitAuthService.getGitEnvironment(silent), ...repoContextEnv }
    }

    const isSSH = isSSHUrl(repo.repoUrl)
    const baseEnv = { ...this.gitAuthService.getGitEnvironment(silent), ...repoContextEnv }

    if (!isSSH) {
      return baseEnv
    }

    const sshEnv = this.gitAuthService.getSSHEnvironment()
    return { ...baseEnv, ...sshEnv }
  }

  private async withRemoteAuth<T>(
    repo: { id?: number; repoUrl?: string; fullPath: string },
    run: (env: Record<string, string>) => Promise<T>,
    options: { database?: Database; silent?: boolean } = {}
  ): Promise<T> {
    await this.setupSSHIfNeeded(repo.repoUrl, options.database)
    try {
      const env = this.getEnvironmentForRepo(repo, options.silent ?? false)
      return await run(env)
    } finally {
      await this.cleanupSSHForRepo()
    }
  }

  async resetToCommit(repoId: number, commitHash: string, database: Database): Promise<string> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      const args = ['git', '-C', repoPath, 'reset', '--hard', commitHash]
      const result = await executeCommand(args, { env })

      return result
    } catch (error: unknown) {
      logger.error(`Failed to reset to commit ${commitHash} for repo ${repoId}:`, error)
      throw error
    }
  }

  async push(repoId: number, options: { setUpstream?: boolean }, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)

    return this.withRemoteAuth(repo, async (env) => {
      if (options.setUpstream) {
        return this.pushWithUpstream(repoId, fullPath, env)
      }

      try {
        const args = ['git', '-C', fullPath, 'push']
        return await executeCommand(args, { env })
      } catch (error) {
        if (isNoUpstreamError(error as Error)) {
          return this.pushWithUpstream(repoId, fullPath, env)
        }
        throw error
      }
    }, { database })
  }

  async fetch(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)

    return this.withRemoteAuth(
      repo,
      (env) => executeCommand(['git', '-C', fullPath, 'fetch', '--all', '--prune'], { env }),
      { database, silent: true }
    )
  }

  async pull(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)

    return this.withRemoteAuth(
      repo,
      (env) => executeCommand(['git', '-C', fullPath, 'pull'], { env }),
      { database }
    )
  }

  async getBranches(repoId: number, database: Database): Promise<GitBranch[]> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    const currentBranch = await this.resolveHeadBranch(fullPath, env)

    const stdout = await executeCommand(['git', '-C', fullPath, 'branch', '-vv', '-a'], { env, silent: true })
    const lines = stdout.split('\n').filter(line => line.trim())

    const branches: GitBranch[] = []
    const seenNames = new Set<string>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const isCurrent = trimmed.startsWith('*')
      const isWorktree = trimmed.startsWith('+')
      const namePart = trimmed.replace(/^[*+]?\s*/, '')

      const firstSpace = namePart.indexOf(' ')
      const firstBracket = namePart.indexOf('[')
      const cutIndex = firstSpace === -1 ? (firstBracket === -1 ? namePart.length : firstBracket) : (firstBracket === -1 ? firstSpace : Math.min(firstSpace, firstBracket))
      const branchName = namePart.slice(0, cutIndex).trim()

      if (!branchName || branchName === '+' || branchName === '->' || branchName.includes('->')) continue
      if (/^[0-9a-f]{6,40}$/.test(branchName)) continue

      const branch: GitBranch = {
        name: branchName,
        type: branchName.startsWith('remotes/') ? 'remote' : 'local',
        current: isCurrent && (branchName === currentBranch || (currentBranch !== null && branchName === `remotes/${currentBranch}`)),
        isWorktree
      }

      if (seenNames.has(branch.name)) continue
      seenNames.add(branch.name)

      const upstreamMatch = namePart.match(/\[([^:]+):?\s*(ahead\s+(\d+))?,?\s*(behind\s+(\d+))?\]/)
      if (upstreamMatch) {
        branch.upstream = upstreamMatch[1]
        branch.ahead = upstreamMatch[3] ? parseInt(upstreamMatch[3]) : 0
        branch.behind = upstreamMatch[5] ? parseInt(upstreamMatch[5]) : 0
      }

      if (branch.current && (!branch.ahead || !branch.behind)) {
        try {
          const status = await this.getBranchStatus(repoId, database)
          branch.ahead = status.ahead
          branch.behind = status.behind
        } catch {
          void 0
        }
      }

      branches.push(branch)
    }

    return branches.sort((a, b) => {
      if (a.current !== b.current) return b.current ? 1 : -1
      if (a.type !== b.type) return a.type === 'local' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async getBranchStatus(repoId: number, database: Database): Promise<{ ahead: number; behind: number }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment()

      const stdout = await executeCommand(['git', '-C', fullPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { env, silent: true })
      const [ahead, behind] = stdout.trim().split(/\s+/).map(Number)

      return { ahead: ahead || 0, behind: behind || 0 }
    } catch (error) {
      logger.warn(`Could not get branch status for repo ${repoId}, returning zeros:`, error)
      return { ahead: 0, behind: 0 }
    }
  }

  async renameBranch(repoId: number, from: string, to: string, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    assertValidBranchName(from)
    assertValidBranchName(to)

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    const currentBranch = await this.getCurrentBranch(fullPath, env)
    if (currentBranch !== from && await this.isBranchCheckedOutInWorktree(fullPath, from, env)) {
      throw new GitOperationError('BRANCH_IN_OTHER_WORKTREE', `Branch '${from}' is checked out in another worktree and cannot be renamed here`)
    }

    const result = await executeCommand(['git', '-C', fullPath, 'branch', '-m', '--', from, to], { env })

    const renamedMainCheckout = await resolveMainCheckoutPath(fullPath)
    const renamedMainCheckoutCanonical = renamedMainCheckout ? canonicalPathSync(renamedMainCheckout) : null

    const relatedRepoIds: number[] = []
    if (renamedMainCheckoutCanonical) {
      for (const candidate of listRepos(database)) {
        if (candidate.cloneStatus !== 'ready') continue
        const candidateMainCheckout = await resolveMainCheckoutPath(candidate.fullPath)
        if (candidateMainCheckout && canonicalPathSync(candidateMainCheckout) === renamedMainCheckoutCanonical) {
          relatedRepoIds.push(candidate.id)
        }
      }
    }

    database.transaction(() => {
      if (repo.branch === from) {
        updateRepoBranch(database, repoId, to)
      }
      for (const relatedRepoId of relatedRepoIds) {
        updateScheduleJobsBranch(database, relatedRepoId, from, to)
      }
    })()

    return result
  }

  async getMainCheckoutPath(worktreePath: string): Promise<string> {
    const mainCheckoutPath = await resolveMainCheckoutPath(worktreePath)
    if (!mainCheckoutPath) {
      throw new Error(`Could not determine the main checkout for worktree at ${worktreePath}`)
    }
    return mainCheckoutPath
  }

  async deleteWorktreeBranch(
    repo: { id: number; fullPath: string; repoUrl?: string; branch?: string },
    options: { deleteRemote: boolean },
    removeWorktree: () => Promise<void>,
    database: Database
  ): Promise<WorktreeBranchDeletionResult> {
    let name: string | null = null
    let baseTarget: { fullPath: string; repoUrl?: string; id?: number } | null = null
    let prepareError: string | null = null

    try {
      const env = this.getEnvironmentForRepo(repo)
      name = await this.resolveHeadBranch(repo.fullPath, env) ?? repo.branch ?? null
      if (!name) {
        throw new Error('Could not determine the worktree branch')
      }

      const basePath = await this.getMainCheckoutPath(repo.fullPath)
      const baseRepo = getRepoByDirectory(database, basePath)
      baseTarget = baseRepo
        ? { fullPath: baseRepo.fullPath, repoUrl: baseRepo.repoUrl, id: baseRepo.id }
        : { fullPath: basePath, repoUrl: repo.repoUrl }
    } catch (error: unknown) {
      prepareError = getErrorMessage(error)
    }

    await removeWorktree()

    if (prepareError || !name || !baseTarget) {
      return {
        name: name ?? repo.branch ?? '',
        deleted: false,
        remoteDeleted: false,
        error: prepareError ?? 'Could not determine the worktree branch',
      }
    }

    try {
      const { remoteDeleted } = await this.deleteBranchAtPath(baseTarget, name, {
        force: false,
        deleteRemote: options.deleteRemote,
      })
      return { name, deleted: true, remoteDeleted }
    } catch (error: unknown) {
      const partial = error instanceof BranchDeleteError ? error : null
      return {
        name,
        deleted: partial?.localDeleted ?? false,
        remoteDeleted: partial?.remoteDeleted ?? false,
        error: getErrorMessage(error),
      }
    }
  }

  async deleteBranchAtPath(
    target: { fullPath: string; repoUrl?: string; id?: number },
    name: string,
    options: { force: boolean; deleteRemote: boolean }
  ): Promise<DeleteBranchResult> {
    assertValidBranchName(name)

    const fullPath = path.resolve(target.fullPath)
    const env = this.getEnvironmentForRepo(target)

    const currentBranch = await this.getCurrentBranch(fullPath, env)
    if (currentBranch === name) {
      throw new GitOperationError('BRANCH_CHECKED_OUT', `Cannot delete branch '${name}' because it is currently checked out`)
    }

    let upstreamRemote: string | null = null
    let upstreamBranch: string | null = null
    if (options.deleteRemote) {
      try {
        const upstream = await executeCommand(
          ['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', `${name}@{upstream}`],
          { env, silent: true }
        )
        const separator = upstream.trim().indexOf('/')
        if (separator > 0) {
          upstreamRemote = upstream.trim().slice(0, separator)
          upstreamBranch = upstream.trim().slice(separator + 1)
        }
      } catch {
        upstreamRemote = null
        upstreamBranch = null
      }
    }

    const deleteFlag = options.force ? '-D' : '-d'
    try {
      await executeCommand(['git', '-C', fullPath, 'branch', deleteFlag, '--', name], { env })
    } catch (error: unknown) {
      if (parseGitError(error).code === 'BRANCH_NOT_MERGED') {
        throw new GitOperationError('BRANCH_NOT_MERGED', `Branch '${name}' was kept because it has unmerged commits.`)
      }
      throw error
    }

    let remoteDeleted = false
    if (upstreamRemote && upstreamBranch) {
      try {
        await this.withRemoteAuth(target, async (remoteEnv) => {
          await executeCommand(
            ['git', '-C', fullPath, 'push', upstreamRemote, '--delete', upstreamBranch],
            { env: remoteEnv }
          )
        })
        remoteDeleted = true
      } catch (error: unknown) {
        throw new BranchDeleteError(getErrorMessage(error), true, false)
      }
    }

    return { remoteDeleted }
  }

  async deleteBranch(
    repoId: number,
    request: { name: string; force: boolean; deleteRemote: boolean },
    database: Database
  ): Promise<DeleteBranchResult> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    return this.deleteBranchAtPath(
      { fullPath: repo.fullPath, repoUrl: repo.repoUrl, id: repo.id },
      request.name,
      { force: request.force, deleteRemote: request.deleteRemote }
    )
  }

  private async listWorktreeCheckouts(repoPath: string, env: Record<string, string> | undefined): Promise<Array<{ path: string; branch: string | null }>> {
    try {
      const output = await executeCommand(['git', '-C', repoPath, 'worktree', 'list', '--porcelain'], { env, silent: true })
      const checkouts: Array<{ path: string; branch: string | null }> = []
      let current: { path: string; branch: string | null } | null = null

      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current) checkouts.push(current)
          current = { path: line.slice('worktree '.length).trim(), branch: null }
        } else if (line.startsWith('branch refs/heads/') && current) {
          current.branch = line.slice('branch refs/heads/'.length).trim()
        }
      }
      if (current) checkouts.push(current)

      return checkouts
    } catch {
      return []
    }
  }

  private async findCheckoutPath(repoPath: string, branch: string, env: Record<string, string> | undefined): Promise<string | null> {
    const checkouts = await this.listWorktreeCheckouts(repoPath, env)
    return checkouts.find((checkout) => checkout.branch === branch)?.path ?? null
  }

  async integrateBranch(repoId: number, request: IntegrateBranchRequest, database: Database): Promise<IntegrateBranchResult> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const sourcePath = path.resolve(repo.fullPath)
    const sourceEnv = this.getEnvironmentForRepo(repo)

    const sourceBranch = await this.resolveHeadBranch(sourcePath, sourceEnv)
    if (!sourceBranch) {
      throw new GitOperationError('INTEGRATE_DETACHED_HEAD', 'Cannot integrate from a detached HEAD')
    }

    const sourceRef = `refs/heads/${sourceBranch}`

    const targetBranch = request.targetBranch
    if (targetBranch === sourceBranch) {
      throw new GitOperationError('INTEGRATE_INTO_SELF', 'Cannot integrate a branch into itself')
    }

    const targetRef = `refs/heads/${targetBranch}`

    const targetPath = await this.findCheckoutPath(sourcePath, targetBranch, sourceEnv)
    if (!targetPath) {
      throw new GitOperationError('INTEGRATE_TARGET_NOT_CHECKED_OUT', 'Target branch is not checked out in any worktree')
    }

    const targetRepo = getRepoByDirectory(database, targetPath)
    if (!targetRepo || canonicalPathSync(path.resolve(targetRepo.fullPath)) !== canonicalPathSync(path.resolve(targetPath))) {
      throw new GitOperationError('INTEGRATE_TARGET_NOT_MANAGED', 'Target checkout is not a managed repository')
    }

    const targetEnv = this.getEnvironmentForRepo(targetRepo)
    const [porcelain, targetOperation] = await Promise.all([
      executeCommand(['git', '-C', targetPath, 'status', '--porcelain'], { env: targetEnv }),
      this.getOperationState(targetPath, targetEnv),
    ])

    const hasTrackedChanges = this.parsePorcelainOutput(porcelain).some((file) => file.status !== 'untracked')
    if (hasTrackedChanges || targetOperation) {
      throw new GitOperationError('UNCOMMITTED_CHANGES', 'You have uncommitted changes. Commit or stash them first.')
    }

    const countOutput = await executeCommand(
      ['git', '-C', sourcePath, 'rev-list', '--count', `${targetRef}..${sourceRef}`],
      { env: sourceEnv, silent: true }
    )
    const integratedCommits = Number.parseInt(countOutput.trim(), 10)
    if (!integratedCommits) {
      throw new GitOperationError('INTEGRATE_NOTHING_TO_INTEGRATE', 'Nothing to integrate')
    }

    const commandEnv = {
      ...targetEnv,
      GIT_EDITOR: 'true',
    }

    const args = request.strategy === 'cherry-pick'
      ? ['git', '-C', targetPath, 'cherry-pick', `${targetRef}..${sourceRef}`]
      : ['git', '-C', targetPath, 'merge', '--no-ff', '--no-edit', sourceRef]

    try {
      await executeCommand(args, { env: commandEnv })
    } catch (error: unknown) {
      const operation = await this.getOperationState(targetPath, targetEnv)
      if (operation) {
        throw new GitIntegrationConflictError(targetRepo.id, operation)
      }
      throw error
    }

    return { targetRepoId: targetRepo.id, integratedCommits }
  }

  async listStashes(repoId: number, database: Database): Promise<GitStashEntry[]> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const repoPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()
    const output = await executeCommand(
      ['git', '-C', repoPath, 'stash', 'list', '--format=%gd%x1f%H%x1f%gs%x1f%cI'],
      { env, silent: true }
    )

    const stashes: GitStashEntry[] = []

    for (const line of output.split('\n')) {
      if (!line.trim()) continue

      const [ref, hash, subject, date] = line.split('\x1f')
      if (!ref) continue

      const indexMatch = ref.match(/^stash@\{(\d+)\}$/)
      if (!indexMatch) continue

      const subjectMatch = subject?.match(/^(?:WIP on|On) ([^:]+): ?(.*)$/)
      stashes.push({
        index: Number(indexMatch[1]),
        ref,
        hash: hash ?? '',
        message: subjectMatch ? (subjectMatch[2] ?? '') : (subject ?? ''),
        branch: subjectMatch ? (subjectMatch[1] ?? null) : null,
        date: date ?? ''
      })
    }

    return stashes
  }

  async pushStash(repoId: number, request: StashPushRequest, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const repoPath = path.resolve(repo.fullPath)
    const env = this.getEnvironmentForRepo(repo)

    const args = ['git', '-C', repoPath, 'stash', 'push']
    if (request.includeUntracked) {
      args.push('-u')
    }
    if (request.message) {
      args.push('-m', request.message)
    }

    return executeCommand(args, { env })
  }

  async applyStash(repoId: number, index: number, hash: string, pop: boolean, database: Database): Promise<string> {
    return this.runStashCommand(repoId, index, hash, [pop ? 'pop' : 'apply'], database)
  }

  async dropStash(repoId: number, index: number, hash: string, database: Database): Promise<string> {
    return this.runStashCommand(repoId, index, hash, ['drop'], database)
  }

  private async runStashCommand(repoId: number, index: number, hash: string, action: string[], database: Database): Promise<string> {
    assertValidStashIndex(index)

    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const repoPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()
    const currentHash = await this.resolveStashHash(repoPath, index, env)
    if (!currentHash || currentHash !== hash.trim()) {
      throw new GitOperationError('STASH_CHANGED', 'The stash list changed. Refresh and try again.')
    }

    const args = ['git', '-C', repoPath, 'stash', ...action, `stash@{${index}}`]

    return executeCommand(args, { env })
  }

  private async resolveStashHash(repoPath: string, index: number, env: Record<string, string>): Promise<string | null> {
    try {
      const output = await executeCommand(['git', '-C', repoPath, 'rev-parse', `stash@{${index}}`], { env, silent: true })
      const hash = output.trim()
      return hash || null
    } catch {
      return null
    }
  }

  async continueOperation(repoId: number, database: Database): Promise<string> {
    return this.runOperationCommand(repoId, database, '--continue')
  }

  async abortOperation(repoId: number, database: Database): Promise<string> {
    return this.runOperationCommand(repoId, database, '--abort')
  }

  private async runOperationCommand(repoId: number, database: Database, action: '--continue' | '--abort'): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const repoPath = path.resolve(repo.fullPath)
    const env = this.getEnvironmentForRepo(repo)
    const operation = await this.getOperationState(repoPath, env)
    if (!operation) {
      throw new GitOperationError('NO_OPERATION_IN_PROGRESS', 'No operation in progress')
    }

    const commandEnv = action === '--continue' ? { ...env, GIT_EDITOR: 'true' } : env
    return executeCommand(['git', '-C', repoPath, operation.kind, action], { env: commandEnv })
  }

  private async getCurrentBranch(repoPath: string, env: Record<string, string> | undefined): Promise<string> {
    try {
      const branch = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
      return branch.trim()
    } catch {
      return ''
    }
  }

  private async resolveHeadBranch(repoPath: string, env: Record<string, string> | undefined): Promise<string | null> {
    try {
      const ref = await executeCommand(['git', '-C', repoPath, 'symbolic-ref', '--quiet', 'HEAD'], { env, silent: true })
      const trimmed = ref.trim()
      return trimmed.startsWith('refs/heads/') ? trimmed.slice('refs/heads/'.length) : null
    } catch {
      return null
    }
  }

  private async isBranchCheckedOutInWorktree(repoPath: string, branch: string, env: Record<string, string> | undefined): Promise<boolean> {
    return (await this.findCheckoutPath(repoPath, branch, env)) !== null
  }

  private async getBranchStatusFromPath(repoPath: string, env: Record<string, string> | undefined): Promise<{ ahead: number; behind: number }> {
    try {
      const stdout = await executeCommand(['git', '-C', repoPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { env, silent: true })
      const [ahead, behind] = stdout.trim().split(/\s+/).map(Number)

      return { ahead: ahead || 0, behind: behind || 0 }
    } catch {
      return { ahead: 0, behind: 0 }
    }
  }

  private parsePorcelainOutput(output: string): GitFileStatus[] {
    const files: GitFileStatus[] = []
    const lines = output.split('\n').filter(line => line.length > 0)

    for (const line of lines) {
      if (line.length < 3) continue

      const stagedStatus = line[0] as string
      const unstagedStatus = line[1] as string
      let filePath = line.substring(3)
      let oldPath: string | undefined

      if ((stagedStatus === 'R' || stagedStatus === 'C') && filePath.includes(' -> ')) {
        const arrowIndex = filePath.indexOf(' -> ')
        oldPath = filePath.substring(0, arrowIndex)
        filePath = filePath.substring(arrowIndex + 4)
      }

      if (stagedStatus !== ' ' && stagedStatus !== '?') {
        files.push({
          path: filePath,
          status: this.parseStatusCode(stagedStatus),
          staged: true,
          ...(oldPath && { oldPath })
        })
      }

      if (unstagedStatus === '?' && stagedStatus === '?') {
        files.push({
          path: filePath,
          status: 'untracked',
          staged: false
        })
      } else if (unstagedStatus !== ' ') {
        files.push({
          path: filePath,
          status: this.parseStatusCode(unstagedStatus),
          staged: false,
          ...(oldPath && { oldPath })
        })
      }
    }

    return files
  }

  private parseStatusCode(code: string): GitFileStatusType {
    switch (code) {
      case 'M':
        return 'modified'
      case 'A':
        return 'added'
      case 'D':
        return 'deleted'
      case 'R':
        return 'renamed'
      case 'C':
        return 'copied'
      case '?':
        return 'untracked'
      default:
        return 'modified'
    }
  }

  private async getFileStatus(repoPath: string, filePath: string, env: Record<string, string>): Promise<{ status: GitFileStatusType | 'clean' }> {
    try {
      const output = await executeCommand([
        'git', '-C', repoPath, 'status', '--porcelain', '--', filePath
      ], { env, silent: true })

      if (!output.trim()) {
        return { status: 'clean' }
      }

      const parsed = this.parsePorcelainOutput(output)
      const firstFile = parsed[0]

      if (!firstFile) {
        return { status: 'clean' }
      }

      return { status: firstFile.status }
    } catch {
      return { status: 'clean' }
    }
  }

  private async getUntrackedFileDiff(repoPath: string, filePath: string, env: Record<string, string>): Promise<FileDiffResponse> {
    const result = await executeCommand([
      'git', '-C', repoPath, 'diff', '--no-index', '--', '/dev/null', filePath
    ], { env, ignoreExitCode: true })

    if (typeof result === 'string') {
      return this.parseDiffOutput(result, 'untracked', filePath)
    }

    return this.parseDiffOutput((result as { stdout: string }).stdout, 'untracked', filePath)
  }

  private async getTrackedFileDiff(repoPath: string, filePath: string, env: Record<string, string>, includeStaged: boolean, options?: GitDiffOptions): Promise<FileDiffResponse> {
    try {
      const hasCommits = await this.hasCommits(repoPath)
      const diffArgs = ['git', '-C', repoPath, 'diff']

      if (options?.showContext !== undefined) {
        diffArgs.push(`-U${options.showContext}`)
      }

      if (options?.ignoreWhitespace) {
        diffArgs.push('--ignore-all-space')
      }

      if (options?.unified !== undefined) {
        diffArgs.push(`--unified=${options.unified}`)
      }

      if (hasCommits) {
        if (includeStaged) {
          diffArgs.push('HEAD', '--', filePath)
        } else {
          diffArgs.push('--', filePath)
        }
      } else {
        return {
          path: filePath,
          status: 'added',
          diff: `New file (no commits yet): ${filePath}`,
          additions: 0,
          deletions: 0,
          isBinary: false
        }
      }

      const diff = await executeCommand(diffArgs, { env })
      return this.parseDiffOutput(diff, 'modified', filePath)
    } catch (error) {
      logger.warn(`Failed to get diff for tracked file ${filePath}:`, error)
      throw new Error(`Failed to get file diff: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private parseDiffOutput(diff: string, status: string, filePath?: string): FileDiffResponse {
    let additions = 0
    let deletions = 0
    let isBinary = false
    const MAX_DIFF_SIZE = 500 * 1024

    if (typeof diff === 'string') {
      if (diff.includes('Binary files') || diff.includes('GIT binary patch')) {
        isBinary = true
      } else {
        const lines = diff.split('\n')
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++
          if (line.startsWith('-') && !line.startsWith('---')) deletions++
        }
      }
    }

    let diffOutput = typeof diff === 'string' ? diff : ''
    let truncated = false
    if (diffOutput.length > MAX_DIFF_SIZE) {
      diffOutput = diffOutput.substring(0, MAX_DIFF_SIZE) + '\n\n... (diff truncated due to size)'
      truncated = true
    }

    return {
      path: filePath || '',
      status: status as GitFileStatusType,
      diff: diffOutput,
      additions,
      deletions,
      isBinary,
      truncated
    }
  }

  private async hasCommits(repoPath: string): Promise<boolean> {
    try {
      await executeCommand(['git', '-C', repoPath, 'rev-parse', 'HEAD'], { silent: true })
      return true
    } catch {
      return false
    }
  }

  private async isCommitUnpushed(repoPath: string, commitHash: string, env: Record<string, string>): Promise<boolean> {
    const unpushedHashes = await this.getUnpushedCommitHashes(repoPath, env)
    return unpushedHashes.has(commitHash)
  }

  private async getUnpushedCommitHashes(repoPath: string, env: Record<string, string>): Promise<Set<string>> {
    try {
      const output = await executeCommand(
        ['git', '-C', repoPath, 'log', '--not', '--remotes', '--format=%H'],
        { env, silent: true }
      )
      const hashes = output.trim().split('\n').filter(Boolean)
      return new Set(hashes)
    } catch {
      return new Set()
    }
  }

  private async pushWithUpstream(_repoId: number, fullPath: string, env: Record<string, string>): Promise<string> {
    const branchName = await this.resolveHeadBranch(fullPath, env)

    if (!branchName) {
      throw new Error('Unable to detect current branch. Ensure you are on a branch before pushing with --set-upstream.')
    }

    const args = ['git', '-C', fullPath, 'push', '--set-upstream', 'origin', branchName]
    return executeCommand(args, { env })
  }
}

export function createGitService(gitAuthService: GitAuthService): GitService {
  return new GitService(gitAuthService)
}
