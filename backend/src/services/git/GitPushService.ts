import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { GitAuthService } from '../git-auth'
import type { Database } from 'bun:sqlite'
import * as db from '../../db/queries'
import path from 'path'

export class GitPushService {
  constructor(private gitAuthService: GitAuthService) {}

  async push(
    repoId: number,
    options: { setUpstream?: boolean },
    database: Database
  ): Promise<string> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const args = ['git', '-C', fullPath, 'push']

      if (options.setUpstream) {
        args.push('--set-upstream')
        args.push('origin')
        args.push('HEAD')
      }

      const env = this.gitAuthService.getGitEnvironment()
      logger.info(`Git push environment: GIT_ASKPASS=${env.GIT_ASKPASS}, VSCODE_GIT_IPC_HANDLE=${env.VSCODE_GIT_IPC_HANDLE}, VSCODE_GIT_ASKPASS_NODE=${env.VSCODE_GIT_ASKPASS_NODE}, VSCODE_GIT_ASKPASS_MAIN=${env.VSCODE_GIT_ASKPASS_MAIN}`)
      const stdout = await executeCommand(args, { env })

      logger.info(`Successfully pushed changes for repo ${repoId}`)

      return stdout
    } catch (error: unknown) {
      logger.error(`Failed to push changes for repo ${repoId}:`, error)
      throw error
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const fullPath = path.resolve(repoPath)
      const env = this.gitAuthService.getGitEnvironment()

      const stdout = await executeCommand(
        ['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env, silent: true }
      )

      return stdout.trim()
    } catch (error: unknown) {
      logger.error(`Failed to get current branch for ${repoPath}:`, error)
      throw error
    }
  }

  async getUpstreamBranch(repoPath: string): Promise<string | null> {
    try {
      const fullPath = path.resolve(repoPath)
      const env = this.gitAuthService.getGitEnvironment()

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
      logger.error(`Failed to get upstream branch for ${repoPath}:`, error)
      throw error
    }
  }
}
