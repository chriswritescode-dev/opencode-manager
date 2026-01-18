import { executeCommand } from '../../utils/process'
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
    const repo = db.getRepoById(database, repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const fullPath = path.resolve(repo.fullPath)
    const args = ['git', '-C', fullPath, 'push']

    if (options.setUpstream) {
      args.push('--set-upstream', 'origin', 'HEAD')
    }

    const env = this.gitAuthService.getGitEnvironment()
    return executeCommand(args, { env })
  }
}
