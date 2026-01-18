import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { getRepoById } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import path from 'path'
import { logger } from '../../utils/logger'

export class GitBranchService {
  constructor(private gitAuthService: GitAuthService) {}

  async getBranches(repoId: number, database: Database): Promise<string[]> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = await this.gitAuthService.getGitEnvironment(repoId, database)

    const stdout = await executeCommand(['git', '-C', fullPath, 'branch', '-a'], { env, silent: true })
    const branches = stdout
      .split('\n')
      .map(line => line.trim().replace(/^\*?\s*/, ''))
      .filter(line => line.length > 0)
      .map(branch => branch.startsWith('remotes/origin/') ? branch.replace('remotes/origin/', 'origin/') : branch)
      .filter((value, index, self) => self.indexOf(value) === index)

    return branches
  }

  async getBranchStatus(repoId: number, database: Database): Promise<{ ahead: number; behind: number }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const stdout = await executeCommand(['git', '-C', fullPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { env, silent: true })
      const [behind, ahead] = stdout.trim().split(/\s+/).map(Number)

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
    const env = await this.gitAuthService.getGitEnvironment(repoId, database)

    const result = await executeCommand(['git', '-C', fullPath, 'checkout', '-b', branchName], { env })

    return result
  }

  async switchBranch(repoId: number, branchName: string, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = await this.gitAuthService.getGitEnvironment(repoId, database)

    const result = await executeCommand(['git', '-C', fullPath, 'checkout', branchName], { env })

    return result
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