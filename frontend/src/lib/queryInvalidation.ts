import type { QueryClient } from '@tanstack/react-query'
import type { GitStatusResponse } from '@/types/git'

export function sessionTranscriptQueryKey(sessionID: string | null | undefined) {
  return ['opencode', 'transcript', sessionID]
}

export function shellsQueryKey(directory: string | null | undefined) {
  return ['opencode', 'shells', directory]
}

export function invalidateProviderCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
  queryClient.invalidateQueries({ queryKey: ['provider-auth-methods'] })
  queryClient.invalidateQueries({ queryKey: ['providers-with-models'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'providers'] })
}

interface ConfigInvalidationOptions {
  skipOpenCodeConfig?: boolean
}

export function invalidateConfigCaches(
  queryClient: QueryClient,
  options: ConfigInvalidationOptions = {},
) {
  queryClient.invalidateQueries({ queryKey: ['opencode', 'config'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'commands'] })
  if (!options.skipOpenCodeConfig) {
    queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
  }
  queryClient.invalidateQueries({ queryKey: ['health'] })
  queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
  queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-directory-files'] })
  invalidateProviderCaches(queryClient)
}

export function refreshOpenCodeServerCaches(queryClient: QueryClient, version?: string) {
  if (version) {
    queryClient.setQueryData<Record<string, unknown>>(['health'], (oldData) => (
      oldData ? { ...oldData, opencodeVersion: version } : oldData
    ))
    queryClient.setQueryData<Record<string, unknown>>(['opencode-versions'], (oldData) => (
      oldData ? { ...oldData, currentVersion: version } : oldData
    ))
  }
  invalidateConfigCaches(queryClient)
  queryClient.invalidateQueries({ queryKey: ['opencode-versions'] })
}

export function invalidateSkillCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['settings', 'skills'] })
  queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  queryClient.invalidateQueries({ queryKey: ['health'] })
}

export function invalidateSettingsCaches(queryClient: QueryClient, userId = 'default') {
  queryClient.invalidateQueries({ queryKey: ['settings', userId] })
  invalidateConfigCaches(queryClient)
}

export function invalidateRepoListCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['repos'] })
  queryClient.invalidateQueries({ queryKey: ['reposGitStatus'] })
}

interface RepoGitInvalidationOptions {
  invalidateStatus?: boolean
  invalidateRepoMeta?: boolean
}

export function invalidateRepoGitCaches(
  queryClient: QueryClient,
  repoId?: number | null,
  options: RepoGitInvalidationOptions = {},
) {
  if (!repoId) {
    invalidateRepoListCaches(queryClient)
    queryClient.invalidateQueries({ queryKey: ['repo'] })
    queryClient.invalidateQueries({ queryKey: ['branches'] })
    queryClient.invalidateQueries({ queryKey: ['gitStatus'] })
    queryClient.invalidateQueries({ queryKey: ['gitLog'] })
    queryClient.invalidateQueries({ queryKey: ['fileDiff'] })
    return
  }

  if (options.invalidateRepoMeta ?? true) {
    queryClient.invalidateQueries({ queryKey: ['repos'] })
    queryClient.invalidateQueries({ queryKey: ['repo', repoId] })
    queryClient.invalidateQueries({ queryKey: ['branches', repoId] })
  }
  if (options.invalidateStatus ?? true) {
    queryClient.invalidateQueries({ queryKey: ['gitStatus', repoId] })
  }
  queryClient.invalidateQueries({ queryKey: ['gitLog', repoId] })
  queryClient.invalidateQueries({ queryKey: ['fileDiff', repoId] })
}

function reposGitStatusQueryIncludesRepo(queryKey: readonly unknown[], repoId: number) {
  const repoIds = queryKey[1]
  return queryKey[0] === 'reposGitStatus' && Array.isArray(repoIds) && repoIds.includes(repoId)
}

export function setRepoGitStatusCaches(queryClient: QueryClient, repoId: number, data: GitStatusResponse) {
  queryClient.setQueryData(['gitStatus', repoId], data)
  queryClient.setQueriesData<Map<number, GitStatusResponse>>(
    {
      queryKey: ['reposGitStatus'],
      predicate: (query) => reposGitStatusQueryIncludesRepo(query.queryKey, repoId),
    },
    (oldData) => {
      if (!oldData) return oldData
      const updated = new Map(oldData)
      updated.set(repoId, data)
      return updated
    },
  )
}

