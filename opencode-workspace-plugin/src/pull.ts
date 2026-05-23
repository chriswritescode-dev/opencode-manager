import { mkdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, createWriteStream, chmodSync } from 'fs'
import { dirname, join, sep, normalize } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { DiffEntry, ManagerApi, WorkingTreeDiff } from './manager-api.js'
import { getDirtyPaths, getHead, getOriginUrl, getRepoRoot, urlsEqual } from './local-repo.js'

export interface RemoteRepoSummary {
  repoId: number
  name: string
  originUrl: string | null
  directory: string
}

export class PullAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PullAbort'
  }
}

function safeRelative(repoRoot: string, relPath: string): string {
  if (!relPath || relPath.includes('\0')) throw new PullAbort(`invalid path: ${relPath}`)
  const normalized = normalize(relPath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`) || normalized === '..' || normalized.startsWith(sep)) {
    throw new PullAbort(`refusing path outside repo: ${relPath}`)
  }
  return join(repoRoot, normalized)
}

export function pickRemoteRepo(repos: RemoteRepoSummary[], localOrigin: string): RemoteRepoSummary[] {
  return repos.filter((r) => urlsEqual(r.originUrl, localOrigin))
}

export interface PullPlan {
  repoRoot: string
  remoteRepo: RemoteRepoSummary
  diff: WorkingTreeDiff
  headLocal: string | null
  headMatches: boolean
  dirtyConflicts: string[]
}

export interface PreparePullOptions {
  cwd: string
  remotes: RemoteRepoSummary[]
  api: ManagerApi
  /** when true, ignore HEAD mismatch and dirty-conflict checks */
  force?: boolean
}

export async function preparePull(options: PreparePullOptions): Promise<PullPlan> {
  const { cwd, remotes, api, force = false } = options

  const repoRoot = getRepoRoot(cwd)
  if (!repoRoot) {
    throw new PullAbort('not inside a git repository')
  }
  const localOrigin = getOriginUrl(repoRoot)
  if (!localOrigin) {
    throw new PullAbort(`local repo at ${repoRoot} has no \`origin\` remote`)
  }

  const matches = pickRemoteRepo(remotes, localOrigin)
  if (matches.length === 0) {
    throw new PullAbort(`no Manager repo matches origin ${localOrigin}`)
  }
  if (matches.length > 1) {
    const names = matches.map((m) => `${m.repoId}:${m.name}`).join(', ')
    throw new PullAbort(`multiple Manager repos match origin ${localOrigin}: ${names}. Disambiguate with \`ocm pull <repoId>\`.`)
  }
  const remoteRepo = matches[0]!

  const diff = await api.getWorkingTreeDiff(remoteRepo.repoId)
  const headLocal = getHead(repoRoot)
  const headMatches = Boolean(headLocal && diff.head && headLocal === diff.head)

  const dirtySet = getDirtyPaths(repoRoot)
  const changedRemote = new Set(diff.files.map((f) => f.path))
  const conflicts: string[] = []
  for (const path of dirtySet) {
    if (changedRemote.has(path)) conflicts.push(path)
  }

  if (!force) {
    if (!headMatches) {
      throw new PullAbort(
        `local HEAD ${headLocal ?? '(none)'} differs from manager HEAD ${diff.head ?? '(none)'}. \`git fetch && git checkout ${diff.head}\` or run with --force.`,
      )
    }
    if (conflicts.length > 0) {
      throw new PullAbort(
        `local working tree has uncommitted changes that overlap with remote changes:\n  ${conflicts.join('\n  ')}\nCommit or stash, or run with --force.`,
      )
    }
  }

  return {
    repoRoot,
    remoteRepo,
    diff,
    headLocal,
    headMatches,
    dirtyConflicts: conflicts,
  }
}

export interface ApplyPullResult {
  applied: number
  skipped: DiffEntry[]
}

export async function applyPull(plan: PullPlan, api: ManagerApi, opts: { dryRun?: boolean } = {}): Promise<ApplyPullResult> {
  const { repoRoot, diff, remoteRepo } = plan
  const skipped: DiffEntry[] = []
  let applied = 0

  // 1. Materialise modifications/additions/untracked/renamed.
  for (const entry of diff.files) {
    if (entry.status === 'unmerged' || entry.status === 'typechange') {
      skipped.push(entry)
      continue
    }
    if (entry.status === 'deleted') continue

    if (entry.status === 'renamed' && entry.oldPath) {
      // delete oldPath; new path is written below
      const oldFull = safeRelative(repoRoot, entry.oldPath)
      if (!opts.dryRun) {
        try { unlinkSync(oldFull) } catch { /* may not exist locally */ }
      }
    }

    const destPath = safeRelative(repoRoot, entry.path)
    const destDir = dirname(destPath)

    if (entry.symlinkTarget) {
      if (!opts.dryRun) {
        mkdirSync(destDir, { recursive: true })
        try { unlinkSync(destPath) } catch { /* might be new */ }
        symlinkSync(entry.symlinkTarget, destPath)
      }
      applied += 1
      continue
    }

    if (opts.dryRun) {
      applied += 1
      continue
    }

    mkdirSync(destDir, { recursive: true })
    const tmpPath = `${destPath}.ocm.tmp.${process.pid}.${Date.now()}`

    const body = await api.getWorkingTreeFile(remoteRepo.repoId, entry.path)
    const nodeStream = Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0])
    try {
      await pipeline(nodeStream, createWriteStream(tmpPath))
    } catch (err) {
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
      throw err
    }
    renameSync(tmpPath, destPath)
    if (entry.mode && entry.mode.length >= 6) {
      const numericMode = parseInt(entry.mode.slice(-3), 8)
      if (!Number.isNaN(numericMode)) chmodSync(destPath, numericMode)
    }
    applied += 1
  }

  // 2. Apply deletions last (so renames already moved their old paths).
  for (const entry of diff.files) {
    if (entry.status !== 'deleted') continue
    const fullPath = safeRelative(repoRoot, entry.path)
    if (opts.dryRun) {
      applied += 1
      continue
    }
    try {
      const st = statSync(fullPath)
      if (st.isDirectory()) {
        rmSync(fullPath, { recursive: true, force: true })
      } else {
        unlinkSync(fullPath)
      }
      applied += 1
    } catch {
      // already missing locally — count as applied
      applied += 1
    }
  }

  return { applied, skipped }
}

// re-exported for tests/visibility
export { safeRelative as _safeRelativeForTests }
