import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { mkdtempSync, mkdirSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as fsp from 'fs/promises'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { getRepoById, updateLastPulled, updateRepoBranch, deleteRepo } from '../../db/queries'
import { ensureMirrorTargetPath, createRepoRow, isRepoInUse } from '../../services/repo'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { safeGitOut, gitOut } from './repo-sync-helpers'

const HARDCODED_EXCLUDES = ['node_modules', 'dist', '.next', '.venv', '__pycache__', '.turbo']

export function createInternalRepoMirrorRoutes(db: Database) {
  const app = new Hono()

  app.post('/:repoId/mirror', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const force = c.req.query('force') === '1'
    const create = c.req.query('create') === '1'
    const name = c.req.query('name')
    const originUrl = c.req.query('originUrl')
    const branch = c.req.query('branch')

    const rawBody = c.req.raw.body
    if (!rawBody) return c.json({ error: 'no body provided' }, 400)

    let repoId: number
    let fullPath: string
    let created = false
    let createdRepoId: number | undefined

    if (repoIdRaw === '0' && create) {
      if (!name) return c.json({ error: 'name required', message: 'provide a name query param' }, 400)
      const target = ensureMirrorTargetPath(name)
      const { repo: newRepo, created: wasCreated } = createRepoRow(db, { name, originUrl, localPath: target.localPath, fullPath: target.fullPath, branch })
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

    let staging: string | undefined
    let oldDirMoved = false
    try {
      const stagingParent = join(getReposPath(), '.ocm-staging')
      mkdirSync(stagingParent, { recursive: true })
      staging = mkdtempSync(join(stagingParent, 'recv-'))

      const isGzip = c.req.header('Content-Encoding') === 'gzip'
      const tarArgs = ['-x', '-f', '-', '-C', staging]
      if (isGzip) tarArgs.unshift('-z')
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

      const body = Readable.fromWeb(rawBody as unknown as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(body, child.stdin)
      await tarDone

      const entries = readdirSync(staging)
      let extractedRoot = staging
      if (entries.length === 1) {
        const candidate = join(staging, entries[0]!)
        try {
          if (statSync(candidate).isDirectory()) {
            extractedRoot = candidate
          }
        } catch { /* ignore stat errors */ }
      }

      if (existsSync(fullPath)) {
        try {
          await fsp.rename(fullPath, fullPath + '.ocm-old')
          oldDirMoved = true
        } catch { /* ignore rename errors */ }
      }

      await fsp.rename(extractedRoot, fullPath)

      const oldDir = fullPath + '.ocm-old'
      await fsp.rm(oldDir, { recursive: true, force: true }).catch(() => {})

      const branchName = await safeGitOut(fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const head = await safeGitOut(fullPath, ['rev-parse', 'HEAD'])

      if (branchName) {
        updateRepoBranch(db, repoId, branchName.trim())
      }
      updateLastPulled(db, repoId)

      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})

      return c.json({
        repoId,
        fullPath,
        branch: branchName?.trim() || null,
        head: head?.trim() || null,
        created,
      })
    } catch (error) {
      logger.error('mirror POST failed:', error)

      if (oldDirMoved) {
        try {
          await fsp.rename(fullPath + '.ocm-old', fullPath)
        } catch {
          logger.error('failed to restore old repo from .ocm-old')
        }
      }

      if (createdRepoId !== undefined) {
        try {
          deleteRepo(db, createdRepoId)
        } catch {
          logger.error('failed to delete created repo row on failure')
        }
      }

      if (staging) {
        await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
      }
      return c.json({ error: getErrorMessage(error) }, 500)
    }
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
        'Content-Type': 'application/x-tar',
        ...(compress ? { 'Content-Encoding': 'gzip' } : {}),
      },
    })
  })

  return app
}
