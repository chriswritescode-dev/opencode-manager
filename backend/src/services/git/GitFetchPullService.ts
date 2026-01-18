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
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment(true)

    return executeCommand(['git', '-C', fullPath, 'fetch', '--all', '--prune'], { env })
  }

  async pull(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment(false)

    return executeCommand(['git', '-C', fullPath, 'pull'], { env })
  }
}