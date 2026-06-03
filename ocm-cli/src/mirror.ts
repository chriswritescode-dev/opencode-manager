import { spawnSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import * as fsp from 'fs/promises'
import { Readable } from 'stream'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { getRepoRoot, getOriginUrl, getDirtyPaths, urlsEqual } from './local-repo.js'
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
  originUrl: string | null
  branch: string | null
}

export interface MirrorPlan {
  repoRoot: string
  localOrigin: string
  matched: RemoteRepoSummary[]
}

export function prepareMirror(cwd: string, remotes: RemoteRepoSummary[]): MirrorPlan {
  const repoRoot = getRepoRoot(cwd)
  if (!repoRoot) throw new MirrorAbort('not in a git repository')

  const localOrigin = getOriginUrl(repoRoot)
  if (!localOrigin) throw new MirrorAbort('no origin URL found')

  const matched = remotes.filter((r) => urlsEqual(localOrigin, r.originUrl))

  return { repoRoot, localOrigin, matched }
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
