import { GitFetchService } from '../services/git/GitFetchService'
import { GitCommitService } from '../services/git/GitCommitService'
import { GitPushService } from '../services/git/GitPushService'
import { GitLogService } from '../services/git/GitLogService'
import { GitStatusService } from '../services/git/GitStatusService'
import type { GitCommit, GitStatusResponse } from '../types/git'
import type { Database } from 'bun:sqlite'

export class GitCommandHandler {
  constructor(
    private fetchService: GitFetchService,
    private commitService: GitCommitService,
    private pushService: GitPushService,
    private logService: GitLogService,
    private statusService: GitStatusService
  ) {}

  async fetch(repoId: number, database: Database): Promise<{ stdout: string; stderr: string }> {
    return this.fetchService.fetch(repoId, database)
  }

  async pull(repoId: number, database: Database): Promise<{ stdout: string; stderr: string }> {
    return this.fetchService.pull(repoId, database)
  }

  async commit(
    repoId: number,
    message: string,
    stagedPaths?: string[],
    database: Database
  ): Promise<{ stdout: string; stderr: string }> {
    return this.commitService.commit(repoId, message, database, stagedPaths)
  }

  async stageFiles(
    repoId: number,
    paths: string[],
    database: Database
  ): Promise<{ stdout: string; stderr: string }> {
    return this.commitService.stageFiles(repoId, paths, database)
  }

  async unstageFiles(
    repoId: number,
    paths: string[],
    database: Database
  ): Promise<{ stdout: string; stderr: string }> {
    return this.commitService.unstageFiles(repoId, paths, database)
  }

  async push(
    repoId: number,
    options: { setUpstream?: boolean },
    database: Database
  ): Promise<{ stdout: string; stderr: string }> {
    return this.pushService.push(repoId, options, database)
  }

  async getLog(repoId: number, limit?: number, database: Database): Promise<GitCommit[]> {
    return this.logService.getLog(repoId, limit ?? 10, database)
  }

  async getDiff(repoId: number, path: string, database: Database): Promise<string> {
    return this.logService.getDiff(repoId, path, database)
  }

  async getStatus(repoId: number, database: Database): Promise<GitStatusResponse> {
    return this.statusService.getStatus(repoId, database)
  }

  async resetToCommit(
    repoId: number,
    commitHash: string,
    database: Database
  ): Promise<{ stdout: string; stderr: string }> {
    return this.commitService.resetToCommit(repoId, commitHash, database)
  }
}
