import type { Repo } from '@/api/types'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_NAME } from '@opencode-manager/shared/utils'
import { getRepoDisplayName } from '@/lib/utils'
import { getAssistantPath } from '@/lib/navigation'

export interface ScheduleTarget {
  repoId: number
  kind: 'assistant' | 'repo'
  name: string
  subtitle: string
  fullPath: string
  backHref: string
}

export function isAssistantRepoId(repoId: number | undefined): boolean {
  return repoId === ASSISTANT_REPO_ID
}

export function scheduleTargetFromRepo(repo: Repo): ScheduleTarget {
  return {
    repoId: repo.id,
    kind: 'repo',
    name: getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath),
    subtitle: repo.localPath,
    fullPath: repo.fullPath,
    backHref: `/repos/${repo.id}`,
  }
}

export function scheduleTargetFromAssistant(status: AssistantModeStatus): ScheduleTarget {
  return {
    repoId: ASSISTANT_REPO_ID,
    kind: 'assistant',
    name: ASSISTANT_REPO_NAME,
    subtitle: 'Built-in assistant',
    fullPath: status.directory,
    backHref: getAssistantPath(),
  }
}
