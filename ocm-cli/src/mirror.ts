import { spawnSync, spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import * as fsp from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { getRepoRoot, getDirtyPaths, getHeadSha, getBranchName, getMirrorPatch, runGit, hasCommit, isAncestor, countCommitsAhead } from './local-repo.js'
import { resolveOpenCodeProjectId } from '@opencode-manager/shared/project-id'
import type { ManagerApi } from './manager-api.js'
import { ManagerApiError } from './manager-api.js'

const HARDCODED_EXCLUDES = ['node_modules', 'dist', '.next', '.venv', '__pycache__', '.turbo', '.DS_Store', '._*']
const PART_RETRIES = 3
const PART_BACKOFF_MS = [500, 2000, 8000]
const MIRROR_GZIP = true

function getGitignoreExclusions(repoRoot: string): string[] {
  const res = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  })
  if (res.status !== 0) return []
  return (res.stdout ?? '').split('\n').filter((line) => line.length > 0)
}

async function carryOverIgnored(fromDir: string, toDir: string): Promise<void> {
  if (!existsSync(fromDir)) return
  for (const rel of getGitignoreExclusions(fromDir)) {
    const clean = rel.replace(/\/+$/, '')
    if (!clean) continue
    const src = join(fromDir, clean)
    const dest = join(toDir, clean)
    if (!existsSync(src) || existsSync(dest)) continue
    await fsp.mkdir(dirname(dest), { recursive: true })
    await fsp.rename(src, dest).catch(() => {})
  }
}

export class MirrorAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MirrorAbort'
  }
}

export interface RemoteRepoSummary {
  repoId: number
  name: string
  projectId: string | null
  branch: string | null
}

export interface MirrorPlan {
  repoRoot: string
  localProjectId: string
  matched: RemoteRepoSummary[]
}

export async function prepareMirror(cwd: string, remotes: RemoteRepoSummary[]): Promise<MirrorPlan> {
  const repoRoot = getRepoRoot(cwd)
  if (!repoRoot) throw new MirrorAbort('not in a git repository')

  const localProjectId = await resolveOpenCodeProjectId(repoRoot)
  if (!localProjectId) throw new MirrorAbort('could not resolve an OpenCode project id for this repository')

  const matched = remotes.filter((r) => r.projectId && r.projectId === localProjectId)

  return { repoRoot, localProjectId, matched }
}

export function pickMatchedRepo(matched: RemoteRepoSummary[], localBranch: string | null): RemoteRepoSummary | null {
  const onBranch = matched.filter((r) => localBranch !== null && r.branch === localBranch)
  if (onBranch.length === 1) return onBranch[0]!
  return matched.length === 1 ? matched[0]! : null
}

export interface PushDivergence {
  serverHead: string | null
  serverBranch: string | null
  serverDirty: boolean
  diverged: boolean
  lostCommits: number
}

export async function checkPushDivergence(repoRoot: string, api: ManagerApi, repoId: number): Promise<PushDivergence> {
  const info = await api.mirrorHead(repoId)
  const { head: serverHead, branch: serverBranch, dirty: serverDirty } = info
  const localHead = getHeadSha(repoRoot)

  if (!serverHead || serverHead === localHead) {
    return { serverHead, serverBranch, serverDirty, diverged: false, lostCommits: 0 }
  }
  if (!hasCommit(repoRoot, serverHead)) {
    return { serverHead, serverBranch, serverDirty, diverged: true, lostCommits: -1 }
  }
  if (localHead && isAncestor(repoRoot, serverHead, localHead)) {
    return { serverHead, serverBranch, serverDirty, diverged: false, lostCommits: 0 }
  }
  const lostCommits = localHead ? countCommitsAhead(repoRoot, localHead, serverHead) : -1
  return { serverHead, serverBranch, serverDirty, diverged: true, lostCommits }
}

export function describePushDivergence(div: PushDivergence): string[] {
  const reasons: string[] = []
  if (div.diverged) {
    reasons.push(div.lostCommits >= 0
      ? `the server is ${div.lostCommits} commit(s) ahead of your local branch`
      : 'the server has commit(s) not present in your local branch')
  }
  if (div.serverDirty) reasons.push('the server has uncommitted changes')
  return reasons
}

export interface PullDivergence {
  diverged: boolean
  lostCommits: number
  serverHead: string | null
}

export async function checkPullDivergence(repoRoot: string, api: ManagerApi, repoId: number): Promise<PullDivergence> {
  const localHead = getHeadSha(repoRoot)
  if (!localHead) return { diverged: false, lostCommits: 0, serverHead: null }

  const { contained } = await api.mirrorContains(repoId, localHead)
  if (contained) return { diverged: false, lostCommits: 0, serverHead: null }

  let serverHead: string | null = null
  let lostCommits = -1
  try {
    serverHead = (await api.mirrorHead(repoId)).head
    if (serverHead) lostCommits = countCommitsAhead(repoRoot, serverHead, localHead)
  } catch {
    // best-effort: count is informational only
  }
  return { diverged: true, lostCommits, serverHead }
}

