import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (error, stdout) => {
      resolve(error ? null : stdout.trim())
    })
  })
}

function gitRemoteParts(host: string, name: string): string | undefined {
  const pathname = name
    .replace(/^\/+/, '')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '')
  if (!host || !pathname) return undefined
  return `${host.toLowerCase()}/${pathname}`
}

/**
 * Normalizes a git remote URL into OpenCode's `host/path` identity form, or
 * returns undefined for unsupported remotes (e.g. `file:` URLs). Mirrors the
 * normalization in OpenCode's `ProjectV2.resolve`.
 */
export function normalizeGitRemote(input: string): string | undefined {
  const value = input.trim()
  if (!value) return undefined

  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'file:') return undefined
    return gitRemoteParts(parsed.hostname, parsed.pathname)
  } catch {
    const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
    if (scp) return gitRemoteParts(scp[2]!, scp[3]!)
    return undefined
  }
}

/**
 * Computes the OpenCode remote-backed project ID for a git origin URL, or
 * undefined when the remote cannot be normalized.
 */
export function gitRemoteProjectId(originUrl: string): string | undefined {
  const normalized = normalizeGitRemote(originUrl)
  if (!normalized) return undefined
  return createHash('sha1').update(`git-remote:${normalized}`).digest('hex')
}

/**
 * Resolves the OpenCode project ID for a git working directory using the same
 * precedence OpenCode applies: normalized origin remote hash, then the cached
 * `<git-common-dir>/opencode` id, then the sorted first root commit. Returns
 * null when the directory is not a git repository or no id can be derived.
 */
export async function resolveOpenCodeProjectId(repoDir: string): Promise<string | null> {
  const worktree = await git(repoDir, ['rev-parse', '--show-toplevel'])
  if (!worktree) return null

  const origin = await git(worktree, ['remote', 'get-url', 'origin'])
  if (origin) {
    const id = gitRemoteProjectId(origin)
    if (id) return id
  }

  const commonDir = await git(repoDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (commonDir) {
    try {
      const cached = (await readFile(path.join(commonDir, 'opencode'), 'utf-8')).trim()
      if (cached) return cached
    } catch {
      // cache file absent or unreadable
    }
  }

  const rootsOutput = await git(worktree, ['rev-list', '--max-parents=0', 'HEAD'])
  if (rootsOutput) {
    const root = rootsOutput.split('\n').map((line) => line.trim()).filter(Boolean).sort()[0]
    if (root) return root
  }

  return null
}
