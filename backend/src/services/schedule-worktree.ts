import { existsSync, readdirSync } from 'node:fs'
import path from 'path'
import type { Database } from 'bun:sqlite'
import { getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { ScheduleRunWorktreesMode, ScheduleWorkspaceMode } from '@opencode-manager/shared/types'
import type { Repo } from '../types/repo'
import type { GitAuthService } from './git-auth'
import { isSSHUrl } from '@opencode-manager/shared/utils'
import { executeCommand } from '../utils/process'
import { resolveDefaultBranch, resolveBaseRef, createWorktreeSafely, listGitWorktrees, removeWorktree } from './repo'
import { logger } from '../utils/logger'
import { canonicalPathSync, mkdirSyncSafe } from '../utils/fs-safe'
import {
  getScheduleWorktreeBranch,
  getScheduleWorktreePath,
  isSharedScheduleWorktreePath,
  parseScheduleWorktreeName,
} from './schedule-worktree-paths'

export interface ScheduleWorktreeContext {
  directory: string
  worktreePath: string
  runBranch: string
}

/**
 * A schedule worktree directory found on disk. `runId` is null for a schedule's shared worktree.
 */
export interface ScheduleWorktreeEntry {
  jobId: number
  runId: number | null
  worktreePath: string
  branch: string
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
    private readonly db: Database,
  ) {}

  /**
   * Prepares the directory a run works in. Returns null when there is no worktree to
   * prepare (the assistant repo or a directory that is not a git checkout). A shared
   * worktree that already exists and is clean is reused as-is; otherwise a worktree is
   * created, continuing the shared branch when it already exists.
   */
  async prepare(
    repo: Repo,
    job: { id: number; branch: string | null; workspaceMode: ScheduleWorkspaceMode },
    runId: number,
  ): Promise<ScheduleWorktreeContext | null> {
    if (repo.id === ASSISTANT_REPO_ID) return null

    try {
      await executeCommand(['git', '-C', repo.fullPath, 'rev-parse', '--is-inside-work-tree'], { silent: true })
    } catch {
      return null
    }

    const shared = job.workspaceMode === 'shared-worktree'
    const worktreeRunId = shared ? null : runId
    const runBranch = getScheduleWorktreeBranch(job.id, worktreeRunId)
    const worktreePath = getScheduleWorktreePath(job.id, worktreeRunId)

    let sshSetup = false
    if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
      await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
      sshSetup = true
    }

    try {
      const env = await this.buildGitEnv(repo, sshSetup, true)

      if (shared && await this.isUsableWorktree(worktreePath, env)) {
        const status = await executeCommand(['git', '-C', worktreePath, 'status', '--porcelain'], { env }).catch(() => '')
        if (status.trim()) {
          throw new Error(`Shared worktree ${worktreePath} has uncommitted changes made outside a scheduled run. Commit or discard them before the next run.`)
        }
        return { directory: worktreePath, worktreePath, runBranch }
      }

      await executeCommand(['git', '-C', repo.fullPath, 'fetch', '--prune', 'origin'], { env }).catch(() => {})

      const base = job.branch?.trim() || (await resolveDefaultBranch(repo.fullPath, env))
      const baseRef = await resolveBaseRef(repo.fullPath, base, env)
      if (!baseRef) {
        throw new Error(`Base branch "${base}" was not found in this repository. Choose an existing branch in the schedule settings.`)
      }

      if (existsSync(worktreePath)) {
        await removeWorktree(repo.fullPath, worktreePath, env)
      }

      await this.assertRunBranchAvailable(repo.fullPath, runBranch, worktreePath, env)

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

  /**
   * Commits a finished run's changes to its branch. A `worktree` run's worktree is then
   * removed, along with its branch when nothing was committed. Kept and shared worktrees
   * stay on disk on their branch so the work can be continued.
   */
  async finalize(
    repo: Repo,
    job: { id: number; name: string; prompt: string; workspaceMode: ScheduleWorkspaceMode },
    run: { id: number; worktreePath: string | null; runBranch: string | null; triggerSource: string },
  ): Promise<{ commitHash: string | null }> {
    if (!run.worktreePath) {
      return { commitHash: null }
    }

    const retain = isSharedScheduleWorktreePath(run.worktreePath) || job.workspaceMode === 'kept-worktree'
    let sshSetup = false
    let env: Record<string, string> | undefined
    let commitHash: string | null = null

    try {
      if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
        await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
        sshSetup = true
      }

      env = await this.buildGitEnv(repo, sshSetup, false)

      const promptSummary = job.prompt.length > 200 ? `${job.prompt.slice(0, 200)}...` : job.prompt
      commitHash = await this.commitPendingChanges(
        run.worktreePath,
        env,
        `Scheduled run: ${job.name} (run #${run.id})`,
        `Trigger: ${run.triggerSource}\nPrompt: ${promptSummary}`,
      )

      if (!retain) {
        await executeCommand(['git', '-C', run.worktreePath, 'checkout', '--detach'], { env }).catch(() => {})
      }

      return { commitHash }
    } catch (error) {
      logger.error(`Failed to finalize schedule run ${run.id} in worktree ${run.worktreePath}:`, error)
      throw error
    } finally {
      if (!retain) {
        await removeWorktree(repo.fullPath, run.worktreePath, env).catch((error) => {
          logger.error(`Failed to remove worktree ${run.worktreePath}:`, error)
        })

        if (run.runBranch && !commitHash) {
          await executeCommand(['git', '-C', repo.fullPath, 'branch', '-D', run.runBranch], env ? { env } : undefined).catch(() => undefined)
        }
      }

      if (sshSetup) {
        await this.gitAuthService.cleanupSSHKey()
      }
    }
  }

  /**
   * Removes a kept or shared worktree. Uncommitted changes are committed to its branch
   * first and the branch is kept, so no work is lost; if that commit fails the worktree
   * is left in place.
   */
  async releaseWorktree(repo: Repo, job: { name: string }, worktreePath: string): Promise<void> {
    const env = await this.buildGitEnv(repo, false, true)

    if (existsSync(worktreePath)) {
      await this.commitPendingChanges(worktreePath, env, `Schedule worktree removed: ${job.name}`, 'Uncommitted changes saved before the worktree was removed.')
    }

    await removeWorktree(repo.fullPath, worktreePath, env)
  }

  /**
   * Lists the schedule worktree directories on disk, optionally for a single job.
   */
  listWorktrees(jobId?: number): ScheduleWorktreeEntry[] {
    let names: string[]
    try {
      names = readdirSync(getScheduleWorktreesPath())
    } catch {
      return []
    }

    return names.flatMap((name) => {
      const parsed = parseScheduleWorktreeName(name)
      if (!parsed || (jobId !== undefined && parsed.jobId !== jobId)) return []
      return [{
        jobId: parsed.jobId,
        runId: parsed.runId,
        worktreePath: path.join(getScheduleWorktreesPath(), name),
        branch: getScheduleWorktreeBranch(parsed.jobId, parsed.runId),
      }]
    })
  }

  /**
   * Removes leftover worktrees and deletes the run branches for a set of
   * finished runs. Used when clearing run history. The job's shared worktree and
   * branch are never touched, since they belong to the schedule rather than a run.
   * In `commit` mode a run worktree still on disk is released through
   * `releaseWorktree`, so its pending changes are committed and its branch kept;
   * branches whose worktree is already gone are deleted. In `discard` mode the
   * worktrees are force-removed and every run branch deleted. Branch and worktree
   * removal are local git operations, so no SSH setup is needed; failures are
   * swallowed per artifact so one bad entry does not block the rest.
   */
  async pruneRunArtifacts(
    repo: Repo,
    job: { id: number; name: string },
    artifacts: { runBranch: string | null; worktreePath: string | null }[],
    mode: ScheduleRunWorktreesMode = 'commit',
  ): Promise<void> {
    const sharedPath = getScheduleWorktreePath(job.id, null)
    const sharedBranch = getScheduleWorktreeBranch(job.id, null)
    const runWorktrees = artifacts
      .map((artifact) => artifact.worktreePath)
      .filter((worktreePath): worktreePath is string => worktreePath !== null && worktreePath !== sharedPath)
    const branches = artifacts
      .map((artifact) => artifact.runBranch)
      .filter((branch): branch is string => branch !== null && branch.length > 0 && branch !== sharedBranch)

    if (runWorktrees.length === 0 && branches.length === 0) return

    const env = await this.buildGitEnv(repo, false, true)

    if (mode === 'discard') {
      await Promise.all(runWorktrees.map((worktreePath) => removeWorktree(repo.fullPath, worktreePath, env).catch(() => undefined)))
      await this.deleteBranches(repo.fullPath, branches, env)
      return
    }

    const branchByWorktree = new Map(artifacts.flatMap((artifact) => (
      artifact.worktreePath !== null && artifact.runBranch !== null
        ? [[artifact.worktreePath, artifact.runBranch] as const]
        : []
    )))
    const retainedBranches = new Set<string>()

    await Promise.all(runWorktrees.map(async (worktreePath) => {
      if (!existsSync(worktreePath)) return
      const branch = branchByWorktree.get(worktreePath)
      if (branch) retainedBranches.add(branch)
      try {
        await this.releaseWorktree(repo, job, worktreePath)
      } catch (error) {
        logger.error(`Failed to release schedule worktree ${worktreePath}:`, error)
      }
    }))

    await this.deleteBranches(repo.fullPath, branches.filter((branch) => !retainedBranches.has(branch)), env)
  }

  private async deleteBranches(repoPath: string, branches: string[], env: Record<string, string>): Promise<void> {
    if (branches.length === 0) return
    await executeCommand(['git', '-C', repoPath, 'branch', '-D', ...branches], { env }).catch(() => {})
  }

  private async commitPendingChanges(
    worktreePath: string,
    env: Record<string, string>,
    title: string,
    body: string,
  ): Promise<string | null> {
    const status = await executeCommand(['git', '-C', worktreePath, 'status', '--porcelain'], { env }).catch(() => '')
    if (!status.trim()) return null

    await executeCommand(['git', '-C', worktreePath, 'add', '-A'], { env })
    await executeCommand(['git', '-C', worktreePath, 'commit', '-m', title, '-m', body], { env })
    return (await executeCommand(['git', '-C', worktreePath, 'rev-parse', 'HEAD'], { env })).trim()
  }

  private async isUsableWorktree(worktreePath: string, env: Record<string, string>): Promise<boolean> {
    if (!existsSync(path.join(worktreePath, '.git'))) return false
    try {
      await executeCommand(['git', '-C', worktreePath, 'rev-parse', '--is-inside-work-tree'], { env, silent: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * Refuses to create a worktree on a branch another checkout already has, which git
   * would otherwise reject with an opaque error.
   */
  private async assertRunBranchAvailable(repoPath: string, runBranch: string, worktreePath: string, env: Record<string, string>): Promise<void> {
    const targetPath = canonicalPathSync(path.resolve(worktreePath))
    const conflicting = (await listGitWorktrees(repoPath, env)).find((worktree) =>
      worktree.branch === runBranch && canonicalPathSync(path.resolve(worktree.path)) !== targetPath,
    )
    if (conflicting) {
      throw new Error(`Branch ${runBranch} is checked out in ${conflicting.path}. Switch that checkout to another branch so the schedule can run.`)
    }
  }

  private async buildGitEnv(repo: Repo, sshSetup: boolean, silent: boolean): Promise<Record<string, string>> {
    const baseEnv = this.gitAuthService.getGitEnvironment(silent)
    const sshEnv = sshSetup ? this.gitAuthService.getSSHEnvironment() : {}
    return { ...baseEnv, ...buildRepoEnvForRepo(repo), ...sshEnv }
  }
}
