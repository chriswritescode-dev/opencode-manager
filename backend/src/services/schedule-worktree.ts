import { existsSync } from 'node:fs'
import path from 'path'
import type { Database } from 'bun:sqlite'
import { getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { Repo } from '../types/repo'
import type { GitAuthService } from './git-auth'
import type { SettingsService } from './settings'
import type { CredentialProvider } from './credential-provider'
import { resolveGitIdentity, createGitIdentityEnv } from '../utils/git-auth'
import { isSSHUrl } from '@opencode-manager/shared/utils'
import { executeCommand } from '../utils/process'
import { resolveDefaultBranch, createWorktreeSafely, removeWorktree } from './repo'
import { logger } from '../utils/logger'
import { mkdirSyncSafe } from '../utils/fs-safe'

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
    job: { id: number; branch: string | null },
    runId: number,
  ): Promise<ScheduleWorktreeContext | null> {
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
      const env = await this.buildGitEnv(repo, sshSetup, true)

      await executeCommand(['git', '-C', repo.fullPath, 'fetch', '--prune', 'origin'], { env }).catch(() => {})

      const base = job.branch?.trim() || (await resolveDefaultBranch(repo.fullPath, env))
      const baseRef = await this.resolveBaseRef(repo.fullPath, base, env)
      if (!baseRef) {
        throw new Error(`Base branch "${base}" was not found in this repository. Choose an existing branch in the schedule settings.`)
      }

      const runBranch = `schedule/${job.id}/run-${runId}`

      const worktreePath = path.join(getScheduleWorktreesPath(), `job-${job.id}-run-${runId}`)
      mkdirSyncSafe(path.dirname(worktreePath))
      await createWorktreeSafely(repo.fullPath, worktreePath, runBranch, env, baseRef)

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
    let commitHash: string | null = null

    try {
      if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
        await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
        sshSetup = true
      }

      env = await this.buildGitEnv(repo, sshSetup, false)

      const status = await executeCommand(['git', '-C', run.worktreePath, 'status', '--porcelain'], { env }).catch(() => '')

      if (status.trim()) {
        await executeCommand(['git', '-C', run.worktreePath, 'add', '-A'], { env })

        const title = `Scheduled run: ${job.name} (run #${run.id})`
        const promptSummary = job.prompt.length > 200 ? `${job.prompt.slice(0, 200)}...` : job.prompt
        const body = `Trigger: ${run.triggerSource}\nPrompt: ${promptSummary}`
        await executeCommand(['git', '-C', run.worktreePath, 'commit', '-m', title, '-m', body], { env })

        commitHash = (await executeCommand(['git', '-C', run.worktreePath, 'rev-parse', 'HEAD'], { env })).trim()
      }

      // Detach HEAD to protect the run branch from accidental pushes
      await executeCommand(['git', '-C', run.worktreePath, 'checkout', '--detach'], { env }).catch(() => {})

      return { commitHash }
    } catch (error) {
      logger.error(`Failed to finalize schedule run ${run.id} in worktree ${run.worktreePath}:`, error)
      throw error
    } finally {
      await removeWorktree(repo.fullPath, run.worktreePath, env).catch((error) => {
        logger.error(`Failed to remove worktree ${run.worktreePath}:`, error)
      })

      if (run.runBranch && !commitHash) {
        await executeCommand(['git', '-C', repo.fullPath, 'branch', '-D', run.runBranch], env ? { env } : undefined).catch(() => undefined)
      }

      if (sshSetup) {
        await this.gitAuthService.cleanupSSHKey()
      }
    }
  }

  /**
   * Removes leftover worktrees and deletes the run branches for a set of
   * finished runs. Used when clearing run history. Branch and worktree removal
   * are local git operations, so no SSH setup is needed; failures are swallowed
   * per artifact so one bad entry does not block the rest.
   */
  async pruneRunArtifacts(
    repo: Repo,
    artifacts: { runBranch: string | null; worktreePath: string | null }[],
  ): Promise<void> {
    if (artifacts.length === 0) return

    const env = await this.buildGitEnv(repo, false, true)

    await Promise.all(
      artifacts.map(async (artifact) => {
        if (!artifact.worktreePath) return
        await removeWorktree(repo.fullPath, artifact.worktreePath, env).catch(() => undefined)
      }),
    )

    const branches = artifacts.map((a) => a.runBranch).filter((b): b is string => b !== null && b.length > 0)
    if (branches.length > 0) {
      await executeCommand(['git', '-C', repo.fullPath, 'branch', '-D', ...branches], { env }).catch(() => {})
    }
  }

  /**
   * Resolves a user-supplied base branch name to a verified git ref, preferring
   * the remote-tracking branch for freshness. Returns null when neither the
   * remote nor local ref exists, allowing the caller to fail with a clear error
   * instead of a cryptic git "not a valid object name" failure.
   */
  private async resolveBaseRef(repoPath: string, base: string, env: Record<string, string>): Promise<string | null> {
    for (const candidate of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
      try {
        await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', candidate], { env, silent: true })
        return candidate.startsWith('refs/remotes/') ? `origin/${base}` : base
      } catch {
        continue
      }
    }
    return null
  }

  private async buildGitEnv(repo: Repo, sshSetup: boolean, silent: boolean): Promise<Record<string, string>> {
    const baseEnv = this.gitAuthService.getGitEnvironment(silent)
    const sshEnv = sshSetup ? this.gitAuthService.getSSHEnvironment() : {}
    const identityEnv = await this.buildIdentityEnv()
    return { ...baseEnv, ...buildRepoEnvForRepo(repo), ...sshEnv, ...identityEnv }
  }

  private async buildIdentityEnv(): Promise<Record<string, string>> {
    const settings = this.settingsService.getSettings()
    const gitCredentials = this.credentialProvider.getGitCredentials()
    const identity = await resolveGitIdentity(settings.preferences.gitIdentity, gitCredentials)
    return identity ? createGitIdentityEnv(identity) : {}
  }
}
