import type { Repo as BaseRepo } from '../../../shared/src/types'
export type * from '../../../shared/src/types'
export * from '../../../shared/src/schemas/repo'

export interface Repo extends BaseRepo {
  isWorktree?: boolean
}

export interface CreateRepoInput {
  repoUrl?: string
  localPath: string
  branch?: string
  defaultBranch: string
  cloneStatus: 'cloning' | 'ready' | 'error'
  clonedAt: number
  isWorktree?: boolean
  isLocal?: boolean
}
