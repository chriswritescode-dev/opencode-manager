import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { getRepoById } from '../../db/queries'
import { resolveGitIdentity, createGitIdentityEnv, isSSHUrl, filterGitCredentials } from '../../utils/git-auth'
import { isNoUpstreamError, parseBranchNameFromError } from '../../utils/git-errors'
import { SettingsService } from '../settings'
import type { Database } from 'bun:sqlite'
import type { GitBranch, GitCommit, FileDiffResponse, GitDiffOptions, GitStatusResponse, GitFileStatus, GitFileStatusType, CommitDetails, CommitFile } from '../../types/git'
import type { GitCredential } from '@opencode-manager/shared'
import path from 'path'
import fs from 'fs/promises'

export class GitService {
  constructor(
    private gitAuthService: GitAuthService,
    private settingsService: SettingsService
  ) {}

  async getStatus(repoId: number, database: Database): Promise<GitStatusResponse> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      const [branch, branchStatus, porcelainOutput] = await Promise.all([
        this.getCurrentBranch(repoPath, env),
        this.getBranchStatusFromPath(repoPath, env),
        executeCommand(['git', '-C', repoPath, 'status', '--porcelain'], { env })
      ])

      const files = this.parsePorcelainOutput(porcelainOutput)
      const hasChanges = files.length > 0

