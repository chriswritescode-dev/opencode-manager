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

    // Get current branch
    let currentBranch = ''
    try {
      const currentStdout = await executeCommand(['git', '-C', fullPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
      currentBranch = currentStdout.trim()
    } catch {
      // Handle detached HEAD or no branches
    }

    // Get all branches with upstream info
    const stdout = await executeCommand(['git', '-C', fullPath, 'branch', '-vv', '-a'], { env, silent: true })
    const lines = stdout.split('\n').filter(line => line.trim())

    const branches: GitBranch[] = []
    const seenNames = new Set<string>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const isCurrent = trimmed.startsWith('*')
      const namePart = trimmed.replace(/^\*?\s*/, '')
      
      // Parse branch name and upstream info from "branchName [upstream: ahead 2, behind 1]" format
      const match = namePart.match(/^([^\s]+)\s*(\[([^\]]+)\])?$/)
      if (!match) continue

      const name = match[1]
      if (!name) continue
      const upstreamInfo = match[3]

      // Skip duplicates
      if (seenNames.has(name)) continue
      seenNames.add(name)

      const branch: GitBranch = {
        name,
        type: name.startsWith('origin/') ? 'remote' : 'local',
        current: isCurrent && name === currentBranch
      }

      // Parse upstream and ahead/behind info
      if (upstreamInfo) {
        const upstreamMatch = upstreamInfo.match(/^([^:]+):?\s*(ahead\s+(\d+))?,?\s*(behind\s+(\d+))?/)
        if (upstreamMatch) {
          branch.upstream = upstreamMatch[1]
          branch.ahead = upstreamMatch[3] ? parseInt(upstreamMatch[3]) : 0
          branch.behind = upstreamMatch[5] ? parseInt(upstreamMatch[5]) : 0
        }
      }

      // Get ahead/behind for current branch if not in upstream info
      if (branch.current && (!branch.ahead || !branch.behind)) {
        try {
          const status = await this.getBranchStatus(repoId, database)
          branch.ahead = status.ahead
          branch.behind = status.behind
        } catch {
          // Keep default values
        }
      }

      branches.push(branch)
    }

    // Sort: local branches first, then remotes, with current branch first
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