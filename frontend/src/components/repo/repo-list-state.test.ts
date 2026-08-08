import { describe, it, expect } from 'vitest'
import type { Repo } from '@/api/types'
import type { GitStatusResponse } from '@/types/git'
import {
  getActivityTimestamp,
  getAttentionState,
  dedupeRepos,
  filterReposBySearch,
  filterReposByMode,
  sortRepos,
  groupReposIntoSections,
  countAttentionItems,
  type RepoViewModel,
} from './repo-list-state'

const createMockRepo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 1,
  repoUrl: 'https://github.com/test/repo',
  localPath: 'repos/test-repo',
  fullPath: '/Users/test/repos/test-repo',
  sourcePath: undefined,
  branch: 'main',
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: Date.now() - 100000,
  lastPulled: undefined,
  lastAccessedAt: undefined,
  openCodeConfigName: undefined,
  isWorktree: false,
  isLocal: false,
  ...overrides,
})

const createMockGitStatus = (overrides: Partial<GitStatusResponse> = {}): GitStatusResponse => ({
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  hasChanges: false,
  ...overrides,
})

describe('repo-list-state', () => {
  describe('getActivityTimestamp', () => {
    it('should return lastAccessedAt when available', () => {
      const now = Date.now()
      const repo = createMockRepo({ lastAccessedAt: now })
      expect(getActivityTimestamp(repo)).toBe(now)
    })

    it('should return lastPulled when lastAccessedAt is not available', () => {
      const now = Date.now()
      const repo = createMockRepo({ lastAccessedAt: undefined, lastPulled: now })
      expect(getActivityTimestamp(repo)).toBe(now)
    })

    it('should return clonedAt as fallback', () => {
      const clonedAt = Date.now() - 100000
      const repo = createMockRepo({ lastAccessedAt: undefined, lastPulled: undefined, clonedAt })
      expect(getActivityTimestamp(repo)).toBe(clonedAt)
    })
  })

  describe('getAttentionState', () => {
    it('should return ready state for ready repos without git status', () => {
      const repo = createMockRepo({ cloneStatus: 'ready' })
      const result = getAttentionState(repo, undefined)
      expect(result).toEqual({
        hasChanges: false,
        ahead: 0,
        behind: 0,
        isCloneStatusReady: true,
      })
    })

    it('should return not ready for cloning repos', () => {
      const repo = createMockRepo({ cloneStatus: 'cloning' })
      const gitStatus = createMockGitStatus({ hasChanges: true, ahead: 2, behind: 1 })
      const result = getAttentionState(repo, gitStatus)
      expect(result).toEqual({
        hasChanges: false,
        ahead: 0,
        behind: 0,
        isCloneStatusReady: false,
      })
    })

    it('should return attention state from git status when ready', () => {
      const repo = createMockRepo({ cloneStatus: 'ready' })
      const gitStatus = createMockGitStatus({ hasChanges: true, ahead: 3, behind: 2 })
      const result = getAttentionState(repo, gitStatus)
      expect(result).toEqual({
        hasChanges: true,
        ahead: 3,
        behind: 2,
        isCloneStatusReady: true,
      })
    })
  })

  describe('dedupeRepos', () => {
    it('should preserve worktrees', () => {
      const repos = [
        createMockRepo({ id: 1, isWorktree: true, localPath: 'repos/parent/.worktrees/feature1' }),
        createMockRepo({ id: 2, isWorktree: true, localPath: 'repos/parent/.worktrees/feature2' }),
      ]
      const result = dedupeRepos(repos)
      expect(result).toHaveLength(2)
    })

    it('should dedupe non-worktree repos by key', () => {
      const repos = [
        createMockRepo({ id: 1, repoUrl: 'https://github.com/test/repo', localPath: 'repos/test-repo' }),
        createMockRepo({ id: 2, repoUrl: 'https://github.com/test/repo', localPath: 'repos/test-repo-clone' }),
      ]
      const result = dedupeRepos(repos)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    it('should keep first occurrence when deduping', () => {
      const repos = [
        createMockRepo({ id: 1, repoUrl: 'https://github.com/test/repo', localPath: 'repos/test-repo' }),
        createMockRepo({ id: 2, repoUrl: 'https://github.com/test/repo', localPath: 'repos/test-repo' }),
      ]
      const result = dedupeRepos(repos)
      expect(result[0].id).toBe(1)
    })

    it('should preserve worktrees alongside deduped repos', () => {
      const parentRepo = createMockRepo({ id: 1, repoUrl: 'https://github.com/test/repo', isWorktree: false })
      const worktree = createMockRepo({ id: 2, isWorktree: true, sourcePath: '/repos/test-repo/.worktrees/feature' })
      const repos = [parentRepo, worktree]
      const result = dedupeRepos(repos)
      expect(result).toHaveLength(2)
    })
  })

  describe('filterReposBySearch', () => {
    it('should return all repos when search is empty', () => {
      const repos = [
        createMockRepo({ id: 1, localPath: 'repos/test-repo' }),
        createMockRepo({ id: 2, localPath: 'repos/other-repo' }),
      ]
      const viewModels = repos.map(r => ({ ...r, attentionState: getAttentionState(r), activityTimestamp: getActivityTimestamp(r) }))
      const result = filterReposBySearch(viewModels, '')
      expect(result).toHaveLength(2)
    })

    it('should filter by display name', () => {
      const repos = [
        createMockRepo({ id: 1, repoUrl: 'https://github.com/org/test-repo', localPath: 'repos/test-repo' }),
        createMockRepo({ id: 2, repoUrl: 'https://github.com/org/other-repo', localPath: 'repos/other-repo' }),
      ]
      const viewModels = repos.map(r => ({ ...r, attentionState: getAttentionState(r), activityTimestamp: getActivityTimestamp(r) }))
      const result = filterReposBySearch(viewModels, 'test-repo')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    it('should filter case-insensitively', () => {
      const repos = [
        createMockRepo({ id: 1, repoUrl: 'https://github.com/org/test-repo', localPath: 'repos/test-repo' }),
        createMockRepo({ id: 2, repoUrl: 'https://github.com/org/other-repo', localPath: 'repos/other-repo' }),
      ]
      const viewModels = repos.map(r => ({ ...r, attentionState: getAttentionState(r), activityTimestamp: getActivityTimestamp(r) }))
      const result = filterReposBySearch(viewModels, 'TEST-REPO')
      expect(result).toHaveLength(1)
    })
  })

  describe('filterReposByMode', () => {
    const createViewModel = (overrides: Partial<Repo> = {}): RepoViewModel => {
      const repo = createMockRepo(overrides)
      return {
        ...repo,
        attentionState: getAttentionState(repo),
        activityTimestamp: getActivityTimestamp(repo),
      }
    }

    it('should return all repos for "all" mode', () => {
      const repos = [createViewModel({ id: 1 }), createViewModel({ id: 2 })]
      const result = filterReposByMode(repos, 'all')
      expect(result).toHaveLength(2)
    })

    it('should filter by "recent" mode (ready repos)', () => {
      const repos = [
        createViewModel({ id: 1, cloneStatus: 'ready' }),
        createViewModel({ id: 2, cloneStatus: 'cloning' }),
      ]
      const result = filterReposByMode(repos, 'recent')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    it('should filter by "attention" mode', () => {
      const gitStatusWithChanges = createMockGitStatus({ hasChanges: true })
      const gitStatusClean = createMockGitStatus({ hasChanges: false })
      const repos = [
        { ...createViewModel({ id: 1 }), attentionState: getAttentionState(createMockRepo({ cloneStatus: 'ready' }), gitStatusWithChanges) },
        { ...createViewModel({ id: 2 }), attentionState: getAttentionState(createMockRepo({ cloneStatus: 'ready' }), gitStatusClean) },
      ]
      const result = filterReposByMode(repos, 'attention')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    it('should filter by "worktrees" mode', () => {
      const repos = [
        createViewModel({ id: 1, isWorktree: true }),
        createViewModel({ id: 2, isWorktree: false }),
      ]
      const result = filterReposByMode(repos, 'worktrees')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    it('should filter by "local" mode', () => {
      const repos = [
        createViewModel({ id: 1, isLocal: true }),
        createViewModel({ id: 2, isLocal: false }),
      ]
      const result = filterReposByMode(repos, 'local')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })
  })

  describe('sortRepos', () => {
    const createViewModel = (id: number, overrides: Partial<Repo> = {}): RepoViewModel => {
      const repo = createMockRepo({ id, ...overrides })
      return {
        ...repo,
        attentionState: getAttentionState(repo),
        activityTimestamp: getActivityTimestamp(repo),
      }
    }

    it('should sort by recent (descending) by default', () => {
      const now = Date.now()
      const repos = [
        createViewModel(1, { lastAccessedAt: now - 1000 }),
        createViewModel(2, { lastAccessedAt: now - 500 }),
        createViewModel(3, { lastAccessedAt: now - 2000 }),
      ]
      const result = sortRepos(repos, 'recent')
      expect(result[0].id).toBe(2)
      expect(result[1].id).toBe(1)
      expect(result[2].id).toBe(3)
    })

    it('should sort alphabetically by name', () => {
      const repos = [
        createViewModel(1, { repoUrl: 'https://github.com/org/zebra', localPath: 'repos/zebra' }),
        createViewModel(2, { repoUrl: 'https://github.com/org/alpha', localPath: 'repos/alpha' }),
        createViewModel(3, { repoUrl: 'https://github.com/org/middle', localPath: 'repos/middle' }),
      ]
      const result = sortRepos(repos, 'name')
      expect(result[0].id).toBe(2)
      expect(result[1].id).toBe(3)
      expect(result[2].id).toBe(1)
    })

    it('should preserve manual order when provided', () => {
      const repos = [
        createViewModel(1),
        createViewModel(2),
        createViewModel(3),
      ]
      const manualOrder = [3, 1, 2]
      const result = sortRepos(repos, 'manual', manualOrder)
      expect(result[0].id).toBe(3)
      expect(result[1].id).toBe(1)
      expect(result[2].id).toBe(2)
    })

    it('should place unordered repos at the end for manual sort', () => {
      const repos = [
        createViewModel(1),
        createViewModel(2),
        createViewModel(3),
      ]
      const manualOrder = [1]
      const result = sortRepos(repos, 'manual', manualOrder)
      expect(result[0].id).toBe(1)
      expect(result[1].id).toBe(2)
      expect(result[2].id).toBe(3)
    })

    it('should return repos unchanged when manual order is empty', () => {
      const repos = [createViewModel(1), createViewModel(2)]
      const result = sortRepos(repos, 'manual', [])
      expect(result).toEqual(repos)
    })
  })

  describe('groupReposIntoSections', () => {
    const createViewModel = (id: number, overrides: Partial<Repo & { activityTimestamp: number }> = {}): RepoViewModel => {
      const repo = createMockRepo({ id, ...overrides })
      return {
        ...repo,
        attentionState: getAttentionState(repo),
        activityTimestamp: overrides.activityTimestamp ?? getActivityTimestamp(repo),
      }
    }

    it('should return single section for manual sort mode', () => {
      const repos = [createViewModel(1), createViewModel(2)]
      const result = groupReposIntoSections(repos, 'all', 'manual')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('All Repositories')
    })

    it('should return attention section for attention filter', () => {
      const now = Date.now()
      const repos: RepoViewModel[] = [
        {
          ...createMockRepo({ id: 1 }),
          activityTimestamp: now,
          attentionState: { hasChanges: true, ahead: 0, behind: 0, isCloneStatusReady: true }
        },
        {
          ...createMockRepo({ id: 2 }),
          activityTimestamp: now,
          attentionState: { hasChanges: false, ahead: 0, behind: 0, isCloneStatusReady: true }
        },
      ]
      const result = groupReposIntoSections(repos, 'attention', 'recent')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Needs Attention')
      expect(result[0].repos).toHaveLength(1)
    })

    it('should group repos into recent and all sections', () => {
      const now = Date.now()
      const oneHourAgo = now - 60 * 60 * 1000
      const repos = [
        createViewModel(1, {
          activityTimestamp: now,
          attentionState: { hasChanges: false, ahead: 0, behind: 0, isCloneStatusReady: true }
        }),
        createViewModel(2, {
          activityTimestamp: oneHourAgo,
          attentionState: { hasChanges: false, ahead: 0, behind: 0, isCloneStatusReady: true }
        }),
      ]
      const result = groupReposIntoSections(repos, 'all', 'recent')
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('countAttentionItems', () => {
    it('should count repos with changes, ahead, or behind', () => {
      const repos = [
        {
          ...createMockRepo({ id: 1 }),
          attentionState: { hasChanges: true, ahead: 0, behind: 0, isCloneStatusReady: true },
          activityTimestamp: Date.now(),
        },
        {
          ...createMockRepo({ id: 2 }),
          attentionState: { hasChanges: false, ahead: 2, behind: 0, isCloneStatusReady: true },
          activityTimestamp: Date.now(),
        },
        {
          ...createMockRepo({ id: 3 }),
          attentionState: { hasChanges: false, ahead: 0, behind: 0, isCloneStatusReady: true },
          activityTimestamp: Date.now(),
        },
      ]
      expect(countAttentionItems(repos)).toBe(2)
    })
  })
})