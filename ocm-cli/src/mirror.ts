import { spawnSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import * as fsp from 'fs/promises'
import { Readable } from 'stream'
import { join } from 'path'
import { tmpdir } from 'os'
import { getRepoRoot, getOriginUrl, getDirtyPaths, urlsEqual } from './local-repo.js'
import type { ManagerApi } from './manager-api.js'

const HARDCODED_EXCLUDES = ['node_modules', 'dist', '.next', '.venv', '__pycache__', '.turbo']

function getGitignoreExclusions(repoRoot: string): string[] {
  const res = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  })
  if (res.status !== 0) return []
  return (res.stdout ?? '').split('\n').filter((line) => line.length > 0)
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

export interface MirrorUpOpts {
  api: ManagerApi
  force: boolean
  create?: { name: string; originUrl: string | null; branch: string | null }
}

export async function mirrorUp(
  plan: MirrorPlan,
  opts: MirrorUpOpts,
): Promise<{ repoId: number; branch: string; head: string; created: boolean }> {
  const tarArgs = ['-c', '-C', plan.repoRoot]
  for (const dir of HARDCODED_EXCLUDES) tarArgs.push('--exclude', dir)

  const ignoredPaths = getGitignoreExclusions(plan.repoRoot)
  let excludeFile: string | null = null

  if (ignoredPaths.length > 0) {
    excludeFile = join(tmpdir(), `ocm-exclude-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
    await fsp.writeFile(excludeFile, ignoredPaths.join('\n'))
    tarArgs.push('--exclude-from', excludeFile)
  }

  tarArgs.push('.')

  const child = spawn('tar', tarArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

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

  const body = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  const repoId = opts.create ? 0 : plan.matched[0]!.repoId

  try {
    const [result] = await Promise.all([
      opts.api.mirrorUp(repoId, body, {
        force: opts.force,
        create: opts.create,
      }),
      tarExit,
    ])
    return result
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
  opts: { force: boolean } = { force: false },
): Promise<void> {
  if (!opts.force && getDirtyPaths(repoRoot).size > 0) {
    throw new MirrorAbort('working tree has uncommitted changes; rerun with --force')
  }

  const staging = `${repoRoot}.ocm-recv-${Date.now()}`
  await fsp.mkdir(staging, { recursive: true })

  try {
    const tarball = await api.mirrorDown(repoId)

    const child = spawn('tar', ['-x', '-f', '-', '-C', staging], { stdio: ['pipe', 'pipe', 'pipe'] })

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
