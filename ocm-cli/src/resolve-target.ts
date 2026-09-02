import { getRepoRoot } from './local-repo.js'
import type { RemoteRepoSummary } from './mirror.js'

export interface TargetRepo {
  repoId: number
  name: string
  branch: string | null
  directory: string
  projectId?: string | null
  isWorktree?: boolean
}

export interface RepoIdentity {
  repoId: number
  name: string
  branch: string | null
  isWorktree?: boolean
  directory?: string
}

export function formatRepoIdentity(repo: RepoIdentity): string {
  const parts = [`id=${repo.repoId}`, repo.isWorktree ? 'worktree' : 'repo', `branch=${repo.branch ?? 'n/a'}`]
  if (repo.directory) parts.push(`path=${repo.directory}`)
  return `${repo.name} (${parts.join(', ')})`
}

export function formatRepoIdentities(repos: readonly RepoIdentity[]): string {
  return repos.map(formatRepoIdentity).join(', ')
}

export interface RepoIdParseResult {
  repoId: number | null
  error?: string
}

export function parseRepoIdPositional(args: readonly string[], knownFlags: readonly string[]): RepoIdParseResult {
  let repoId: number | null = null
  for (const arg of args) {
    if (knownFlags.includes(arg)) continue
    if (arg.startsWith('-')) {
      return { repoId: null, error: `unknown option: ${arg}` }
    }
    const id = Number(arg)
    if (!/^\d+$/.test(arg) || !Number.isSafeInteger(id) || id <= 0) {
      return { repoId: null, error: `invalid repo id: ${arg}; expected a positive integer` }
    }
    if (repoId !== null) {
      return { repoId: null, error: `multiple repo ids given: ${repoId} and ${arg}` }
    }
    repoId = id
  }
  return { repoId }
}

export interface MatchRestriction {
  matches: RemoteRepoSummary[]
  error?: string
}

export function restrictMatchesToRequestedRepo(matches: readonly RemoteRepoSummary[], requestedRepoId: number | null, localProjectId: string): MatchRestriction {
  if (requestedRepoId === null) return { matches: [...matches] }
  const selected = matches.filter((m) => m.repoId === requestedRepoId)
  if (selected.length === 0) {
    const available = formatRepoIdentities(matches)
    return {
      matches: [],
      error: available
        ? `repo ${requestedRepoId} does not match project ${localProjectId}; matching repos: ${available}`
        : `repo ${requestedRepoId} does not match project ${localProjectId}; no Manager repo matches this project`,
    }
  }
  return { matches: selected }
}

export type ResolveResult =
  | { kind: 'cwd-match'; repo: TargetRepo; repoRoot: string }
  | { kind: 'last'; repo: TargetRepo }
  | { kind: 'cwd-ambiguous'; matches: TargetRepo[]; localProjectId: string; repoRoot: string }
  | { kind: 'local'; reason: 'no-match' | 'no-target'; repoRoot: string | null }

export interface ResolveInput {
  cwd: string
  repos: TargetRepo[]
  localProjectId: string | null
  last?: { repoId: number; name: string; directory: string; branch: string | null }
}

export function resolveTarget(input: ResolveInput): ResolveResult {
  const repoRoot = getRepoRoot(input.cwd)

  if (repoRoot) {
    if (input.localProjectId) {
      const matches = input.repos.filter((r) => r.projectId && r.projectId === input.localProjectId)
      if (matches.length === 1) {
        return { kind: 'cwd-match', repo: matches[0]!, repoRoot }
      }
      if (matches.length > 1) {
        return { kind: 'cwd-ambiguous', matches, localProjectId: input.localProjectId, repoRoot }
      }
    }
    return { kind: 'local', reason: 'no-match', repoRoot }
  }

  if (input.last) {
    return { kind: 'last', repo: toTarget(input.last) }
  }
  return { kind: 'local', reason: 'no-target', repoRoot }
}

function toTarget(last: NonNullable<ResolveInput['last']>): TargetRepo {
  return {
    repoId: last.repoId,
    name: last.name,
    branch: last.branch,
    directory: last.directory,
  }
}
