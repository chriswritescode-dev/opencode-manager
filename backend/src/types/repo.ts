import type { Repo as BaseRepo } from '../../../shared/src/types'
export type * from '../../../shared/src/types'
export * from '../../../shared/src/schemas/repo'

export interface Repo extends BaseRepo {
  isWorktree?: boolean
}

interface CreateRepoInputBase {
  localPath: string
  branch?: string
  defaultBranch: string
  cloneStatus: 'cloning' | 'ready' | 'error'
  clonedAt: number
  isWorktree?: boolean
}

interface CreateLocalRepoInput extends CreateRepoInputBase {
  isLocal: true
  repoUrl?: string
}

interface CreateRemoteRepoInput extends CreateRepoInputBase {
  isLocal?: false
  repoUrl: string
}

export type CreateRepoInput = CreateLocalRepoInput | CreateRemoteRepoInput