const repoGitInvalidationTimers = new WeakMap<QueryClient, Map<number, ReturnType<typeof setTimeout>>>()

export function invalidateRepoGitCachesDebounced(queryClient: QueryClient, repoId: number, delayMs = 200) {
  const existingTimers = repoGitInvalidationTimers.get(queryClient)
  const timers = existingTimers ?? new Map<number, ReturnType<typeof setTimeout>>()
  if (!existingTimers) {
    repoGitInvalidationTimers.set(queryClient, timers)
  }
  const existing = timers.get(repoId)
  if (existing) clearTimeout(existing)
  timers.set(
    repoId,
    setTimeout(() => {
      timers.delete(repoId)
      invalidateRepoGitCaches(queryClient, repoId)
    }, delayMs),
  )
}

export function invalidateSessionCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'opencode' &&
      (query.queryKey[1] === 'sessions' ||
        query.queryKey[1] === 'session' ||
        query.queryKey[1] === 'transcript'),
  })
}

export function invalidateSessionListCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'opencode' && query.queryKey[1] === 'sessions',
  })
}

interface SessionListInvalidationState {
  timer: ReturnType<typeof setTimeout> | null
  directories: Set<string>
  invalidateAll: boolean
}

const sessionListInvalidationStates = new WeakMap<QueryClient, SessionListInvalidationState>()

function sessionListQueryMatchesDirectories(queryKey: readonly unknown[], directories: Set<string>) {
  if (queryKey[0] !== 'opencode' || queryKey[1] !== 'sessions') return false
  const directoryKey = queryKey[2]
  if (typeof directoryKey !== 'string') return false
  return directoryKey.split('|').some((directory) => directories.has(directory))
}

function flushSessionListInvalidation(
  queryClient: QueryClient,
  state: SessionListInvalidationState,
) {
  if (state.invalidateAll) {
    invalidateSessionListCaches(queryClient)
    return
  }
  queryClient.invalidateQueries({
    predicate: (query) => sessionListQueryMatchesDirectories(query.queryKey, state.directories),
  })
}

export function invalidateSessionListCachesDebounced(
  queryClient: QueryClient,
  directory?: string,
  delayMs = 200,
) {
  const state = sessionListInvalidationStates.get(queryClient) ?? {
    timer: null,
    directories: new Set<string>(),
    invalidateAll: false,
  }
  if (state.timer) clearTimeout(state.timer)
  if (directory) {
    state.directories.add(directory)
  } else {
    state.invalidateAll = true
  }
  sessionListInvalidationStates.set(queryClient, state)
  state.timer = setTimeout(() => {
    sessionListInvalidationStates.delete(queryClient)
    flushSessionListInvalidation(queryClient, state)
  }, delayMs)
}

const queryKeysInvalidationTimers = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>()

export function invalidateQueryKeysDebounced(
  queryClient: QueryClient,
  queryKeys: readonly (readonly unknown[])[],
  delayMs = 200,
) {
  const existingTimers = queryKeysInvalidationTimers.get(queryClient)
  const timers = existingTimers ?? new Map<string, ReturnType<typeof setTimeout>>()
  if (!existingTimers) {
    queryKeysInvalidationTimers.set(queryClient, timers)
  }

  const timerKey = JSON.stringify(queryKeys)
  const existing = timers.get(timerKey)
  if (existing) clearTimeout(existing)
  timers.set(
    timerKey,
    setTimeout(() => {
      timers.delete(timerKey)
      for (const queryKey of queryKeys) {
        queryClient.invalidateQueries({ queryKey: [...queryKey] })
      }
    }, delayMs),
  )
}

const providerInvalidationTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()

export function invalidateProviderCachesDebounced(queryClient: QueryClient, delayMs = 200) {
  const existing = providerInvalidationTimers.get(queryClient)
  if (existing) clearTimeout(existing)
  providerInvalidationTimers.set(
    queryClient,
    setTimeout(() => {
      providerInvalidationTimers.delete(queryClient)
      invalidateProviderCaches(queryClient)
    }, delayMs),
  )
}
