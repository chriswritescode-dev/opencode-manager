import { existsSync, mkdirSync } from 'node:fs'
import path from 'path'
import type { Database } from 'bun:sqlite'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { Repo } from '../types/repo'
import type { GitAuthService } from './git-auth'
import type { SettingsService } from './settings'
import type { CredentialProvider } from './credential-provider'
import { resolveGitIdentity, createGitIdentityEnv, isSSHUrl } from '../utils/git-auth'
import { executeCommand } from '../utils/process'
import { resolveDefaultBranch, createWorktreeSafely, removeWorktree } from './repo'
import { logger } from '../utils/logger'

export interface ScheduleWorktreeContext {
  directory: string
  worktreePath: string
  runBranch: string
}

/**
 * Build repo-context environment variables used by the GIT_ASKPASS handler
 * to resolve repo-specific credentials. Mirrors GitService.getEnvironmentForRepo.
 */
export function buildRepoEnvForRepo(repo: { id?: number; fullPath: string }): Record<string, string> {
  return {
    ...(repo.id ? { OCM_GIT_REPO_ID: String(repo.id) } : {}),
    OCM_GIT_REPO_CWD: repo.fullPath,
  }
}

export class ScheduleWorktreeManager {
  constructor(
    private readonly gitAuthService: GitAuthService,
    private readonly settingsService: SettingsService,
    private readonly credentialProvider: CredentialProvider,
    private readonly db: Database,
  ) {}

  async prepare(
    repo: Repo,
    job: { id: number; isolationMode: string; branch: string | null },
    runId: number,
  ): Promise<ScheduleWorktreeContext | null> {
    if (job.isolationMode === 'inline') return null
    if (repo.id === ASSISTANT_REPO_ID) return null

    try {
      await executeCommand(['git', '-C', repo.fullPath, 'rev-parse', '--is-inside-work-tree'], { silent: true })
    } catch {
      return null
    }

    let sshSetup = false
    if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
      await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
      sshSetup = true
    }

    try {
      const baseEnv = this.gitAuthService.getGitEnvironment(true)
      const sshEnv = sshSetup ? this.gitAuthService.getSSHEnvironment() : {}
      const identityEnv = await this.buildIdentityEnv()
      const env = { ...baseEnv, ...buildRepoEnvForRepo(repo), ...sshEnv, ...identityEnv }

      await executeCommand(['git', '-C', repo.fullPath, 'fetch', '--all', '--prune'], { env }).catch(() => {})

      const base = job.branch?.trim() || (await resolveDefaultBranch(repo.fullPath, env))
      const runBranch = `schedule/${job.id}/run-${runId}`
      const worktreePath = path.join(getReposPath(), '.ocm-schedule-worktrees', `job-${job.id}-run-${runId}`)

      mkdirSync(path.dirname(worktreePath), { recursive: true })

      await createWorktreeSafely(repo.fullPath, worktreePath, runBranch, env, `origin/${base}`).catch(() =>
        createWorktreeSafely(repo.fullPath, worktreePath, runBranch, env, base),
      )

      if (!existsSync(worktreePath)) {
        throw new Error(`Worktree directory was not created at: ${worktreePath}`)
      }

      return { directory: worktreePath, worktreePath, runBranch }
    } finally {
      if (sshSetup) {
        await this.gitAuthService.cleanupSSHKey()
      }
    }
  }

  async finalize(
    repo: Repo,
    job: { id: number; name: string; prompt: string },
    run: { id: number; worktreePath: string | null; runBranch: string | null; triggerSource: string },
  ): Promise<{ commitHash: string | null }> {
    if (!run.worktreePath) {
      return { commitHash: null }
    }

    let sshSetup = false
    let env: Record<string, string> | undefined

    try {
      if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
        await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
        sshSetup = true
      }

      const baseEnv = this.gitAuthService.getGitEnvironment()
      const sshEnv = sshSetup ? this.gitAuthService.getSSHEnvironment() : {}
      const identityEnv = await this.buildIdentityEnv()
      env = { ...baseEnv, ...buildRepoEnvForRepo(repo), ...sshEnv, ...identityEnv }

      const status = await executeCommand(['git', '-C', run.worktreePath, 'status', '--porcelain'], { env }).catch(() => '')

      if (!status.trim()) {
        return { commitHash: null }
      }

      await executeCommand(['git', '-C', run.worktreePath, 'add', '-A'], { env })

      const title = `Scheduled run: ${job.name} (run #${run.id})`
      const promptSummary = job.prompt.length > 200 ? `${job.prompt.slice(0, 200)}...` : job.prompt
      const body = `Trigger: ${run.triggerSource}\nPrompt: ${promptSummary}`
      await executeCommand(['git', '-C', run.worktreePath, 'commit', '-m', title, '-m', body], { env })

      const commitHash = (await executeCommand(['git', '-C', run.worktreePath, 'rev-parse', 'HEAD'], { env })).trim()

      return { commitHash }
    } catch (error) {
      logger.error(`Failed to finalize schedule run ${run.id} in worktree ${run.worktreePath}:`, error)
      throw error
    } finally {
      try {
        await removeWorktree(repo.fullPath, run.worktreePath, env)
      } catch (error) {
        logger.error(`Failed to remove worktree ${run.worktreePath}:`, error)
      }
      if (sshSetup) {
        await this.gitAuthService.cleanupSSHKey()
      }
    }
  }

  private async buildIdentityEnv(): Promise<Record<string, string>> {
    const settings = this.settingsService.getSettings()
    const gitCredentials = this.credentialProvider.getGitCredentials()
    const identity = await resolveGitIdentity(settings.preferences.gitIdentity, gitCredentials)
    return identity ? createGitIdentityEnv(identity) : {}
  }
}
