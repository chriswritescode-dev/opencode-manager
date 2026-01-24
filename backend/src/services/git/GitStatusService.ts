import { GitAuthService } from '../git-auth'
import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import * as db from '../../db/queries'
import type { Database } from 'bun:sqlite'
import type { GitFileStatus, GitStatusResponse } from '../../types/git'

export class GitStatusService {
  constructor(private gitAuthService: GitAuthService) {}

  async getStatus(repoId: number, database: Database): Promise<GitStatusResponse> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found`)
      }

      const repoPath = repo.fullPath
      const env = this.gitAuthService.getGitEnvironment()

      const [branch, branchStatus, porcelainOutput] = await Promise.all([
        this.getCurrentBranch(repoPath, env),
        this.getBranchStatus(repoPath, env),
        executeCommand(['git', '-C', repoPath, 'status', '--porcelain'], { env })
      ])

      const files = this.parsePorcelainOutput(porcelainOutput)
      const hasChanges = files.length > 0

      return {
        branch,
        ahead: branchStatus.ahead,
        behind: branchStatus.behind,
        files,
        hasChanges
      }
    } catch (error: unknown) {
      logger.error(`Failed to get status for repo ${repoId}:`, error)
      throw error
    }
  }

  private async getCurrentBranch(repoPath: string, env: Record<string, string> | undefined): Promise<string> {
    try {
      const branch = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
      return branch.trim()
    } catch {
      return ''
    }
  }

  private async getBranchStatus(repoPath: string, env: Record<string, string> | undefined): Promise<{ ahead: number; behind: number }> {
    try {
      const stdout = await executeCommand(['git', '-C', repoPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { env, silent: true })
      const [ahead, behind] = stdout.trim().split(/\s+/).map(Number)

      return { ahead: ahead || 0, behind: behind || 0 }
    } catch {
      return { ahead: 0, behind: 0 }
    }
  }

  private parsePorcelainOutput(output: string): GitFileStatus[] {
    const fileMap = new Map<string, GitFileStatus>()
    const lines = output.split('\n').filter(line => line.length > 0)

    for (const line of lines) {
      if (line.length < 3) continue

      const stagedStatus = line[0] as string
      const unstagedStatus = line[1] as string
      let filePath = line.substring(3)
      let oldPath: string | undefined

      if ((stagedStatus === 'R' || stagedStatus === 'C') && filePath.includes(' -> ')) {
        const arrowIndex = filePath.indexOf(' -> ')
        oldPath = filePath.substring(0, arrowIndex)
        filePath = filePath.substring(arrowIndex + 4)
      }

      const existing = fileMap.get(filePath)

      if (stagedStatus !== ' ' && stagedStatus !== '?') {
        const fileStatus: GitFileStatus = {
          path: filePath,
          status: this.parseStatusCode(stagedStatus),
          staged: true,
          ...(oldPath && { oldPath })
        }
        fileMap.set(filePath, fileStatus)
        continue
      }

      if (unstagedStatus !== ' ' && unstagedStatus !== '?' && !existing) {
        const fileStatus: GitFileStatus = {
          path: filePath,
          status: this.parseStatusCode(unstagedStatus),
          staged: false,
          ...(oldPath && { oldPath })
        }
        fileMap.set(filePath, fileStatus)
        continue
      }

      if ((stagedStatus === '?' || unstagedStatus === '?') && !existing) {
        const fileStatus: GitFileStatus = {
          path: filePath,
          status: 'untracked',
          staged: false
        }
        fileMap.set(filePath, fileStatus)
      }
    }

    return Array.from(fileMap.values())
  }

  private parseStatusCode(code: string): 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' {
    switch (code) {
      case 'M':
        return 'modified'
      case 'A':
        return 'added'
      case 'D':
        return 'deleted'
      case 'R':
        return 'renamed'
      case 'C':
        return 'copied'
      case '?':
        return 'untracked'
      default:
        return 'modified'
    }
  }
}