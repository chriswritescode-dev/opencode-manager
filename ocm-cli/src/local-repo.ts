import { spawnSync } from 'child_process'

function git(cwd: string, args: string[]): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (res.status !== 0) return null
  return (res.stdout ?? '').trim()
}

export function getRepoRoot(cwd: string): string | null {
  return git(cwd, ['rev-parse', '--show-toplevel'])
}

export function getOriginUrl(dir: string): string | null {
  return git(dir, ['remote', 'get-url', 'origin'])
}

export function getDirtyPaths(dir: string): Set<string> {
  const out = git(dir, ['status', '--porcelain', '-z', '--untracked-files=all'])
  if (!out) return new Set()
  const paths = new Set<string>()
  for (const record of out.split('\0')) {
    if (!record) continue
    const path = record.slice(3)
    if (path) paths.add(path)
  }
  return paths
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, '')
    .replace(/^git@([^:]+):/, 'ssh://git@$1/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function getBranchName(dir: string): string | null {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function urlsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return normalizeUrl(a) === normalizeUrl(b)
}