export interface MirrorProgress {
  bytesSent: number
}

export interface MirrorUpOpts {
  api: ManagerApi
  force: boolean
  create?: { name: string; originUrl: string | null; branch: string | null }
  onProgress?: (p: MirrorProgress) => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryablePartError(err: unknown): boolean {
  if (err instanceof ManagerApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429
  }
  return true
}

async function uploadPartWithRetry(
  api: ManagerApi,
  repoId: number,
  uploadId: string,
  index: number,
  chunk: Buffer,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < PART_RETRIES; attempt++) {
    try {
      await api.mirrorUploadPart(repoId, uploadId, index, chunk)
      return
    } catch (err) {
      lastError = err
      if (!isRetryablePartError(err)) break
      if (attempt < PART_RETRIES - 1) {
        await delay(PART_BACKOFF_MS[attempt]!)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`part ${index} failed: ${String(lastError)}`)
}

interface PartFlusher {
  push(buf: Buffer): Promise<void>
  finish(): Promise<number>
}

function createPartFlusher(
  api: ManagerApi,
  repoId: number,
  uploadId: string,
  chunkSize: number,
): PartFlusher {
  let acc: Buffer[] = []
  let accLen = 0
  let index = 0

  const flush = async (): Promise<void> => {
    if (accLen === 0) return
    const buf = Buffer.concat(acc, accLen)
    acc = []
    accLen = 0
    await uploadPartWithRetry(api, repoId, uploadId, index, buf)
    index += 1
  }

  return {
    async push(buf: Buffer): Promise<void> {
      let offset = 0
      while (offset < buf.length) {
        const room = chunkSize - accLen
        const take = Math.min(room, buf.length - offset)
        acc.push(buf.subarray(offset, offset + take))
        accLen += take
        offset += take
        if (accLen >= chunkSize) {
          await flush()
        }
      }
    },
    async finish(): Promise<number> {
      await flush()
      return index
    },
  }
}

export async function mirrorUp(
  plan: MirrorPlan,
  opts: MirrorUpOpts,
): Promise<{ repoId: number; branch: string | null; head: string | null; created: boolean }> {
  const repoId = opts.create ? 0 : plan.matched[0]!.repoId

  const begin = await opts.api.mirrorBegin(repoId, { force: opts.force, create: opts.create })

  let bytesSent = 0

  const tarArgs = ['-c', '-C', plan.repoRoot]
  if (MIRROR_GZIP) tarArgs.unshift('-z')
  for (const dir of HARDCODED_EXCLUDES) tarArgs.push('--exclude', dir)

  const ignoredPaths = getGitignoreExclusions(plan.repoRoot)
  let excludeFile: string | null = null

  if (ignoredPaths.length > 0) {
    excludeFile = join(tmpdir(), `ocm-exclude-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
    await fsp.writeFile(excludeFile, ignoredPaths.join('\n'))
    tarArgs.push('--exclude-from', excludeFile)
  }

  tarArgs.push('.')

  const child = spawn('tar', tarArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })

  const stderrChunks: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const tarExit = new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
        reject(new Error(`tar exited with code ${code}${stderr ? `: ${stderr}` : ''}`))
      }
    })
    child.on('error', reject)
  })

  const flusher = createPartFlusher(opts.api, begin.repoId, begin.uploadId, begin.chunkSize)

  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      await flusher.push(chunk)
      bytesSent += chunk.length
      opts.onProgress?.({ bytesSent })
    }
    await tarExit
    const totalParts = await flusher.finish()
    opts.onProgress?.({ bytesSent })
    const result = await opts.api.mirrorCommit(begin.repoId, begin.uploadId, totalParts, MIRROR_GZIP)
    return result
  } catch (err) {
    if (!child.killed) child.kill('SIGKILL')
    await opts.api.mirrorAbort(begin.repoId, begin.uploadId)
    throw err
  } finally {
    if (excludeFile) {
      await fsp.rm(excludeFile, { force: true }).catch(() => {})
    }
  }
}

export async function mirrorDown(
  repoId: number,
  repoRoot: string,
  api: ManagerApi,
  opts: { force: boolean; onProgress?: (bytesReceived: number) => void } = { force: false },
): Promise<void> {
  if (!opts.force && getDirtyPaths(repoRoot).size > 0) {
    throw new MirrorAbort('working tree has uncommitted changes; rerun with --force')
  }

  const staging = `${repoRoot}.ocm-recv-${Date.now()}`
  await fsp.mkdir(staging, { recursive: true })

  try {
    const tarball = await api.mirrorDown(repoId, MIRROR_GZIP)

    const tarArgs = ['-x', '-f', '-', '-C', staging]
    if (MIRROR_GZIP) tarArgs.unshift('-z')
    const child = spawn('tar', tarArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

    const stderrChunks: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    const tarDone = new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve()
        else {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
          reject(new Error(`tar exited with code ${code}${stderr ? `: ${stderr}` : ''}`))
        }
      })
      child.on('error', reject)
    })

    const stdinWritable = Readable.fromWeb(tarball as unknown as Parameters<typeof Readable.fromWeb>[0])
    let received = 0
    stdinWritable.on('data', (chunk: Buffer) => {
      received += chunk.length
      opts.onProgress?.(received)
    })
    stdinWritable.pipe(child.stdin)

    await tarDone

    const backupDir = `${repoRoot}.ocm-backup-${Date.now()}`
    await fsp.mkdir(backupDir, { recursive: true })

    if (existsSync(repoRoot)) {
      const entries = await fsp.readdir(repoRoot)
      for (const entry of entries) {
        await fsp.rename(join(repoRoot, entry), join(backupDir, entry))
      }
    }

    try {
      const stagingEntries = await fsp.readdir(staging)
      for (const entry of stagingEntries) {
        await fsp.rename(join(staging, entry), join(repoRoot, entry))
      }

      await carryOverIgnored(backupDir, repoRoot)

      await fsp.rm(backupDir, { recursive: true, force: true }).catch(() => {})
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
    } catch (swapError) {
      const backupEntries = await fsp.readdir(backupDir).catch(() => [])
      for (const entry of backupEntries) {
        await fsp.rename(join(backupDir, entry), join(repoRoot, entry)).catch(() => {})
      }
      await fsp.rm(backupDir, { recursive: true, force: true }).catch(() => {})
      throw swapError
    }
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function mirrorUpPatch(
  plan: MirrorPlan,
  opts: Pick<MirrorUpOpts, 'api' | 'force'>,
): Promise<{ repoId: number; fullPath: string; branch: string | null; head: string | null; created: false; applied: true }> {
  const repoId = plan.matched[0]!.repoId
  const patch = getMirrorPatch(plan.repoRoot)
  return opts.api.mirrorPatch(repoId, { baseHead: getHeadSha(plan.repoRoot), patch, force: opts.force })
}

function applyPatch(repoRoot: string, patch: string): void {
  if (!patch) return
  const child = spawnSync('git', ['apply', '--binary', '--whitespace=nowarn', '-'], {
    cwd: repoRoot,
    input: patch,
    encoding: 'utf-8',
  })
  if (child.status !== 0) {
    const stderr = (child.stderr ?? '').trim()
    throw new Error(`git apply failed${stderr ? `: ${stderr}` : ''}`)
  }
}

async function createLocalBundle(repoRoot: string): Promise<string> {
  const bundlePath = join(tmpdir(), `ocm-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.bundle`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['bundle', 'create', bundlePath, '--all'], { cwd: repoRoot })
    const stderrChunks: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve()
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
      reject(new Error(`git bundle create failed${stderr ? `: ${stderr}` : ''}`))
    })
  })
  return bundlePath
}

function listWorktreeBranches(repoRoot: string): Map<string, string[]> {
  const out = runGit(repoRoot, ['worktree', 'list', '--porcelain'])
  const ownership = new Map<string, string[]>()
  let currentPath: string | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch ')) {
      if (!currentPath) continue
      const branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      const paths = ownership.get(branch) ?? []
      paths.push(currentPath)
      ownership.set(branch, paths)
    }
  }
  return ownership
}

function listLocalBranches(repoRoot: string): Set<string> {
  const out = runGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))
}

function branchOwnedElsewhere(ownership: Map<string, string[]>, repoRoot: string): Set<string> {
  const locked = new Set<string>()
  for (const [branch, paths] of ownership) {
    if (paths.some((path) => path !== repoRoot)) locked.add(branch)
  }
  return locked
}

function deleteSyncRefs(repoRoot: string): void {
  try {
    const syncRefsOut = runGit(repoRoot, ['for-each-ref', '--format=%(refname)', 'refs/remotes/ocm-sync'])
    const deletes = syncRefsOut.split('\n').map((l) => l.trim()).filter(Boolean).map((ref) => `delete ${ref}\n`)
    if (deletes.length > 0) {
      runGit(repoRoot, ['update-ref', '--stdin'], deletes.join(''))
    }
  } catch {
    return
  }
}

function importLocalBundle(repoRoot: string, bundlePath: string, branch: string | null, force: boolean): void {
  runGit(repoRoot, ['fetch', bundlePath, '+refs/heads/*:refs/remotes/ocm-sync/*', '+refs/tags/*:refs/tags/*'])
  try {
    const refs = runGit(repoRoot, ['for-each-ref', '--format=%(refname:strip=3) %(objectname)', 'refs/remotes/ocm-sync'])
    const incoming = new Map<string, string>()
    for (const line of refs.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const firstSpace = trimmed.indexOf(' ')
      if (firstSpace === -1) continue
      const name = trimmed.slice(0, firstSpace)
      if (name === 'HEAD') continue
      incoming.set(name, trimmed.slice(firstSpace + 1))
    }

    const lockedElsewhere = branchOwnedElsewhere(listWorktreeBranches(repoRoot), repoRoot)

    if (branch) {
      const incomingSha = incoming.get(branch)
      if (!incomingSha) throw new MirrorAbort(`no incoming branch '${branch}' in the server bundle`)
      if (lockedElsewhere.has(branch)) {
        throw new MirrorAbort(`branch '${branch}' is checked out in another worktree; release it there before pulling`)
      }
      const currentBranch = getBranchName(repoRoot)
      if (currentBranch !== branch) {
        const checkoutArgs = force ? ['-f'] : []
        if (listLocalBranches(repoRoot).has(branch)) {
          runGit(repoRoot, ['checkout', ...checkoutArgs, branch])
        } else {
          runGit(repoRoot, ['checkout', ...checkoutArgs, '-b', branch, incomingSha])
        }
      }
    }

    const updates: string[] = []
    for (const [name, sha] of incoming) {
      if (branch === name) continue
      if (lockedElsewhere.has(name)) continue
      updates.push(`update refs/heads/${name} ${sha}\n`)
    }
    if (updates.length > 0) {
      runGit(repoRoot, ['update-ref', '--stdin'], updates.join(''))
    }

    if (branch) {
      const targetSha = incoming.get(branch)!
      runGit(repoRoot, ['reset', '--hard', targetSha])
      runGit(repoRoot, ['clean', '-fd'])
    }
  } finally {
    deleteSyncRefs(repoRoot)
  }
}

async function writeBundleStream(repoId: number, api: ManagerApi): Promise<string> {
  const bundlePath = join(tmpdir(), `ocm-bundle-down-${Date.now()}-${Math.random().toString(36).slice(2)}.bundle`)
  const stream = await api.mirrorDownloadBundle(repoId)
  await pipeline(
    Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(bundlePath),
  )
  return bundlePath
}

export type MirrorUpFastPhase =
  | { kind: 'bundling' }
  | { kind: 'uploading'; bytesSent: number; totalBytes: number }
  | { kind: 'processing' }
  | { kind: 'patching' }

type MirrorUpFastOpts = Pick<MirrorUpOpts, 'api' | 'force'> & {
  requireCurrentBranch?: boolean
  onPhase?: (phase: MirrorUpFastPhase) => void
}

export async function mirrorUpFast(
  plan: MirrorPlan,
  opts: MirrorUpFastOpts,
): Promise<{ repoId: number; fullPath: string; branch: string | null; head: string | null; created: false }> {
  const repoId = plan.matched[0]!.repoId
  const onPhase = opts.onPhase
  onPhase?.({ kind: 'bundling' })
  const bundlePath = await createLocalBundle(plan.repoRoot)
  try {
    const { size } = await fsp.stat(bundlePath)
    onPhase?.({ kind: 'uploading', bytesSent: 0, totalBytes: size })
    await opts.api.mirrorUploadBundle(repoId, bundlePath, {
      branch: getBranchName(plan.repoRoot),
      force: opts.force,
      requireCurrentBranch: opts.requireCurrentBranch,
      onProgress: onPhase
        ? (bytesSent) => {
            onPhase({ kind: 'uploading', bytesSent, totalBytes: size })
            if (bytesSent >= size) onPhase({ kind: 'processing' })
          }
        : undefined,
    })
    onPhase?.({ kind: 'patching' })
    const patchResult = await mirrorUpPatch(plan, opts)
    return { repoId: patchResult.repoId, fullPath: patchResult.fullPath, branch: patchResult.branch, head: patchResult.head, created: false }
  } finally {
    await fsp.rm(bundlePath, { force: true }).catch(() => {})
  }
}

export async function mirrorDownFast(
  repoId: number,
  repoRoot: string,
  api: ManagerApi,
  opts: { force: boolean } = { force: false },
): Promise<void> {
  if (!opts.force && getDirtyPaths(repoRoot).size > 0) {
    throw new MirrorAbort('working tree has uncommitted changes; rerun with --force')
  }

  const snapshot = await api.mirrorPatchSnapshot(repoId)
  const bundlePath = await writeBundleStream(repoId, api)
  try {
    importLocalBundle(repoRoot, bundlePath, snapshot.branch, opts.force)
    applyPatch(repoRoot, snapshot.patch)
  } finally {
    await fsp.rm(bundlePath, { force: true }).catch(() => {})
  }
}

