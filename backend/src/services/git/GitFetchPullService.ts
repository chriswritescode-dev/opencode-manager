import { GitAuthService } from '../../utils/git-auth'
import { GitCommandUtils } from '../../utils/git-command-utils'
import { getRepoById } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import path from 'path'
import { GitAuthenticationError, GitConflictError, GitNotFoundError, GitOperationError } from '../../errors/git-errors'

export class GitFetchPullService {
  constructor(private gitAuthService: GitAuthService) {}

  async fetch(repoId: number, database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const result = await GitCommandUtils.executeCommandWithStderr(['git', '-C', fullPath, 'fetch', '--all', '--prune-tags'], { env })

      return result
    } catch (error) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitConflictError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to fetch changes: ${errorMessage}`)
    }
  }

  async pull(repoId: number, database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const result = await GitCommandUtils.executeCommandWithStderr(['git', '-C', fullPath, 'pull'], { env })

      return result
    } catch (error) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitConflictError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      if (GitCommandUtils.isConflictError(errorMessage)) {
        throw new GitConflictError('Merge conflict detected. Resolve conflicts and try again.')
      }
      throw new GitOperationError(`Failed to pull changes: ${errorMessage}`)
    }
  }
}