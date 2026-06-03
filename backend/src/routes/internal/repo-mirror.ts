import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import * as fsp from 'fs/promises'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { getRepoById, updateLastPulled, updateRepoBranch, deleteRepo } from '../../db/queries'
import { ensureMirrorTargetPath, createRepoRow, isRepoInUse } from '../../services/repo'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { safeGitOut, gitOut } from './repo-sync-helpers'
import {
  MIRROR_CHUNK_SIZE,
  createUploadSession,
  readUploadMeta,
  deleteUploadSession,
  getPartPath,
  extractPartsToStaging,
  atomicSwapIntoPlace,
  carryOverIgnoredFiles,
  discardBackup,
  restoreBackup,
} from './repo-mirror-helpers'

const HARDCODED_EXCLUDES = ['node_modules', 'dist', '.next', '.venv', '__pycache__', '.turbo']

interface BeginBody {
  create?: boolean
  name?: string
  originUrl?: string
  branch?: string
  force?: boolean
}

interface CommitBody {
  uploadId: string
  totalParts: number
  gzip?: boolean
}

const LEGACY_UPGRADE_MESSAGE = 'this ocm CLI is too old for this server; upgrade to ocm-cli >= 0.1.2 (the mirror upload protocol changed to chunked uploads)'

export function createInternalRepoMirrorRoutes(db: Database) {
  const app = new Hono()

  app.post('/:repoId/mirror', (c) => {
    return c.json({ error: 'cli_too_old', message: LEGACY_UPGRADE_MESSAGE }, 410)
  })

  app.post('/:repoId/mirror/begin', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    let body: BeginBody
    try {
      body = (await c.req.json()) as BeginBody
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }

    const force = body.force === true
    const create = body.create === true

    let repoId: number
    let fullPath: string
    let created = false
    let createdRepoId: number | undefined

    if (repoIdRaw === '0' && create) {
      if (!body.name) return c.json({ error: 'name required', message: 'provide name in body' }, 400)
      const target = ensureMirrorTargetPath(body.name)
      const { repo: newRepo, created: wasCreated } = createRepoRow(db, {
        name: body.name,
        originUrl: body.originUrl,
        localPath: target.localPath,
        fullPath: target.fullPath,
        branch: body.branch,
      })
      repoId = newRepo.id
      fullPath = newRepo.fullPath
      created = wasCreated
      createdRepoId = wasCreated ? newRepo.id : undefined

      if (!wasCreated && !force && isRepoInUse(db, repoId)) {
        return c.json({ error: 'repo_in_use', message: 'open OpenCode sessions are using this repo; rerun with force=1' }, 409)
      }
    } else {
      const repoIdNum = Number(repoIdRaw)
      if (!Number.isFinite(repoIdNum)) return c.json({ error: 'invalid repoId' }, 400)
      const repo = getRepoById(db, repoIdNum)
      if (!repo) return c.json({ error: 'repo not found' }, 404)
      repoId = repo.id
      fullPath = repo.fullPath

      if (!force && isRepoInUse(db, repoId)) {
        return c.json({ error: 'repo_in_use', message: 'open OpenCode sessions are using this repo; rerun with force=1' }, 409)
      }
    }

    try {
      const meta = await createUploadSession({ repoId, fullPath, created, createdRepoId, force })
      return c.json({ uploadId: meta.uploadId, repoId, chunkSize: MIRROR_CHUNK_SIZE, created })
    } catch (error) {
      logger.error('mirror begin failed:', error)
      if (createdRepoId !== undefined) {
        try { deleteRepo(db, createdRepoId) } catch { /* ignore */ }
      }
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.put('/:repoId/mirror/parts/:uploadId/:index', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const uploadId = c.req.param('uploadId')
    const indexRaw = c.req.param('index')
    const index = Number(indexRaw)
    if (!Number.isFinite(index) || index < 0 || !Number.isInteger(index)) {
      return c.json({ error: 'invalid index' }, 400)
    }

    const meta = await readUploadMeta(uploadId)
    if (!meta) return c.json({ error: 'upload session not found' }, 404)

    const repoIdNum = Number(repoIdRaw)
    if (!Number.isFinite(repoIdNum) || repoIdNum !== meta.repoId) {
      if (!(repoIdRaw === '0' && meta.created)) {
        return c.json({ error: 'upload session does not belong to repo' }, 403)
      }
    }

    const rawBody = c.req.raw.body
    if (!rawBody) return c.json({ error: 'no body provided' }, 400)

    const partPath = getPartPath(uploadId, index)
    try {
      const body = Readable.fromWeb(rawBody as unknown as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(body, createWriteStream(partPath))
      const stat = await fsp.stat(partPath)
      return c.json({ index, size: stat.size })
    } catch (error) {
      logger.error(`mirror part ${index} upload failed:`, error)
      await fsp.rm(partPath, { force: true }).catch(() => {})
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:repoId/mirror/commit', async (c) => {
    let body: CommitBody
    try {
      body = (await c.req.json()) as CommitBody
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }

    const { uploadId, totalParts, gzip } = body
    if (!uploadId) return c.json({ error: 'uploadId required' }, 400)
    if (!Number.isInteger(totalParts) || totalParts < 0) return c.json({ error: 'totalParts must be a non-negative integer' }, 400)

    const meta = await readUploadMeta(uploadId)
    if (!meta) return c.json({ error: 'upload session not found' }, 404)

    let backupDir: string | undefined
    let staging: string | undefined
    try {
      const extracted = await extractPartsToStaging(uploadId, totalParts, gzip === true)
      staging = extracted.staging

      const swap = await atomicSwapIntoPlace(extracted.extractedRoot, meta.fullPath)
      backupDir = swap.backupDir

      const branchName = await safeGitOut(meta.fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const head = await safeGitOut(meta.fullPath, ['rev-parse', 'HEAD'])

      if (branchName) updateRepoBranch(db, meta.repoId, branchName.trim())
      updateLastPulled(db, meta.repoId)

      await carryOverIgnoredFiles(backupDir, meta.fullPath)
      await discardBackup(backupDir)
      backupDir = undefined
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
      staging = undefined
      await deleteUploadSession(uploadId)

      return c.json({
        repoId: meta.repoId,
        fullPath: meta.fullPath,
        branch: branchName?.trim() || null,
        head: head?.trim() || null,
        created: meta.created,
      })
    } catch (error) {
      logger.error('mirror commit failed:', error)
      await restoreBackup(meta.fullPath, backupDir)
      if (meta.createdRepoId !== undefined) {
        try { deleteRepo(db, meta.createdRepoId) } catch { /* ignore */ }
      }
      if (staging) {
        await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
      }
      await deleteUploadSession(uploadId)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.delete('/:repoId/mirror/uploads/:uploadId', async (c) => {
    const uploadId = c.req.param('uploadId')
    const meta = await readUploadMeta(uploadId)
    if (meta?.createdRepoId !== undefined) {
      try { deleteRepo(db, meta.createdRepoId) } catch { /* ignore */ }
    }
    await deleteUploadSession(uploadId)
    return c.json({ ok: true })
  })

  app.get('/:repoId/mirror', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    const compress = c.req.query('compress') === 'gzip'
    const fullPath = repo.fullPath

    const excludeArgs: string[] = []
    for (const dir of HARDCODED_EXCLUDES) {
      excludeArgs.push('--exclude', dir)
    }

    let ignoreFile: string | undefined
    try {
      const ignored = await gitOut(fullPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])
      if (ignored.trim()) {
        const excludeParent = join(getReposPath(), '.ocm-staging')
        mkdirSync(excludeParent, { recursive: true })
        ignoreFile = mkdtempSync(join(excludeParent, 'exclude-'))
        writeFileSync(join(ignoreFile, '.gitignore'), ignored)
        excludeArgs.push('--exclude-from', join(ignoreFile, '.gitignore'))
      }
    } catch { /* ignore git ls-files errors */ }

    const tarArgs = ['-c', '-C', fullPath, ...excludeArgs, '.']
    if (compress) {
      tarArgs.unshift('-z')
    }

    const child = spawn('tar', tarArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

    const stream = new ReadableStream({
      start(controller) {
        child.stdout.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        child.stdout.on('end', () => {
          controller.close()
          if (ignoreFile) {
            fsp.rm(ignoreFile, { recursive: true, force: true }).catch(() => {})
          }
        })
        child.stdout.on('error', (err: Error) => {
          controller.error(err)
          if (ignoreFile) {
            fsp.rm(ignoreFile, { recursive: true, force: true }).catch(() => {})
          }
        })
      },
    })

    child.on('close', () => {})
    child.on('error', () => {})

    return new Response(stream, {
      headers: {
        ...(compress ? { 'Content-Type': 'application/gzip' } : { 'Content-Type': 'application/x-tar' }),
      },
    })
  })

  return app
}
