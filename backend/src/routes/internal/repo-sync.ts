import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync, readlinkSync, symlinkSync, unlinkSync, chmodSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { resolve, normalize, isAbsolute, sep, join, dirname } from 'path'
import { getRepoById } from '../../db/queries'
import { executeCommand } from '../../utils/process'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import {
  beginPushSession,
  destroyPushSession,
  getPushSession,
  startPushSessionSweep,
  touchPushSession,
  type PushFileStatus,
  type PushManifestEntry,
} from '../../services/push-sessions'

async function gitOut(repoPath: string, args: string[]): Promise<string> {
  return executeCommand(['git', '-C', repoPath, ...args], { silent: true })
}

async function safeGitOut(repoPath: string, args: string[]): Promise<string | null> {
  try {
    return await gitOut(repoPath, args)
  } catch {
    return null
  }
}

interface DiffEntryBase {
  path: string
  status: 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'typechange' | 'unmerged'
}

interface DiffEntryFile extends DiffEntryBase {
  status: 'modified' | 'added' | 'untracked'
  mode: string
  size: number
  symlinkTarget?: string
  oldPath?: string
}

interface DiffEntryDelete extends DiffEntryBase {
  status: 'deleted'
  oldPath?: string
}

interface DiffEntryRename extends DiffEntryBase {
  status: 'renamed'
  oldPath: string
  mode: string
  size: number
  symlinkTarget?: string
}

interface DiffEntryUnmerged extends DiffEntryBase {
  status: 'unmerged' | 'typechange'
}

type DiffEntry = DiffEntryFile | DiffEntryDelete | DiffEntryRename | DiffEntryUnmerged

