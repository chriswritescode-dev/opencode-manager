import { spawnSync, type SpawnSyncReturns } from 'child_process'
import { copyFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function spawnGit(
  cwd: string,
  args: string[],
  opts: { input?: string; env?: NodeJS.ProcessEnv } = {},
): SpawnSyncReturns<string> {
  return spawnSync('git', args, { cwd, input: opts.input, encoding: 'utf-8', env: opts.env ?? process.env })
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const res = spawnGit(cwd, args, { env })
  if (res.status !== 0) return null
  return (res.stdout ?? '').trim()
}

function gitRaw(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const res = spawnGit(cwd, args, { env })
  if (res.status !== 0) return null
  return res.stdout ?? ''
}

export function runGit(
  cwd: string,
  args: string[],
  input?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const res = spawnGit(cwd, args, { input, env })
  if (res.status !== 0) {
    const stderr = (res.stderr ?? '').trim()
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
  }
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

export function getBranchName(dir: string): string | null {
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return branch && branch !== 'HEAD' ? branch : null
}

function getWorkingTreeDiff(dir: string): string {
  return gitRaw(dir, ['diff', '--binary', 'HEAD', '--']) ?? ''
}

export function getHeadSha(dir: string): string | null {
  return git(dir, ['rev-parse', 'HEAD'])
}

export function hasCommit(dir: string, sha: string): boolean {
  return git(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null
}

export function isAncestor(dir: string, ancestor: string, descendant: string): boolean {
  return spawnGit(dir, ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0
}

export function countCommitsAhead(dir: string, from: string, to: string): number {
  const out = git(dir, ['rev-list', '--count', `${from}..${to}`])
  const n = out ? Number(out) : NaN
  return Number.isInteger(n) ? n : -1
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
