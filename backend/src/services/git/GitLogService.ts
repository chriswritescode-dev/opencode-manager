import { GitAuthService } from '../../utils/git-auth'
import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import * as db from '../../db/queries'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { Database } from 'bun:sqlite'
import path from 'path'

interface GitCommit {
  hash: string
  authorName: string
  authorEmail: string
  date: string
  message: string
}

export class GitLogService {
  private gitAuthService: GitAuthService

  constructor(gitAuthService: GitAuthService) {
    this.gitAuthService = gitAuthService
  }

  async getLog(repoId: number, database: Database, limit: number = 10): Promise<GitCommit[]> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(getReposPath(), repo.localPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const output = await executeCommand([
        'git',
        '-C',
        repoPath,
        'log',
        `-n`,
        String(limit),
        '--format=%H|%an|%ae|%ai|%s'
      ], { env })

      const lines = output.trim().split('\n')
      const commits: GitCommit[] = []

      for (const line of lines) {
        if (!line.trim()) continue

        const parts = line.split('|')
        const [hash, authorName, authorEmail, date, ...messageParts] = parts
        const message = messageParts.join('|')

        if (hash) {
          commits.push({
            hash,
            authorName: authorName || '',
            authorEmail: authorEmail || '',
            date: date || '',
            message: message || ''
          })
        }
      }

      return commits
    } catch (error: unknown) {
      logger.error(`Failed to get git log for repo ${repoId}:`, error)
      throw new Error(`Failed to get git log: ${getErrorMessage(error)}`)
    }
  }

  async getCommit(repoId: number, hash: string, database: Database): Promise<GitCommit | null> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(getReposPath(), repo.localPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const output = await executeCommand([
        'git',
        '-C',
        repoPath,
        'log',
        '--format=%H|%an|%ae|%ai|%s',
        hash,
        '-1'
      ], { env })

      if (!output.trim()) {
        return null
      }

      const parts = output.trim().split('|')
      const [commitHash, authorName, authorEmail, date, ...messageParts] = parts
      const message = messageParts.join('|')

      if (!commitHash) {
        return null
      }

      return {
        hash: commitHash,
        authorName: authorName || '',
        authorEmail: authorEmail || '',
        date: date || '',
        message: message || ''
      }
    } catch (error: unknown) {
      logger.error(`Failed to get commit ${hash} for repo ${repoId}:`, error)
      throw new Error(`Failed to get commit: ${getErrorMessage(error)}`)
    }
  }

  async getDiff(repoId: number, filePath: string, database: Database): Promise<string> {
    try {
      const repo = db.getRepoById(database, repoId)
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`)
      }

      const repoPath = path.resolve(getReposPath(), repo.localPath)
      const env = await this.gitAuthService.getGitEnvironment(repoId, database)

      const diff = await executeCommand([
        'git',
        '-C',
        repoPath,
        'diff',
        '--',
        filePath
      ], { env })

      return diff
    } catch (error: unknown) {
      logger.error(`Failed to get diff for ${filePath} in repo ${repoId}:`, error)
      throw new Error(`Failed to get diff: ${getErrorMessage(error)}`)
    }
  }
}
