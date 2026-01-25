import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { getRepoById } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import path from 'path'
import { logger } from '../../utils/logger'

interface GitBranch {
  name: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
  isWorktree?: boolean
}

export class GitBranchService {
  constructor(private gitAuthService: GitAuthService) {}

  async getBranches(repoId: number, database: Database): Promise<GitBranch[]> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

    let currentBranch = ''
    try {
      const currentStdout = await executeCommand(['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
      currentBranch = currentStdout.trim()
    } catch {
      void null
    }

    const stdout = await executeCommand(['git', '-C', fullPath, 'branch', '-vv', '-a'], { env, silent: true })
    const lines = stdout.split('\n').filter(line => line.trim())

    const branches: GitBranch[] = []
    const seenNames = new Set<string>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const isCurrent = trimmed.startsWith('*')
      const isWorktree = trimmed.startsWith('+')
      const namePart = trimmed.replace(/^[*+]?\s*/, '')

      const firstSpace = namePart.indexOf(' ')
      const firstBracket = namePart.indexOf('[')
      const cutIndex = firstSpace === -1 ? (firstBracket === -1 ? namePart.length : firstBracket) : (firstBracket === -1 ? firstSpace : Math.min(firstSpace, firstBracket))
      const branchName = namePart.slice(0, cutIndex).trim()

      if (!branchName || branchName === '+' || branchName === '->' || branchName.includes('->')) continue
      if (/^[0-9a-f]{6,40}$/.test(branchName)) continue

      const branch: GitBranch = {
        name: branchName,
        type: branchName.startsWith('remotes/') ? 'remote' : 'local',
        current: isCurrent && (branchName === currentBranch || branchName === `remotes/${currentBranch}`),
        isWorktree
      }

      if (seenNames.has(branch.name)) continue
      seenNames.add(branch.name)

      const upstreamMatch = namePart.match(/\[([^:]+):?\s*(ahead\s+(\d+))?,?\s*(behind\s+(\d+))?\]/)
      if (upstreamMatch) {
        branch.upstream = upstreamMatch[1]
        branch.ahead = upstreamMatch[3] ? parseInt(upstreamMatch[3]) : 0
        branch.behind = upstreamMatch[5] ? parseInt(upstreamMatch[5]) : 0
      }

      if (branch.current && (!branch.ahead || !branch.behind)) {
        try {
          const status = await this.getBranchStatus(repoId, database)
          branch.ahead = status.ahead
          branch.behind = status.behind
        } catch {
          void null
        }
      }

      branches.push(branch)
    }

    return branches.sort((a, b) => {
      if (a.current !== b.current) return b.current ? 1 : -1
      if (a.type !== b.type) return a.type === 'local' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async getBranchStatus(repoId: number, database: Database): Promise<{ ahead: number; behind: number }> {
    try {
      const repo = getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const fullPath = path.resolve(repo.fullPath)
      const env = this.gitAuthService.getGitEnvironment()

      const stdout = await executeCommand(['git', '-C', fullPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { env, silent: true })
      const [ahead, behind] = stdout.trim().split(/\s+/).map(Number)

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
    const env = this.gitAuthService.getGitEnvironment()

    const result = await executeCommand(['git', '-C', fullPath, 'checkout', '-b', branchName], { env })

    return result
  }

  async switchBranch(repoId: number, branchName: string, database: Database): Promise<string> {
    const repo = getRepoById(database, repoId)
    if (!repo) {
      throw new Error(`Repository not found`)
    }

    const fullPath = path.resolve(repo.fullPath)
    const env = this.gitAuthService.getGitEnvironment()

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