import { spawnSync } from 'child_process'
import { copyFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8', env })
  if (res.status !== 0) return null
  return (res.stdout ?? '').trim()
}

function gitRaw(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8', env })
  if (res.status !== 0) return null
  return res.stdout ?? ''
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

export function getWorkingTreeDiff(dir: string): string {
  return gitRaw(dir, ['diff', '--binary', 'HEAD', '--']) ?? ''
}

export function getHeadSha(dir: string): string | null {
  return git(dir, ['rev-parse', 'HEAD'])
}

export function getMirrorPatch(dir: string): string {
  const untracked = gitRaw(dir, ['ls-files', '--others', '--exclude-standard', '-z'])
    ?.split('\0')
    .filter(Boolean) ?? []
  if (untracked.length === 0) return getWorkingTreeDiff(dir)

  const indexPath = git(dir, ['rev-parse', '--git-path', 'index'])
  const tempIndex = join(tmpdir(), `ocm-index-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex }

  try {
    if (indexPath && existsSync(indexPath)) {
      copyFileSync(indexPath, tempIndex)
    }
    const add = spawnSync('git', ['add', '-N', '--', ...untracked], { cwd: dir, encoding: 'utf-8', env })
    if (add.status !== 0) return getWorkingTreeDiff(dir)
    return gitRaw(dir, ['diff', '--binary', 'HEAD', '--'], env) ?? ''
  } finally {
    rmSync(tempIndex, { force: true })
  }
}

export function urlsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return normalizeUrl(a) === normalizeUrl(b)
}