function isSafeRelativePath(repoPath: string, relPath: string): string | null {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\0')) return null
  const normalized = normalize(relPath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`) || normalized === '..') return null
  if (isAbsolute(normalized)) return null
  const full = resolve(repoPath, normalized)
  const root = resolve(repoPath) + sep
  if (full !== resolve(repoPath) && !full.startsWith(root)) return null
  return full
}

function parsePorcelainV2(raw: string): DiffEntry[] {
  const out: DiffEntry[] = []
  // Records are NUL-terminated. Renamed entries (record types '2') are followed by
  // an extra NUL-terminated path (the original path) — we have to peek at the next field.
  const tokens = raw.split('\0')
  let i = 0
  while (i < tokens.length) {
    const line = tokens[i] ?? ''
    if (!line) {
      i += 1
      continue
    }
    const kind = line[0]
    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const modeWorktree = parts[4] ?? '000000'
      const path = parts.slice(8).join(' ')
      const wt = xy[1]
      if (wt === 'D') {
        out.push({ status: 'deleted', path })
      } else if (wt === 'A') {
        out.push({ status: 'added', path, mode: modeWorktree, size: 0 })
      } else if (wt === 'M' || wt === 'm' || wt === '.') {
        out.push({ status: 'modified', path, mode: modeWorktree, size: 0 })
      } else if (wt === 'T') {
        out.push({ status: 'typechange', path })
      } else if (wt === 'U' || xy.includes('U')) {
        out.push({ status: 'unmerged', path })
      } else {
        // staged-only change, no working-tree edit: skip
      }
      i += 1
    } else if (kind === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>
      // followed by NUL <origPath>
      const parts = line.split(' ')
      const modeWorktree = parts[4] ?? '000000'
      const path = parts.slice(9).join(' ')
      const oldPath = tokens[i + 1] ?? ''
      out.push({ status: 'renamed', path, oldPath, mode: modeWorktree, size: 0 })
      i += 2
    } else if (kind === '?') {
      // ? <path>
      const path = line.slice(2)
      out.push({ status: 'untracked', path, mode: '100644', size: 0 })
      i += 1
    } else if (kind === 'u') {
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      out.push({ status: 'unmerged', path })
      i += 1
    } else {
      i += 1
    }
  }
  return out
}

async function enrichEntries(repoPath: string, entries: DiffEntry[]): Promise<DiffEntry[]> {
  for (const entry of entries) {
    if (entry.status === 'modified' || entry.status === 'added' || entry.status === 'untracked' || entry.status === 'renamed') {
      const full = isSafeRelativePath(repoPath, entry.path)
      if (!full) continue
      try {
        const st = statSync(full, { throwIfNoEntry: false })
        if (!st) continue
        if (st.isSymbolicLink()) {
          ;(entry as DiffEntryFile | DiffEntryRename).symlinkTarget = readlinkSync(full)
          ;(entry as DiffEntryFile | DiffEntryRename).size = 0
        } else if (st.isFile()) {
          ;(entry as DiffEntryFile | DiffEntryRename).size = st.size
        }
      } catch {
        // file moved/removed between scan and stat — leave size 0
      }
    }
  }
  return entries
}

export function createInternalRepoSyncRoutes(db: Database) {
  const app = new Hono()

  app.get('/:repoId/git-info', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (repo.cloneStatus !== 'ready') return c.json({ error: 'repo not ready' }, 409)
    const repoPath = repo.fullPath
    try {
      const [originUrl, head, branch, status] = await Promise.all([
        safeGitOut(repoPath, ['remote', 'get-url', 'origin']),
        safeGitOut(repoPath, ['rev-parse', 'HEAD']),
        safeGitOut(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        safeGitOut(repoPath, ['status', '--porcelain']),
      ])
      return c.json({
        repoId,
        repoName: repo.repoUrl?.split('/').slice(-1)[0]?.replace('.git', '') ?? null,
        directory: repoPath,
        originUrl: originUrl?.trim() || null,
        head: head?.trim() || null,
        branch: branch?.trim() || null,
        dirty: Boolean(status && status.trim().length > 0),
      })
    } catch (error) {
      logger.error('git-info failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.get('/:repoId/working-tree-diff', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (repo.cloneStatus !== 'ready') return c.json({ error: 'repo not ready' }, 409)
    const repoPath = repo.fullPath
    try {
      const [headOut, statusOut] = await Promise.all([
        safeGitOut(repoPath, ['rev-parse', 'HEAD']),
        gitOut(repoPath, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no']),
      ])
      const entries = await enrichEntries(repoPath, parsePorcelainV2(statusOut))
      return c.json({
        repoId,
        head: headOut?.trim() || null,
        files: entries,
      })
    } catch (error) {
      logger.error('working-tree-diff failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  startPushSessionSweep()

  app.post('/:repoId/push/begin', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (repo.cloneStatus !== 'ready') return c.json({ error: 'repo not ready' }, 409)
    const repoPath = repo.fullPath

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    const expectedHead = (body as { expectedHead?: string | null })?.expectedHead ?? null
    const force = Boolean((body as { force?: boolean })?.force)
    const manifestRaw = (body as { manifest?: unknown })?.manifest
    if (!Array.isArray(manifestRaw)) return c.json({ error: 'manifest must be an array' }, 400)

    const manifest: PushManifestEntry[] = []
    const validStatuses: Record<string, PushFileStatus> = {
      modified: 'modified',
      added: 'added',
      untracked: 'untracked',
      deleted: 'deleted',
      renamed: 'renamed',
    }
    for (const raw of manifestRaw) {
      if (!raw || typeof raw !== 'object') return c.json({ error: 'manifest entry must be an object' }, 400)
      const entry = raw as Record<string, unknown>
      const path = entry.path
      const statusRaw = entry.status
      if (typeof path !== 'string' || !path) return c.json({ error: 'manifest entry missing path' }, 400)
      if (typeof statusRaw !== 'string' || !(statusRaw in validStatuses)) {
        return c.json({ error: `invalid status: ${String(statusRaw)}` }, 400)
      }
      const status = validStatuses[statusRaw]!
      if (!isSafeRelativePath(repoPath, path)) return c.json({ error: `invalid path: ${path}` }, 400)
      const oldPath = typeof entry.oldPath === 'string' ? entry.oldPath : undefined
      if (oldPath && !isSafeRelativePath(repoPath, oldPath)) return c.json({ error: `invalid oldPath: ${oldPath}` }, 400)
      manifest.push({
        path,
        status,
        mode: typeof entry.mode === 'string' ? entry.mode : undefined,
        size: typeof entry.size === 'number' ? entry.size : undefined,
        symlinkTarget: typeof entry.symlinkTarget === 'string' ? entry.symlinkTarget : undefined,
        oldPath,
      })
    }

    try {
      const remoteHead = (await safeGitOut(repoPath, ['rev-parse', 'HEAD']))?.trim() ?? null
      if (!force && expectedHead && remoteHead && expectedHead !== remoteHead) {
        return c.json({
          error: 'head_mismatch',
          message: `manager HEAD ${remoteHead} differs from client HEAD ${expectedHead}`,
          remoteHead,
        }, 409)
      }

      const dirtyOut = (await safeGitOut(repoPath, ['status', '--porcelain', '-z', '--untracked-files=all']))?.trim() ?? ''
      const remoteDirty = new Set<string>()
      if (dirtyOut) {
        for (const record of dirtyOut.split('\0')) {
          if (!record) continue
          const p = record.slice(3)
          if (p) remoteDirty.add(p)
        }
      }

      const targetPaths = new Set<string>()
      for (const entry of manifest) {
        targetPaths.add(entry.path)
        if (entry.oldPath) targetPaths.add(entry.oldPath)
      }
      const conflicts: string[] = []
      for (const p of remoteDirty) if (targetPaths.has(p)) conflicts.push(p)

      if (!force && conflicts.length > 0) {
        return c.json({
          error: 'remote_dirty_conflict',
          message: 'manager working tree has uncommitted changes that overlap with this push',
          conflicts,
        }, 409)
      }

      const session = beginPushSession({
        repoId,
        repoPath,
        manifest,
        expectedHead,
      })

      const filesNeeded = manifest
        .filter((e) => e.status !== 'deleted' && !e.symlinkTarget)
        .map((e) => e.path)

      return c.json({
        token: session.token,
        repoId,
        remoteHead,
        expiresAt: session.expiresAt,
        filesNeeded,
      })
    } catch (error) {
      logger.error('push/begin failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.put('/push/:token/file', async (c) => {
    const token = c.req.param('token')
    const session = getPushSession(token)
    if (!session) return c.json({ error: 'invalid or expired token' }, 404)

    const relPath = c.req.query('path') ?? ''
    const entry = session.manifest.find((e) => e.path === relPath)
    if (!entry) return c.json({ error: 'path not in manifest' }, 400)
    if (entry.status === 'deleted') return c.json({ error: 'deleted paths have no content' }, 400)
    if (entry.symlinkTarget) return c.json({ error: 'symlinks are applied from manifest, not uploaded' }, 400)

    const stagingPath = join(session.stagingDir, entry.path)
    if (!isSafeRelativePath(session.stagingDir, entry.path)) {
      return c.json({ error: 'invalid staging path' }, 400)
    }
    mkdirSync(dirname(stagingPath), { recursive: true })

    if (!c.req.raw.body) return c.json({ error: 'missing body' }, 400)
    try {
      const nodeStream = Readable.fromWeb(c.req.raw.body as unknown as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(nodeStream, createWriteStream(stagingPath))
      session.uploaded.add(entry.path)
      touchPushSession(token)
      return c.json({ ok: true, uploaded: session.uploaded.size, total: session.manifest.length })
    } catch (error) {
      logger.error('push/file failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/push/:token/commit', async (c) => {
    const token = c.req.param('token')
    const session = getPushSession(token)
    if (!session) return c.json({ error: 'invalid or expired token' }, 404)

    const missing = session.manifest
      .filter((e) => e.status !== 'deleted' && !e.symlinkTarget && !session.uploaded.has(e.path))
      .map((e) => e.path)
    if (missing.length > 0) {
      return c.json({ error: 'missing_files', message: 'not all files were uploaded', missing }, 400)
    }

    const applied: string[] = []
    try {
      for (const entry of session.manifest) {
        if (entry.status === 'deleted') continue
        if (entry.symlinkTarget) {
          const dest = isSafeRelativePath(session.repoPath, entry.path)
          if (!dest) throw new Error(`invalid path: ${entry.path}`)
          mkdirSync(dirname(dest), { recursive: true })
          try { unlinkSync(dest) } catch { /* ok */ }
          symlinkSync(entry.symlinkTarget, dest)
          applied.push(entry.path)
          continue
        }
        const stagingPath = join(session.stagingDir, entry.path)
        const dest = isSafeRelativePath(session.repoPath, entry.path)
        if (!dest) throw new Error(`invalid path: ${entry.path}`)
        mkdirSync(dirname(dest), { recursive: true })
        renameSync(stagingPath, dest)
        if (entry.mode && entry.mode.length >= 6) {
          const numericMode = parseInt(entry.mode.slice(-3), 8)
          if (!Number.isNaN(numericMode)) chmodSync(dest, numericMode)
        }
        applied.push(entry.path)
      }

      for (const entry of session.manifest) {
        if (entry.status === 'renamed' && entry.oldPath) {
          const oldDest = isSafeRelativePath(session.repoPath, entry.oldPath)
          if (oldDest) {
            try { unlinkSync(oldDest) } catch { /* may not exist */ }
          }
        }
        if (entry.status === 'deleted') {
          const dest = isSafeRelativePath(session.repoPath, entry.path)
          if (dest) {
            try {
              const st = statSync(dest)
              if (st.isDirectory()) {
                rmSync(dest, { recursive: true, force: true })
              } else {
                unlinkSync(dest)
              }
            } catch { /* already gone */ }
            applied.push(entry.path)
          }
        }
      }

      destroyPushSession(token)
      return c.json({ ok: true, applied: applied.length })
    } catch (error) {
      logger.error('push/commit failed:', error)
      destroyPushSession(token)
      return c.json({ error: getErrorMessage(error), applied }, 500)
    }
  })

  app.post('/push/:token/cancel', (c) => {
    const token = c.req.param('token')
    const session = getPushSession(token)
    if (!session) return c.json({ ok: true, alreadyClosed: true })
    destroyPushSession(token)
    return c.json({ ok: true })
  })

  app.get('/:repoId/working-tree-file', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (repo.cloneStatus !== 'ready') return c.json({ error: 'repo not ready' }, 409)
    const repoPath = repo.fullPath

    const relPath = c.req.query('path') ?? ''
    const full = isSafeRelativePath(repoPath, relPath)
    if (!full) return c.json({ error: 'invalid path' }, 400)

    let stat
    try {
      stat = statSync(full, { throwIfNoEntry: false })
    } catch {
      stat = undefined
    }
    if (!stat) return c.json({ error: 'file not found' }, 404)
    if (stat.isSymbolicLink()) {
      // refuse — symlinks are surfaced via the manifest target
      return c.json({ error: 'symlink served via manifest only' }, 400)
    }
    if (!stat.isFile()) return c.json({ error: 'not a regular file' }, 400)

    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
      },
    })
  })

  return app
}
