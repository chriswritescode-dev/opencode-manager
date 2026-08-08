import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFilesystemRoutes } from './filesystem'

let tmpRoot: string
let app: Hono
const originalBrowseRoot = process.env.REPO_BROWSE_ROOT

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-fs-route-'))
  process.env.REPO_BROWSE_ROOT = tmpRoot
  app = new Hono()
  app.route('/filesystem', createFilesystemRoutes())
})

afterEach(async () => {
  if (originalBrowseRoot === undefined) {
    delete process.env.REPO_BROWSE_ROOT
  } else {
    process.env.REPO_BROWSE_ROOT = originalBrowseRoot
  }
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('GET /api/filesystem/browse', () => {
  it('returns the directory listing for the root', async () => {
    await fs.mkdir(path.join(tmpRoot, 'projects'))

    const res = await app.request('/filesystem/browse')
    expect(res.status).toBe(200)

    const body = await res.json() as { isRoot: boolean; entries: { name: string }[] }
    expect(body.isRoot).toBe(true)
    expect(body.entries.map((e) => e.name)).toEqual(['projects'])
  })

  it('returns 403 for a path outside the root', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-fs-outside-'))
    try {
      const res = await app.request(`/filesystem/browse?path=${encodeURIComponent(outside)}`)
      expect(res.status).toBe(403)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('returns 404 for a missing directory', async () => {
    const res = await app.request(`/filesystem/browse?path=${encodeURIComponent(path.join(tmpRoot, 'missing'))}`)
    expect(res.status).toBe(404)
  })

  it('returns 501 when browsing is not configured', async () => {
    delete process.env.REPO_BROWSE_ROOT
    const res = await app.request('/filesystem/browse')
    expect(res.status).toBe(501)
  })
})
