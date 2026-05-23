import { createReadStream, statSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { buildLocalManifest } from './local-manifest.js'
import { getHead, getOriginUrl, getRepoRoot, urlsEqual } from './local-repo.js'
import type { BeginPushResponse, ManagerApi, PushManifestEntry } from './manager-api.js'
import type { RemoteRepoSummary } from './pull.js'

export class PushAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PushAbort'
  }
}

export interface PreparePushOptions {
  cwd: string
  remotes: RemoteRepoSummary[]
  api: ManagerApi
  force?: boolean
  includeDeletions?: boolean
}

export interface PushPlan {
  repoRoot: string
  remoteRepo: RemoteRepoSummary
  manifest: PushManifestEntry[]
  skipped: { path: string; status: string }[]
  localHead: string | null
}

export function preparePush(options: PreparePushOptions): PushPlan {
  const { cwd, remotes } = options
  const repoRoot = getRepoRoot(cwd)
  if (!repoRoot) throw new PushAbort('not inside a git repository')
  const localOrigin = getOriginUrl(repoRoot)
  if (!localOrigin) throw new PushAbort(`local repo at ${repoRoot} has no \`origin\` remote`)

  const matches = remotes.filter((r) => urlsEqual(r.originUrl, localOrigin))
  if (matches.length === 0) throw new PushAbort(`no Manager repo matches origin ${localOrigin}`)
  if (matches.length > 1) {
    const names = matches.map((m) => `${m.repoId}:${m.name}`).join(', ')
    throw new PushAbort(`multiple Manager repos match origin ${localOrigin}: ${names}. Disambiguate with \`ocm push <repoId>\`.`)
  }
  const remoteRepo = matches[0]!

  const { entries, skipped } = buildLocalManifest(repoRoot, { includeDeletions: options.includeDeletions ?? true })
  const localHead = getHead(repoRoot)

  return {
    repoRoot,
    remoteRepo,
    manifest: entries,
    skipped: skipped.map((s) => ({ path: s.path, status: s.status })),
    localHead,
  }
}

export interface ExecutePushResult {
  applied: number
  remoteHead: string | null
  uploaded: number
}

export async function executePush(plan: PushPlan, api: ManagerApi, opts: { force?: boolean; dryRun?: boolean } = {}): Promise<ExecutePushResult> {
  const { repoRoot, remoteRepo, manifest, localHead } = plan

  if (opts.dryRun) {
    return { applied: manifest.length, remoteHead: null, uploaded: 0 }
  }

  let begin: BeginPushResponse
  try {
    begin = await api.beginPush(remoteRepo.repoId, {
      expectedHead: localHead,
      force: opts.force,
      manifest,
    })
  } catch (err) {
    const detail = (err as Error & { detail?: { error?: string; conflicts?: string[]; remoteHead?: string; message?: string } }).detail
    if (detail?.error === 'head_mismatch') {
      throw new PushAbort(
        `local HEAD ${localHead ?? '(none)'} differs from manager HEAD ${detail.remoteHead ?? '(none)'}. Align HEADs or run with --force.`,
      )
    }
    if (detail?.error === 'remote_dirty_conflict') {
      const conflicts = detail.conflicts?.join('\n  ') ?? '(none)'
      throw new PushAbort(
        `manager working tree has uncommitted changes overlapping with this push:\n  ${conflicts}\nUse --force to overwrite, or stash/commit on the manager first.`,
      )
    }
    throw err
  }

  let uploaded = 0
  try {
    for (const entry of manifest) {
      if (entry.status === 'deleted') continue
      if (entry.symlinkTarget) continue
      const full = join(repoRoot, entry.path)
      const st = statSync(full)
      const stream = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream<Uint8Array>
      await api.pushFile(begin.token, entry.path, stream, st.size)
      uploaded += 1
    }
    const result = await api.commitPush(begin.token)
    return { applied: result.applied, remoteHead: begin.remoteHead, uploaded }
  } catch (err) {
    await api.cancelPush(begin.token)
    throw err
  }
}
