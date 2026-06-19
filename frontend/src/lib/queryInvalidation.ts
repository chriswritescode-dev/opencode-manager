import type { QueryClient } from '@tanstack/react-query'
import type { GitStatusResponse } from '@/types/git'

export function messagesQueryKey(
  opcodeUrl: string | null | undefined,
  sessionID: string | null | undefined,
  directory: string | null | undefined,
) {
  return ['opencode', 'messages', opcodeUrl, sessionID, directory]
}

export function invalidateProviderCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
  queryClient.invalidateQueries({ queryKey: ['provider-auth-methods'] })
  queryClient.invalidateQueries({ queryKey: ['providers'] })
  queryClient.invalidateQueries({ queryKey: ['providers-with-models'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'providers'] })
  queryClient.invalidateQueries({ queryKey: ['providers-for-execution-model'] })
}

export function invalidateConfigCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['opencode', 'config'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'commands'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
  queryClient.invalidateQueries({ queryKey: ['health'] })
  queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-skills'] })
  queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-directory-files'] })
  invalidateProviderCaches(queryClient)
}

export function invalidateSkillCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['settings', 'skills'] })
  queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-skills'] })
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

  queryClient.invalidateQueries({ queryKey: ['repos'] })
  queryClient.invalidateQueries({ queryKey: ['repo', repoId] })
  queryClient.invalidateQueries({ queryKey: ['branches', repoId] })
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
        query.queryKey[1] === 'messages'),
  })
}

export function invalidateSessionListCaches(queryClient: QueryClient, opcodeUrl?: string | null) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      if (query.queryKey[0] !== 'opencode') return false
      if (query.queryKey[1] !== 'sessions') return false
      if (opcodeUrl && query.queryKey[2] !== opcodeUrl) return false
      return true
    },
  })
}

const sessionListInvalidationTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()

export function invalidateSessionListCachesDebounced(queryClient: QueryClient, delayMs = 200) {
  const existing = sessionListInvalidationTimers.get(queryClient)
  if (existing) clearTimeout(existing)
  sessionListInvalidationTimers.set(
    queryClient,
    setTimeout(() => {
      sessionListInvalidationTimers.delete(queryClient)
      invalidateSessionListCaches(queryClient)
    }, delayMs),
  )
}
