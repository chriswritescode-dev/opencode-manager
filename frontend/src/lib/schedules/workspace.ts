import type { Repo } from '@/api/types'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'
import { getRepoDisplayName } from '@/lib/utils'
import { getAssistantPath } from '@/lib/navigation'

export interface Workspace {
  repoId: number
  kind: 'assistant' | 'repo'
  name: string
  subtitle: string
  fullPath: string
  backHref: string
}

export const ASSISTANT_REPO_ID = 0

export function isAssistantRepoId(repoId: number | undefined): boolean {
  return repoId === ASSISTANT_REPO_ID
}

export function workspaceFromRepo(repo: Repo): Workspace {
  return {
    repoId: repo.id,
    kind: 'repo',
    name: getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath),
    subtitle: repo.localPath,
    fullPath: repo.fullPath,
    backHref: `/repos/${repo.id}`,
  }
}

export function workspaceFromAssistant(status: AssistantModeStatus): Workspace {
  return {
    repoId: ASSISTANT_REPO_ID,
    kind: 'assistant',
    name: 'Assistant',
    subtitle: 'Assistant Workspace',
    fullPath: status.directory,
    backHref: getAssistantPath(),
  }
}
