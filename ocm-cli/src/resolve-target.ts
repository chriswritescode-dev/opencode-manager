import { getRepoRoot } from './local-repo.js'

export interface TargetRepo {
  repoId: number
  name: string
  branch: string | null
  directory: string
  projectId?: string | null
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
