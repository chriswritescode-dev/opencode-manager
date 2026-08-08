import type { Repo } from "@/api/types"
import type { GitStatusResponse } from "@/types/git"
import { getRepoDisplayName } from "@/lib/utils"

export type RepoFilterMode = 'all' | 'recent' | 'attention' | 'worktrees' | 'local'
export type RepoSortMode = 'recent' | 'manual' | 'name'

export interface RepoAttentionState {
  hasChanges: boolean
  ahead: number
  behind: number
  isCloneStatusReady: boolean
}

export interface RepoViewModel extends Repo {
  attentionState: RepoAttentionState
  activityTimestamp: number
}

export interface RepoListSection {
  title: string
  repos: RepoViewModel[]
  emptyMessage?: string
}

export function getActivityTimestamp(repo: Repo): number {
  return repo.lastAccessedAt ?? repo.lastPulled ?? repo.clonedAt
}

export function getAttentionState(repo: Repo, gitStatus?: GitStatusResponse): RepoAttentionState {
  if (!gitStatus || repo.cloneStatus !== 'ready') {
    return {
      hasChanges: false,
      ahead: 0,
      behind: 0,
      isCloneStatusReady: repo.cloneStatus === 'ready'
    }
  }

  return {
    hasChanges: gitStatus.hasChanges,
    ahead: gitStatus.ahead,
    behind: gitStatus.behind,
    isCloneStatusReady: true
  }
}

export function dedupeRepos(repos: Repo[]): Repo[] {
  return repos.reduce((acc, repo) => {
    if (repo.isWorktree) {
      acc.push(repo)
    } else {
      const key = repo.repoUrl || repo.sourcePath || repo.localPath
      const existing = acc.find(
        (r) => (r.repoUrl || r.sourcePath || r.localPath) === key && !r.isWorktree
      )

      if (!existing) {
        acc.push(repo)
      }
    }

    return acc
  }, [] as Repo[])
}

export function buildRepoViewModels(
  repos: Repo[],
  gitStatuses: Map<number, GitStatusResponse> | undefined
): RepoViewModel[] {
  return dedupeRepos(repos).map((repo) => ({
    ...repo,
    attentionState: getAttentionState(repo, gitStatuses?.get(repo.id)),
    activityTimestamp: getActivityTimestamp(repo)
  }))
}

export function filterReposBySearch(repos: RepoViewModel[], searchQuery: string): RepoViewModel[] {
  if (!searchQuery.trim()) {
    return repos
  }

  const query = searchQuery.toLowerCase()
  return repos.filter((repo) => {
    const repoName = getRepoDisplayName(repo)
    const searchTarget = repo.repoUrl || repo.sourcePath || repo.localPath || ""
    return (
      repoName.toLowerCase().includes(query) ||
      searchTarget.toLowerCase().includes(query)
    )
  })
}

export function filterReposByMode(repos: RepoViewModel[], mode: RepoFilterMode): RepoViewModel[] {
  switch (mode) {
    case 'recent':
      return repos.filter((repo) => repo.attentionState.isCloneStatusReady)
    case 'attention':
      return repos.filter(
        (repo) =>
          repo.attentionState.hasChanges ||
          repo.attentionState.ahead > 0 ||
          repo.attentionState.behind > 0
      )
    case 'worktrees':
      return repos.filter((repo) => repo.isWorktree)
    case 'local':
      return repos.filter((repo) => repo.isLocal)
    case 'all':
    default:
      return repos
  }
}

export function sortRepos(repos: RepoViewModel[], mode: RepoSortMode, manualOrder?: number[]): RepoViewModel[] {
  switch (mode) {
    case 'recent':
      return [...repos].sort((a, b) => b.activityTimestamp - a.activityTimestamp)
    case 'name':
      return [...repos].sort((a, b) => {
        const nameA = getRepoDisplayName(a).toLowerCase()
        const nameB = getRepoDisplayName(b).toLowerCase()
        return nameA.localeCompare(nameB)
      })
    case 'manual': {
      if (!manualOrder || manualOrder.length === 0) {
        return repos
      }
      const orderMap = new Map(manualOrder.map((id, index) => [id, index]))
      const orderedRepos = repos
        .filter((repo) => orderMap.has(repo.id))
        .sort((a, b) => {
          const indexA = orderMap.get(a.id)!
          const indexB = orderMap.get(b.id)!
          return indexA - indexB
        })
      const remainingRepos = repos.filter((repo) => !orderMap.has(repo.id))
      return [...orderedRepos, ...remainingRepos]
    }
    default:
      return repos
  }
}

export function groupReposIntoSections(
  repos: RepoViewModel[],
  filterMode: RepoFilterMode,
  sortMode: RepoSortMode
): RepoListSection[] {
  if (sortMode === 'manual') {
    return [{
      title: 'All Repositories',
      repos,
      emptyMessage: repos.length === 0 ? 'No repositories found' : undefined
    }]
  }

  if (filterMode === 'attention') {
    const needsAttention = repos.filter(
      (repo) =>
        repo.attentionState.hasChanges ||
        repo.attentionState.ahead > 0 ||
        repo.attentionState.behind > 0
    )
    
    if (needsAttention.length === 0) {
      return [{
        title: 'Needs Attention',
        repos: [],
        emptyMessage: 'No repositories need attention'
      }]
    }

    return [{
      title: 'Needs Attention',
      repos: needsAttention
    }]
  }

  if (filterMode === 'recent') {
    const recentRepos = repos.filter((repo) => repo.attentionState.isCloneStatusReady)
    
    if (recentRepos.length === 0) {
      return [{
        title: 'Recent',
        repos: [],
        emptyMessage: 'No recently accessed repositories'
      }]
    }

    return [{
      title: 'Recent',
      repos: recentRepos
    }]
  }

  const now = Date.now()
  const oneDayAgo = now - 24 * 60 * 60 * 1000
  const needsAttention = repos.filter(
    (repo) =>
      repo.attentionState.isCloneStatusReady &&
      (repo.attentionState.hasChanges ||
        repo.attentionState.ahead > 0 ||
        repo.attentionState.behind > 0)
  )

  const recentThreshold = oneDayAgo
  const recentlyActive = repos.filter(
    (repo) =>
      repo.attentionState.isCloneStatusReady &&
      repo.activityTimestamp >= recentThreshold
  )

  const sections: RepoListSection[] = []

  if (needsAttention.length > 0) {
    sections.push({
      title: 'Needs Attention',
      repos: needsAttention
    })
  }

  if (recentlyActive.length > 0) {
    sections.push({
      title: 'Recent',
      repos: recentlyActive
    })
  }

  const remaining = repos.filter(
    (repo) =>
      !needsAttention.includes(repo) && !recentlyActive.includes(repo)
  )

  if (remaining.length > 0) {
    sections.push({
      title: 'All Repositories',
      repos: remaining
    })
  } else if (sections.length === 0) {
    sections.push({
      title: 'All Repositories',
      repos,
      emptyMessage: repos.length === 0 ? 'No repositories found' : undefined
    })
  }

  return sections
}

export function countAttentionItems(repos: RepoViewModel[]): number {
  return repos.filter(
    (repo) =>
      repo.attentionState.hasChanges ||
      repo.attentionState.ahead > 0 ||
      repo.attentionState.behind > 0
  ).length
}