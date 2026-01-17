import { GitAuthService } from '../../utils/git-auth'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import * as db from '../../db/queries'
import type { Database } from 'bun:sqlite'

import { GitAuthenticationError, GitNotFoundError, GitOperationError } from '../../errors/git-errors'
import { GitCommandUtils } from '../../utils/git-command-utils'

export class GitCommitService {
  constructor(private gitAuthService: GitAuthService) {}

  async commit(repoId: number, message: string, database: Database, stagedPaths?: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const args = ['git', '-C', repoPath, 'commit', '-m', message]

      if (stagedPaths && stagedPaths.length > 0) {
        args.push('--')
        args.push(...stagedPaths)
      }

      const result = await GitCommandUtils.executeCommandWithStderr(args, { env })

      return result
    } catch (error: unknown) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = getErrorMessage(error)
      logger.error(`Failed to commit changes for repo ${repoId}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to commit changes: ${errorMessage}`)
    }
  }

  async stageFiles(repoId: number, paths: string[], database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      if (paths.length === 0) {
        return { stdout: '', stderr: '' }
      }

      const args = ['git', '-C', repoPath, 'add', '--', ...paths]
      const result = await GitCommandUtils.executeCommandWithStderr(args, { env })

      return result
    } catch (error: unknown) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = getErrorMessage(error)
      logger.error(`Failed to stage files for repo ${repoId}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to stage files: ${errorMessage}`)
    }
  }

  async unstageFiles(repoId: number, paths: string[], database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      if (paths.length === 0) {
        return { stdout: '', stderr: '' }
      }

      const args = ['git', '-C', repoPath, 'restore', '--staged', '--', ...paths]
      const result = await GitCommandUtils.executeCommandWithStderr(args, { env })

      return result
    } catch (error: unknown) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = getErrorMessage(error)
      logger.error(`Failed to unstage files for repo ${repoId}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to unstage files: ${errorMessage}`)
    }
  }



  async resetToCommit(repoId: number, commitHash: string, database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const args = ['git', '-C', repoPath, 'reset', '--hard', commitHash]
      const result = await GitCommandUtils.executeCommandWithStderr(args, { env })

      return result
    } catch (error: unknown) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = getErrorMessage(error)
      logger.error(`Failed to reset to commit ${commitHash} for repo ${repoId}:`, error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to reset to commit: ${errorMessage}`)
    }
  }
}
