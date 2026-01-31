import { executeCommand } from '../../utils/process'
import { GitAuthService } from '../git-auth'
import { GitBranchService } from './GitBranchService'
import { isNoUpstreamError, parseBranchNameFromError } from '../../utils/git-errors'
import type { Database } from 'bun:sqlite'
import * as db from '../../db/queries'
import path from 'path'

export class GitPushService {
  constructor(
    private gitAuthService: GitAuthService,
    private branchService: GitBranchService
  ) {}

  async push(
    repoId: number,
    options: { setUpstream?: boolean },
    database: Database
  ): Promise<string> {
    const repo = db.getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

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
  }

  private async pushWithUpstream(
    repoId: number,
    fullPath: string,
    env: Record<string, string>
  ): Promise<string> {
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
