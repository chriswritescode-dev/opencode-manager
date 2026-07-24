import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'fs'
import * as fsp from 'fs/promises'
import { createReadStream } from 'fs'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'
import { randomUUID } from 'crypto'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { mkdirSafe, mkdirSyncSafe } from '../../utils/fs-safe'

export const MIRROR_CHUNK_SIZE = 8 * 1024 * 1024
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000

export const TOTAL_PARTS_INVALID_MESSAGE = 'totalParts must be a positive integer'

export function isValidTotalParts(totalParts: number): boolean {
  return Number.isInteger(totalParts) && totalParts >= 1
}

export interface UploadMeta {
  uploadId: string
  repoId: number
  fullPath: string
  created: boolean
  createdRepoId?: number
  force: boolean
  startedAt: number
}

export function getStagingRoot(): string {
  return join(getReposPath(), '.ocm-staging')
}

export function getUploadsRoot(): string {
  return join(getStagingRoot(), 'uploads')
}

export function getUploadDir(uploadId: string): string {
  return join(getUploadsRoot(), uploadId)
}

export function getPartsDir(uploadId: string): string {
  return join(getUploadDir(uploadId), 'parts')
}

export function getMetaPath(uploadId: string): string {
  return join(getUploadDir(uploadId), 'meta.json')
}

export function getPartPath(uploadId: string, index: number): string {
  return join(getPartsDir(uploadId), `${index}.bin`)
}

export async function createUploadSession(meta: Omit<UploadMeta, 'uploadId' | 'startedAt'>): Promise<UploadMeta> {
  const uploadId = randomUUID()
  mkdirSyncSafe(getPartsDir(uploadId))
  const full: UploadMeta = { ...meta, uploadId, startedAt: Date.now() }
  await fsp.writeFile(getMetaPath(uploadId), JSON.stringify(full), 'utf-8')
  return full
}

export async function readUploadMeta(uploadId: string): Promise<UploadMeta | null> {
  try {
    const raw = await fsp.readFile(getMetaPath(uploadId), 'utf-8')
    return JSON.parse(raw) as UploadMeta
  } catch {
    return null
  }
}

export async function deleteUploadSession(uploadId: string): Promise<void> {
  await fsp.rm(getUploadDir(uploadId), { recursive: true, force: true }).catch(() => {})
}

export async function sweepStaleUploadSessions(now = Date.now(), ttlMs = STALE_UPLOAD_MS): Promise<void> {
  const root = getUploadsRoot()
  if (!existsSync(root)) return
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const id of entries) {
    const meta = await readUploadMeta(id)
    if (!meta || now - meta.startedAt > ttlMs) {
      await deleteUploadSession(id)
    }
  }
}

export interface ExtractResult {
  extractedRoot: string
  staging: string
}

export async function extractPartsToStaging(uploadId: string, totalParts: number, gzip: boolean): Promise<ExtractResult> {
  if (!isValidTotalParts(totalParts)) {
    throw new Error(TOTAL_PARTS_INVALID_MESSAGE)
  }

  const stagingParent = getStagingRoot()
  mkdirSyncSafe(stagingParent)
  const staging = mkdtempSync(join(stagingParent, 'recv-'))

  const tarArgs = ['-x', '-f', '-', '-C', staging]
  if (gzip) tarArgs.unshift('-z')
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

  try {
    for (let i = 0; i < totalParts; i++) {
      const partPath = getPartPath(uploadId, i)
      if (!existsSync(partPath)) {
        throw new Error(`missing part ${i} for upload ${uploadId}`)
      }
      await pipeline(createReadStream(partPath), child.stdin, { end: i === totalParts - 1 })
    }
    await tarDone
  } catch (err) {
    if (!child.killed) child.kill('SIGKILL')
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw err
  }

  let extractedRoot = staging
  const entries = readdirSync(staging)
  if (entries.length === 1) {
    const candidate = join(staging, entries[0]!)
    try {
      if (statSync(candidate).isDirectory()) {
        extractedRoot = candidate
      }
    } catch { /* ignore */ }
  }

  return { extractedRoot, staging }
}

export interface SwapResult {
  backupDir?: string
}

export async function atomicSwapIntoPlace(extractedRoot: string, fullPath: string): Promise<SwapResult> {
  await mkdirSafe(dirname(fullPath))

  let backupDir: string | undefined
  if (existsSync(fullPath)) {
    backupDir = `${fullPath}.ocm-old-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await fsp.rename(fullPath, backupDir)
  }

  try {
    await fsp.rename(extractedRoot, fullPath)
  } catch (err) {
    if (backupDir) {
      await fsp.rename(backupDir, fullPath).catch(() => {})
    }
    throw err
  }

  return { backupDir }
}

function listIgnoredPaths(dir: string): string[] {
  const res = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], {
    cwd: dir,
    encoding: 'utf-8',
  })
  if (res.status !== 0) return []
  return (res.stdout ?? '').split('\n').filter((line) => line.length > 0)
}

export async function carryOverIgnoredFiles(backupDir: string | undefined, fullPath: string): Promise<void> {
  if (!backupDir || !existsSync(backupDir)) return
  for (const rel of listIgnoredPaths(backupDir)) {
    const clean = rel.replace(/\/+$/, '')
    if (!clean) continue
    const src = join(backupDir, clean)
    const dest = join(fullPath, clean)
    if (!existsSync(src) || existsSync(dest)) continue
    await mkdirSafe(dirname(dest))
    await fsp.rename(src, dest).catch(() => {})
  }
}

export async function discardBackup(backupDir: string | undefined): Promise<void> {
  if (!backupDir) return
  await fsp.rm(backupDir, { recursive: true, force: true }).catch(() => {})
}

export async function restoreBackup(fullPath: string, backupDir: string | undefined): Promise<void> {
  if (!backupDir) return
  if (existsSync(fullPath)) {
    await fsp.rm(fullPath, { recursive: true, force: true }).catch(() => {})
  }
  await fsp.rename(backupDir, fullPath).catch(() => {})
}
