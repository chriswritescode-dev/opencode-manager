import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { GitAuthService, createNoPromptGitEnv } from '../../utils/git-auth'
import type { Database } from 'bun:sqlite'
import * as db from '../../db/queries'
import path from 'path'
import { GitAuthenticationError, GitConflictError, GitNotFoundError, GitOperationError } from '../../errors/git-errors'
import { GitCommandUtils } from '../../utils/git-command-utils'

export class GitPushService {
  constructor(private gitAuthService: GitAuthService) {}

  async push(
    repoId: number,
    options: { setUpstream?: boolean },
    database: Database
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)
      const args = ['git', '-C', fullPath, 'push']

      if (options.setUpstream) {
        args.push('--set-upstream')
        args.push('origin')
        args.push('HEAD')
      }

      const stdout = await executeCommand(args, { env })

      logger.info(`Successfully pushed changes for repo ${repoId}`)

      return { stdout, stderr: '' }
    } catch (error: unknown) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitConflictError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = getErrorMessage(error)
      logger.error(`Failed to push changes for repo ${repoId}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      if (GitCommandUtils.isConflictError(errorMessage)) {
        throw new GitConflictError('Merge conflict detected. Resolve conflicts and try again.')
      }
      throw new GitOperationError(`Failed to push changes: ${errorMessage}`)
    }
  }

  async getCurrentBranch(repoPath: string, database: Database): Promise<string> {
    try {
      const fullPath = path.resolve(repoPath)
      const env = createNoPromptGitEnv()

      const stdout = await executeCommand(
        ['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env, silent: true }
      )

      return stdout.trim()
    } catch (error: unknown) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = getErrorMessage(error)
      logger.error(`Failed to get current branch for ${repoPath}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to get current branch: ${errorMessage}`)
    }
  }

  async getUpstreamBranch(repoPath: string, database: Database): Promise<string | null> {
    try {
      const fullPath = path.resolve(repoPath)
      const env = createNoPromptGitEnv()

      const stdout = await executeCommand(
        ['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', '@{upstream}'],
        { env, silent: true }
      )

      const branch = stdout.trim()
      return branch || null
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error)
      if (
        errorMessage?.includes('no upstream configured') ||
        errorMessage?.includes('fatal') ||
        errorMessage?.includes('does not point at a branch')
      ) {
        return null
      }
      if (error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      logger.error(`Failed to get upstream branch for ${repoPath}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to get upstream branch: ${errorMessage}`)
    }
  }
}
