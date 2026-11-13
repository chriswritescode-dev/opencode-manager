import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createStubOpenCodeClient, sessionInfo } from '../helpers/stub-opencode-client'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const SESSION_ID = 'ses_artifact_resolve'

const ArtifactPathSchema = z.object({ path: z.string() })
const ErrorResponseSchema = z.object({ error: z.string() })

describe('internal/session-artifacts routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let app: Hono
  let token: string
  let root: string
  let sessionDirectory: string
  let getSession: ReturnType<typeof vi.fn<OpenCodeApi['session']['get']>>

  function resolve(body: { path?: string }) {
    return app.request(`/api/internal/session-artifacts/${SESSION_ID}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function appWithSessionDirectory(directory: string): Hono {
    getSession.mockImplementation(async () => sessionInfo({
      id: SESSION_ID,
      location: { directory },
    }))
    return app
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ocm-internal-artifacts-'))
    sessionDirectory = path.join(root, 'session')
    mkdirSync(sessionDirectory, { recursive: true })

    db = createTestDatabase()
    getSession = vi.fn<OpenCodeApi['session']['get']>(async () => sessionInfo({
      id: SESSION_ID,
      location: { directory: sessionDirectory },
    }))
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, {
      openCodeClient: createStubOpenCodeClient({ api: { session: { get: getSession } } }),
    }))
    token = getOrCreateInternalToken(db)
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('returns 401 without a bearer token', async () => {
    const res = await app.request(`/api/internal/session-artifacts/${SESSION_ID}/resolve`, { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it('resolves a relative path inside the session directory', async () => {
    const filePath = path.join(sessionDirectory, 'reports', 'report.html')
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, '<h1>Report</h1>')

    const res = await resolve({ path: 'reports/report.html' })
    const body = await readJson(res, ArtifactPathSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ path: filePath })
  })

  it('resolves an absolute path inside the session directory', async () => {
    const filePath = path.join(sessionDirectory, 'report.html')
    writeFileSync(filePath, '<h1>Report</h1>')

    const res = await resolve({ path: filePath })
    const body = await readJson(res, ArtifactPathSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ path: filePath })
  })

  it('keeps the symlinked session directory prefix in the returned path', async () => {
    const realRoot = path.join(root, 'real')
    const realSessionDirectory = path.join(realRoot, 'session')
    mkdirSync(realSessionDirectory, { recursive: true })
    writeFileSync(path.join(realSessionDirectory, 'report.html'), '<h1>Report</h1>')
    const linkedRoot = path.join(root, 'linked')
    symlinkSync(realRoot, linkedRoot, 'dir')
    const linkedSessionDirectory = path.join(linkedRoot, 'session')
    appWithSessionDirectory(linkedSessionDirectory)

    const res = await resolve({ path: 'report.html' })
    const body = await readJson(res, ArtifactPathSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ path: path.join(linkedSessionDirectory, 'report.html') })
  })

  it('rejects a symlink that escapes the session directory', async () => {
    const outside = path.join(root, 'outside.html')
    writeFileSync(outside, '<h1>Outside</h1>')
    symlinkSync(outside, path.join(sessionDirectory, 'link.html'))

    const res = await resolve({ path: 'link.html' })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      error: `Artifact path must be inside the session directory ${sessionDirectory}`,
    })
  })

  it('returns 404 when the file does not exist', async () => {
    const res = await resolve({ path: 'missing.html' })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(404)
    expect(body).toEqual({ error: 'Artifact file not found: missing.html' })
  })

  it('returns 400 when the path escapes the session directory', async () => {
    writeFileSync(path.join(root, 'x.html'), '<h1>Outside</h1>')

    const res = await resolve({ path: '../x.html' })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      error: `Artifact path must be inside the session directory ${sessionDirectory}`,
    })
  })

  it('returns 400 when the file is not an .html file', async () => {
    writeFileSync(path.join(sessionDirectory, 'notes.txt'), 'hello')

    const res = await resolve({ path: 'notes.txt' })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'Artifact must be an .html file' })
  })

  it('returns 400 when the body is invalid', async () => {
    const res = await resolve({})

    expect(res.status).toBe(400)
  })
})
