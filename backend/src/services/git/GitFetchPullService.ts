import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { getRepoById } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import path from 'path'

export class GitFetchPullService {
  constructor(private gitAuthService: GitAuthService) {}

  async fetch(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = await this.gitAuthService.getGitEnvironment(repoId, database)

    const result = await executeCommand(['git', '-C', fullPath, 'fetch', '--all', '--prune-tags'], { env })

    return result
  }

  async pull(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = await this.gitAuthService.getGitEnvironment(repoId, database)

    const result = await executeCommand(['git', '-C', fullPath, 'pull'], { env })

    return result
  }
}