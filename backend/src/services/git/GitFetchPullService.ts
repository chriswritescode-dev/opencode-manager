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
    const args = ['git', '-C', fullPath, 'fetch', '--all', '--prune-tags']
    const env = this.gitAuthService.getGitEnvironment(true)

    const result = await executeCommand(args, { env })

    return result
  }

  async pull(repoId: number, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment(false)

    try {
      await executeCommand(['git', '-C', fullPath, 'rev-parse', '@{upstream}'], { env, silent: true })
    } catch {
      const currentBranch = (await executeCommand(['git', '-C', fullPath, 'branch', '--show-current'], { env, silent: true })).trim()
      if (!currentBranch) {
        throw new Error('No current branch')
      }

      try {
        await executeCommand(['git', '-C', fullPath, 'remote', 'get-url', 'origin'], { env, silent: true })
        await executeCommand(['git', '-C', fullPath, 'branch', '--set-upstream-to=origin/' + currentBranch, currentBranch], { env, silent: true })
      } catch {
        throw new Error('No upstream branch set and no remote origin available')
      }
    }

    const args = ['git', '-C', fullPath, 'pull']

    const result = await executeCommand(args, { env })

    return result
  }
}