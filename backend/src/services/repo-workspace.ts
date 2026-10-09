import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { isWorktreeSibling } from '@opencode-manager/shared/utils'
import { logger } from '../utils/logger'
import type { GitAuthService } from './git-auth'
import type { OpenCodeClient } from './opencode/client'
import type { ProjectConfigService } from './project-config'
import type { TerminalService } from './terminal'
import type { ScheduleService } from './schedules'
import { findSiblingByDirectory, listRepoSiblings, removeWorktree, RepoWorkspaceError, resolveRepoProjectId } from './repo'
import { getErrorMessage } from '../utils/error-utils'

/**
 * Single owner of repo worktree lifecycle side effects: worktree setup on create (after an
 * optional caller-provided initializer), and terminal cleanup plus owner-specific removal on remove.
 */
export class RepoWorkspaceService {
  constructor(
    private readonly database: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly gitAuthService: GitAuthService,
    private readonly projectConfigService: ProjectConfigService,
    private readonly terminalService: TerminalService,
    private readonly scheduleWorktrees: Pick<ScheduleService, 'removeWorktrees'>,
  ) {}

  async create(
    repo: Repo,
    options: { name?: string; ref?: string; initialize?: (directory: string) => Promise<void> } = {},
  ) {
    const projectID = await resolveRepoProjectId(this.openCodeClient, repo.fullPath)
    const worktree = await this.openCodeClient.api.worktree.create({
      projectID,
      ...(options.name ? { name: options.name } : {}),
      ...(options.ref ? { branch: options.ref } : {}),
    })

    if (options.initialize) {
      try {
        await options.initialize(worktree.directory)
      } catch (error: unknown) {
        try {
          await this.openCodeClient.api.worktree.remove({ projectID, directory: worktree.directory, force: true })
        } catch (removeError: unknown) {
          logger.warn(`Failed to remove worktree ${worktree.directory} after initialization failed:`, removeError)
        }
        throw error
      }
    }

    const worktreeSetup = await this.projectConfigService.runWorktreeSetupForRepo(repo, worktree.directory, this.terminalService)
    return { ...worktree, worktreeSetup }
  }

  /**
   * Removes a worktree of the repo the way its owner expects: OpenCode worktrees through
   * OpenCode, schedule worktrees through the schedule (which commits pending changes and
   * removes their terminals first), and plain git worktrees with `git worktree remove`,
   * which refuses uncommitted changes.
   */
  async remove(repo: Repo, directory: string): Promise<void> {
    const worktree = findSiblingByDirectory(await this.listWorktreeSiblings(repo.id), directory)
    if (!worktree) throw new RepoWorkspaceError('Not a deletable worktree of this repo', 400)
    if (worktree.schedule?.inUse) throw new RepoWorkspaceError('This worktree is in use by a running scheduled run. Cancel the run first.', 400)

    if (worktree.schedule) {
      await this.scheduleWorktrees.removeWorktrees(worktree.schedule.repoId, worktree.schedule.jobId, worktree.fullPath)
      return
    }

    await this.removeTerminals(worktree.fullPath)

    if (worktree.worktreeSource === 'git') {
      try {
        await removeWorktree(repo.fullPath, worktree.fullPath, this.gitAuthService.getGitEnvironment(true), { force: false })
      } catch (error) {
        throw new RepoWorkspaceError(`Could not remove worktree: ${getErrorMessage(error)}`, 400)
      }
      return
    }

    const projectID = await resolveRepoProjectId(this.openCodeClient, repo.fullPath)
    await this.openCodeClient.api.worktree.remove({ projectID, directory: worktree.fullPath, force: true })
  }

  async removeRepoTerminals(repo: Repo): Promise<void> {
    await this.removeTerminals(repo.fullPath)

    let siblings: Array<{ fullPath: string }>
    try {
      siblings = await this.listWorktreeSiblings(repo.id)
    } catch (error: unknown) {
      logger.warn(`Failed to list OpenCode workspace siblings for repo ${repo.id}:`, error)
      return
    }
    await Promise.all(siblings.map((sibling) => this.removeTerminals(sibling.fullPath)))
  }

  private async listWorktreeSiblings(repoId: number) {
    return listRepoSiblings(
      this.database,
      repoId,
      this.gitAuthService.getGitEnvironment(),
      this.openCodeClient,
      isWorktreeSibling,
    )
  }

  private async removeTerminals(directory: string): Promise<void> {
    try {
      await this.terminalService.removeAll(directory)
    } catch (error: unknown) {
      logger.warn(`Failed to remove terminals for ${directory}:`, error)
    }
  }
}