      return {
        branch,
        ahead: branchStatus.ahead,
        behind: branchStatus.behind,
        files,
        hasChanges
      }
    } catch (error: unknown) {
      logger.error(`Failed to get status for repo ${repoId}:`, error)
      throw error
    }
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

  async getLog(repoId: number, database: Database, limit: number = 10): Promise<GitCommit[]> {
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
        `--all`,
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
      const authEnv = this.gitAuthService.getGitEnvironment()

      const settings = this.settingsService.getSettings('default')
      const gitCredentials = filterGitCredentials(settings.preferences.gitCredentials || [])
      const identity = await resolveGitIdentity(settings.preferences.gitIdentity, gitCredentials)
      const identityEnv = identity ? createGitIdentityEnv(identity) : {}

      const env = { ...authEnv, ...identityEnv }

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

      for (const untrackedPath of untrackedPaths) {
        const fullPath = path.join(repoPath, untrackedPath)
        await fs.unlink(fullPath).catch(() => {})
      }

      return results.join('\n')
    } catch (error: unknown) {
      logger.error(`Failed to discard changes for repo ${repoId}:`, error)
      throw error
    }
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
        ['git', '-C', repoPath, 'log', '-1', '--format=%H|%an|%ae|%at|%s', hash],
        { env }
      )

      if (!commitOutput.trim()) {
        return null
      }

      const parts = commitOutput.trim().split('|')
      const [commitHash, authorName, authorEmail, timestamp, ...messageParts] = parts
      const message = messageParts.join('|')

      if (!commitHash) {
        return null
      }

      const filesOutput = await executeCommand(
        ['git', '-C', repoPath, 'show', '--name-status', '--format=', hash],
        { env }
      )

      const numstatOutput = await executeCommand(
        ['git', '-C', repoPath, 'show', '--numstat', '--format=', hash],
        { env }
      )

      const files: CommitFile[] = []
      const lines = filesOutput.trim().split('\n')
      const numstatLines = numstatOutput.trim().split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line?.trim()) continue
        
        const parts = line.split('\t')
        if (parts.length >= 2 && parts[0] && parts[0].match(/^[AMDRC]/)) {
          const statusCode = parts[0]
          const fromPath = parts[1] || ''
          const toPath = parts[2] || parts[1] || ''
          const isRename = statusCode === 'R'
          const isCopy = statusCode === 'C'
          
          let status: GitFileStatusType = 'modified'
          switch (statusCode.charAt(0)) {
            case 'A': status = 'added'; break
            case 'D': status = 'deleted'; break
            case 'R': status = 'renamed'; break
            case 'C': status = 'copied'; break
            case 'M': status = 'modified'; break
          }
          
          let additions = 0
          let deletions = 0
          const numstatLine = numstatLines[i]
          if (numstatLine) {
            const numstatParts = numstatLine.split('\t')
            if (numstatParts.length >= 2 && numstatParts[0]?.match(/^\d+$/) && numstatParts[1]?.match(/^\d+$/)) {
              additions = parseInt(numstatParts[0], 10)
              deletions = parseInt(numstatParts[1], 10)
            }
          }
          
          files.push({
            path: toPath,
            status,
            oldPath: isRename || isCopy ? fromPath : undefined,
            additions,
            deletions
          })
        }
      }

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

      return this.parseDiffOutput(diff, 'modified', filePath)
    } catch (error: unknown) {
      logger.error(`Failed to get commit diff for repo ${repoId}:`, error)
      throw new Error(`Failed to get commit diff: ${getErrorMessage(error)}`)
    }
  }

  private async setupSSHIfNeeded(repoUrl: string | undefined, database: Database): Promise<void> {
    await this.gitAuthService.setupSSHForRepoUrl(repoUrl, database)
  }

  private async cleanupSSHForRepo(): Promise<void> {
    await this.gitAuthService.cleanupSSHKey()
  }

  private getEnvironmentForRepo(repo: { repoUrl?: string; fullPath: string }, silent: boolean = false): Record<string, string> {
    if (!repo.repoUrl) {
      return this.gitAuthService.getGitEnvironment(silent)
    }

    const isSSH = isSSHUrl(repo.repoUrl)
    const baseEnv = this.gitAuthService.getGitEnvironment(silent)

    if (!isSSH) {
      return baseEnv
    }

    const sshEnv = this.gitAuthService.getSSHEnvironment()
    return { ...baseEnv, ...sshEnv }
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

    await this.setupSSHIfNeeded(repo.repoUrl, database)

    try {
      const env = this.getEnvironmentForRepo(repo)
      if (options.setUpstream) {
        return await this.pushWithUpstream(repoId, fullPath, env)
      }

      try {
        const args = ['git', '-C', fullPath, 'push']
        return await executeCommand(args, { env })
      } catch (error) {
        if (isNoUpstreamError(error as Error)) {
          return await this.pushWithUpstream(repoId, fullPath, env)
        }
        throw error
      }
    } finally {
      await this.cleanupSSHForRepo()
    }
  }

  async fetch(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)

    await this.setupSSHIfNeeded(repo.repoUrl, database)

    try {
      const env = this.getEnvironmentForRepo(repo, true)
      return await executeCommand(['git', '-C', fullPath, 'fetch', '--all', '--prune'], { env })
    } finally {
      await this.cleanupSSHForRepo()
    }
  }

  async pull(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)

    await this.setupSSHIfNeeded(repo.repoUrl, database)

    try {
      const env = this.getEnvironmentForRepo(repo, false)
      return await executeCommand(['git', '-C', fullPath, 'pull'], { env })
    } finally {
      await this.cleanupSSHForRepo()
    }
  }

  async getBranches(repoId: number, database: Database): Promise<GitBranch[]> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    let currentBranch = ''
    try {
      const currentStdout = await executeCommand(['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
      currentBranch = currentStdout.trim()
    } catch {
      void 0
    }

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
        current: isCurrent && (branchName === currentBranch || branchName === `remotes/${currentBranch}`),
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

  async createBranch(repoId: number, branchName: string, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    const result = await executeCommand(['git', '-C', fullPath, 'checkout', '-b', branchName], { env })

    return result
  }

  async switchBranch(repoId: number, branchName: string, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    const result = await executeCommand(['git', '-C', fullPath, 'checkout', branchName], { env })

    return result
  }

  private async getCurrentBranch(repoPath: string, env: Record<string, string> | undefined): Promise<string> {
    try {
      const branch = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
      return branch.trim()
    } catch {
      return ''
    }
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
    try {
      await executeCommand(
        ['git', '-C', repoPath, 'merge-base', '--is-ancestor', commitHash, 'HEAD'],
        { env, silent: true }
      )
      return false
    } catch {
      return true
    }
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

  private async pushWithUpstream(repoId: number, fullPath: string, env: Record<string, string>): Promise<string> {
    let branchName: string | null = null

    try {
      const result = await executeCommand(
        ['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env }
      )
      branchName = result.trim()
      if (branchName === 'HEAD') {
        branchName = null
      }
    } catch (error) {
      branchName = parseBranchNameFromError(error as Error)
    }

    if (!branchName) {
      throw new Error('Unable to detect current branch. Ensure you are on a branch before pushing with --set-upstream.')
    }

    const args = ['git', '-C', fullPath, 'push', '--set-upstream', 'origin', branchName]
    return executeCommand(args, { env })
  }
}
