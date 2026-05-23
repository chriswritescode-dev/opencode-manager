import { getRepoRoot, getOriginUrl, urlsEqual } from './local-repo.js'

export interface TargetRepo {
  repoId: number
  name: string
  branch: string | null
  directory: string
  originUrl?: string | null
}

export type ResolveResult =
  | { kind: 'cwd-match'; repo: TargetRepo; repoRoot: string }
  | { kind: 'last'; repo: TargetRepo }
  | { kind: 'cwd-ambiguous'; matches: TargetRepo[]; localOrigin: string; repoRoot: string }
  | { kind: 'local'; reason: 'no-match' | 'no-target'; repoRoot: string | null }

export interface ResolveInput {
  cwd: string
  repos: TargetRepo[]
  last?: { repoId: number; name: string; directory: string; branch: string | null }
}

export function resolveTarget(input: ResolveInput): ResolveResult {
  const repoRoot = getRepoRoot(input.cwd)
  const localOrigin = repoRoot ? getOriginUrl(repoRoot) : null

  if (repoRoot && localOrigin) {
    const matches = input.repos.filter((r) => urlsEqual(localOrigin, r.originUrl))
    if (matches.length === 1) {
      return { kind: 'cwd-match', repo: matches[0]!, repoRoot }
    }
    if (matches.length > 1) {
      return { kind: 'cwd-ambiguous', matches, localOrigin, repoRoot }
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
