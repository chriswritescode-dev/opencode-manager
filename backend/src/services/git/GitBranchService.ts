import { GitAuthService } from '../../utils/git-auth'
import { GitCommandUtils } from '../../utils/git-command-utils'
import { executeCommand } from '../../utils/process'
import { getRepoById } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import path from 'path'
import { logger } from '../../utils/logger'
import { GitAuthenticationError, GitConflictError, GitNotFoundError, GitOperationError } from '../../errors/git-errors'

export class GitBranchService {
  constructor(private gitAuthService: GitAuthService) {}

  async getBranches(repoId: number, database: Database): Promise<string[]> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment(database)

      const stdout = await executeCommand(['git', '-C', fullPath, 'branch', '-a'], { env, silent: true })
      const branches = stdout
        .split('\n')
        .map(line => line.trim().replace(/^\*?\s*/, ''))
        .filter(line => line.length > 0)
        .map(branch => branch.replace('remotes/origin/', ''))
        .filter((value, index, self) => self.indexOf(value) === index)

      return branches
    } catch (error) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to get branches: ${errorMessage}`)
    }
  }

  async getBranchStatus(repoId: number, database: Database): Promise<{ ahead: number; behind: number }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment(database)

      const stdout = await executeCommand(['git', '-C', fullPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { env, silent: true })
      const [behind, ahead] = stdout.trim().split(/\s+/).map(Number)

      return { ahead: ahead || 0, behind: behind || 0 }
    } catch (error) {
      logger.warn(`Could not get branch status for repo ${repoId}, returning zeros:`, error)
      return { ahead: 0, behind: 0 }
    }
  }

  async createBranch(repoId: number, branchName: string, database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment(database)

      const result = await GitCommandUtils.executeCommandWithStderr(['git', '-C', fullPath, 'checkout', '-b', branchName], { env })

      return result
    } catch (error) {
      if (error instanceof GitNotFoundError || error instanceof GitAuthenticationError || error instanceof GitOperationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (GitCommandUtils.isAuthenticationError(errorMessage)) {
        throw new GitAuthenticationError('Authentication failed. Check your Git credentials in Settings.')
      }
      throw new GitOperationError(`Failed to create branch: ${errorMessage}`)
    }
  }

  async switchBranch(repoId: number, branchName: string, database: Database): Promise<{ stdout: string; stderr: string }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new GitNotFoundError(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment(database)

      const result = await GitCommandUtils.executeCommandWithStderr(['git', '-C', fullPath, 'checkout', branchName], { env })

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
      throw new GitOperationError(`Failed to switch branch: ${errorMessage}`)
    }
  }

  async hasCommits(repoPath: string): Promise<boolean> {
    try {
      await executeCommand(['git', '-C', repoPath, 'rev-parse', 'HEAD'], { silent: true })
      return true
    } catch {
      return false
    }
  }
}