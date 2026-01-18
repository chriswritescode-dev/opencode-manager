import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { getRepoById } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import { getReposPath } from '@opencode-manager/shared/config/env'
import path from 'path'
import { logger } from '../../utils/logger'
import type { FileDiffResponse, GitDiffOptions, GitFileStatusType } from '../../types/git'
import type { GitDiffProvider } from './interfaces'

export class GitDiffService implements GitDiffProvider {
  constructor(private gitAuthService: GitAuthService) {}

  async getFileDiff(repoId: number, filePath: string, database: Database, options?: GitDiffOptions): Promise<FileDiffResponse> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found: ${repoId}`)
    }

    const repoPath = path.resolve(getReposPath(), repo.localPath)
    const env = this.gitAuthService.getGitEnvironment()

    // Get file status first
    const status = await this.getFileStatus(repoPath, filePath, env)

    if (status.status === 'untracked') {
      return this.getUntrackedFileDiff(repoPath, filePath, env)
    }

    return this.getTrackedFileDiff(repoPath, filePath, env, options)
  }

  private async getFileStatus(repoPath: string, filePath: string, env: Record<string, string>): Promise<{ status: string }> {
    try {
      const output = await executeCommand([
        'git', '-C', repoPath, 'status', '--porcelain', '--', filePath
      ], { env, silent: true })

      if (!output.trim()) {
        return { status: 'untracked' }
      }

      const statusCode = output.trim().split(' ')[0]
      return { status: statusCode || 'untracked' }
    } catch {
      return { status: 'untracked' }
    }
  }

  private async getUntrackedFileDiff(repoPath: string, filePath: string, env: Record<string, string>): Promise<FileDiffResponse> {
    const result = await executeCommand([
      'git', '-C', repoPath, 'diff', '--no-index', '--', '/dev/null', filePath
    ], { env, ignoreExitCode: true })

    if (typeof result === 'string') {
      return this.parseDiffOutput(result, 'untracked', filePath)
    }

    // Non-zero exit, but still parse stdout
    return this.parseDiffOutput((result as { stdout: string }).stdout, 'untracked', filePath)
  }

  private async getTrackedFileDiff(repoPath: string, filePath: string, env: Record<string, string>, options?: GitDiffOptions): Promise<FileDiffResponse> {
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
        diffArgs.push('HEAD', '--', filePath)
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

    return {
      path: filePath || '',
      status: status as GitFileStatusType,
      diff: typeof diff === 'string' ? diff : '',
      additions,
      deletions,
      isBinary
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

  async getFullDiff(repoId: number, filePath: string, database: Database, options?: GitDiffOptions): Promise<FileDiffResponse> {
    return this.getFileDiff(repoId, filePath, database, options)
  }
}