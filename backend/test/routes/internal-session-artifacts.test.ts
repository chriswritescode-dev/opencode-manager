import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createInternalTestApp } from '../helpers/internal-test-app'

const SESSION_ID = 'ses_artifact_resolve'

describe('internal/session-artifacts routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let root: string
  let sessionDirectory: string

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ocm-internal-artifacts-'))
    sessionDirectory = path.join(root, 'session')
    mkdirSync(sessionDirectory, { recursive: true })

    db = new Database(':memory:')
    migrate(db, allMigrations)

    const client = {
      api: { session: { get: vi.fn(async () => ({ location: { directory: sessionDirectory } })) } },
    } as unknown as OpenCodeClient

    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { openCodeClient: client }))
    token = getOrCreateInternalToken(db)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function resolve(body: unknown, headers: Record<string, string> = {}) {
    return app.request(`/api/internal/session-artifacts/${SESSION_ID}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 without a bearer token', async () => {
    const res = await app.request(`/api/internal/session-artifacts/${SESSION_ID}/resolve`, { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it('resolves a relative path inside the session directory', async () => {
    const filePath = path.join(sessionDirectory, 'reports', 'report.html')
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, '<h1>Report</h1>')

    const res = await resolve({ path: 'reports/report.html' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ path: filePath })
  })

  it('resolves an absolute path inside the session directory', async () => {
    const filePath = path.join(sessionDirectory, 'report.html')
    writeFileSync(filePath, '<h1>Report</h1>')

    const res = await resolve({ path: filePath })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ path: filePath })
  })

  it('returns 404 when the file does not exist', async () => {
    const res = await resolve({ path: 'missing.html' })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Artifact file not found: missing.html' })
  })

  it('returns 400 when the path escapes the session directory', async () => {
    writeFileSync(path.join(root, 'x.html'), '<h1>Outside</h1>')

    const res = await resolve({ path: '../x.html' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: `Artifact path must be inside the session directory ${sessionDirectory}`,
    })
  })

  it('returns 400 when the file is not an .html file', async () => {
    writeFileSync(path.join(sessionDirectory, 'notes.txt'), 'hello')

    const res = await resolve({ path: 'notes.txt' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Artifact must be an .html file' })
  })

  it('returns 400 when the body is invalid', async () => {
    const res = await resolve({})

    expect(res.status).toBe(400)
  })
})
