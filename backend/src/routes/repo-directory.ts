import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { listRepoSiblings, resolveRepoOrAssistant, resolveRepoWorkingDirectory } from '../services/repo'
import { getRepoById } from '../db/queries'
import type { GitAuthService } from '../services/git-auth'
import type { OpenCodeClient } from '../services/opencode/client'

export interface RepoDirectoryDeps {
  database: Database
  gitAuthService: GitAuthService
  openCodeClient: OpenCodeClient
}

export interface RepoDirectoryOptions {
  allowAssistant: boolean
}

export async function resolveRepoRequestDirectory(
  c: Context,
  deps: RepoDirectoryDeps,
  repoIdParam: string,
  directory: string | undefined,
  options: RepoDirectoryOptions,
): Promise<{ repo: Repo; directory: string } | Response> {
  const id = Number.parseInt(repoIdParam, 10)
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid repo id' }, 400)
  }

  const repo = options.allowAssistant
    ? resolveRepoOrAssistant(deps.database, id)
    : getRepoById(deps.database, id)
  if (!repo || repo.cloneStatus !== 'ready') {
    return c.json({ error: 'Repo not found' }, 404)
  }

  const resolved = await resolveRepoWorkingDirectory(repo, directory, () =>
    listRepoSiblings(
      deps.database,
      repo.id,
      deps.gitAuthService.getGitEnvironment(),
      deps.openCodeClient,
    ),
  )

  if (!resolved) {
    return c.json({ error: 'Directory is not part of this repository' }, 400)
  }

  return { repo, directory: resolved }
}
