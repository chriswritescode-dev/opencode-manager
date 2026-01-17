import { GitFetchPullService } from './GitFetchPullService'
import { GitBranchService } from './GitBranchService'
import type { Database } from 'bun:sqlite'

export class GitFetchService {
  constructor(
    private fetchPullService: GitFetchPullService,
    private branchService: GitBranchService
  ) {}

  async fetch(repoId: number, database: Database): Promise<{ stdout: string; stderr: string }> {
    return this.fetchPullService.fetch(repoId, database)
  }

  async pull(repoId: number, database: Database): Promise<{ stdout: string; stderr: string }> {
    return this.fetchPullService.pull(repoId, database)
  }

  async getBranches(repoId: number, database: Database): Promise<string[]> {
    return this.branchService.getBranches(repoId, database)
  }

  async getBranchStatus(repoId: number, database: Database): Promise<{ ahead: number; behind: number }> {
    return this.branchService.getBranchStatus(repoId, database)
  }

  async createBranch(repoId: number, branchName: string, database: Database): Promise<{ stdout: string; stderr: string }> {
    return this.branchService.createBranch(repoId, branchName, database)
  }

  async switchBranch(repoId: number, branchName: string, database: Database): Promise<{ stdout: string; stderr: string }> {
    return this.branchService.switchBranch(repoId, branchName, database)
  }

  async hasCommits(repoPath: string): Promise<boolean> {
    return this.branchService.hasCommits(repoPath)
  }
}
