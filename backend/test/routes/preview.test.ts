import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENV } from '@opencode-manager/shared/config/env'
import {
  CreatePreviewSessionResponseSchema,
  PreviewPortsResponseSchema,
} from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import { createPreviewRoutes, createPreviewAvailability } from '../../src/routes/preview'
import { PreviewSessionStore } from '../../src/services/preview/gateway'
import type { PreviewPortEntry } from '../../src/services/preview/ports'
import { readJson } from '../helpers/read-json'

function entry(overrides: Partial<PreviewPortEntry>): PreviewPortEntry {
  return { port: 5173, host: '127.0.0.1', pid: 1, command: 'node', cwd: null, ...overrides }
}

const ErrorResponseSchema = z.object({ error: z.string() })

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ocm-preview-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Preview Routes', () => {
  it('lists the directory-matching port first', async () => {
    const root = await makeTempDir()
    const appDir = join(root, 'app')
    await mkdir(appDir)

    const app = createPreviewRoutes({
      isEnabled: () => true,
      listPorts: async () => [
        entry({ port: 9000, cwd: '/somewhere/else' }),
        entry({ port: 5173, cwd: appDir }),
      ],
    })

    const res = await app.request(`/ports?directory=${encodeURIComponent(root)}`)

    expect(res.status).toBe(200)
    const body = await readJson(res, PreviewPortsResponseSchema)
    expect(body.enabled).toBe(true)
    expect(body.ports.map((port) => port.port)).toEqual([5173, 9000])
  })

  it('sorts by port when no directory is given', async () => {
    const app = createPreviewRoutes({
      isEnabled: () => true,
      listPorts: async () => [entry({ port: 9000 }), entry({ port: 5173 })],
    })

    const res = await app.request('/ports')
    const body = await readJson(res, PreviewPortsResponseSchema)

    expect(body.ports.map((port) => port.port)).toEqual([5173, 9000])
  })

  it('marks entries inside the directory and sorts them first', async () => {
    const root = await makeTempDir()
    const appDir = join(root, 'app')
    await mkdir(appDir)

    const app = createPreviewRoutes({
      isEnabled: () => true,
      listPorts: async () => [
        entry({ port: 5173, cwd: '/somewhere/else' }),
        entry({ port: 9000, cwd: appDir }),
      ],
    })

    const res = await app.request(`/ports?directory=${encodeURIComponent(root)}`)
    const body = await readJson(res, PreviewPortsResponseSchema)

    expect(body.ports.map((port) => ({ port: port.port, inDirectory: port.inDirectory }))).toEqual([
      { port: 9000, inDirectory: true },
      { port: 5173, inDirectory: false },
    ])
  })

  it('resolves symlinked cwds before matching the directory', async () => {
    const root = await makeTempDir()
    const realDir = join(root, 'real')
    const linkDir = join(root, 'link')
    await mkdir(realDir)
    await symlink(realDir, linkDir)

    const app = createPreviewRoutes({
      isEnabled: () => true,
      listPorts: async () => [entry({ port: 5173, cwd: linkDir })],
    })

    const res = await app.request(`/ports?directory=${encodeURIComponent(realDir)}`)
    const body = await readJson(res, PreviewPortsResponseSchema)

    expect(body.ports[0]?.inDirectory).toBe(true)
  })

  it('marks every entry outside when no directory is given', async () => {
    const app = createPreviewRoutes({
      isEnabled: () => true,
      listPorts: async () => [entry({ port: 5173, cwd: '/repo' }), entry({ port: 9000, cwd: null })],
    })

    const res = await app.request('/ports')
    const body = await readJson(res, PreviewPortsResponseSchema)

    expect(body.ports.map((port) => port.inDirectory)).toEqual([false, false])
  })

  it('reports preview as disabled when the port is zero', async () => {
    const app = createPreviewRoutes({ isEnabled: () => false, listPorts: async () => [] })

    const res = await app.request('/ports')

    await expect(readJson(res, PreviewPortsResponseSchema)).resolves.toEqual({ enabled: false, ports: [] })
  })

  it('issues a preview start token for a listening port', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewRoutes({ isEnabled: () => true, listPorts: async () => [entry({ port: 5173 })], store })

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 5173 }),
    })

    expect(res.status).toBe(200)
    const body = await readJson(res, CreatePreviewSessionResponseSchema)
    expect(body.token.length).toBeGreaterThan(0)
    expect(body.previewPort).toBe(ENV.PREVIEW.PORT)
    expect(body.publicUrl).toBe(ENV.PREVIEW.PUBLIC_URL || null)
  })

  it('rejects a reserved port with 400', async () => {
    const app = createPreviewRoutes({ isEnabled: () => true, listPorts: async () => [entry({ port: ENV.PREVIEW.PORT })] })

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: ENV.PREVIEW.PORT }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 for a port that is not listening', async () => {
    const app = createPreviewRoutes({ isEnabled: () => true, listPorts: async () => [entry({ port: 5173 })] })

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 6000 }),
    })

    expect(res.status).toBe(404)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Port 6000 is not listening' })
  })

  it('returns 503 when preview is disabled', async () => {
    const app = createPreviewRoutes({ isEnabled: () => false, listPorts: async () => [entry({ port: 5173 })] })

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 5173 }),
    })

    expect(res.status).toBe(503)
  })

  it('rejects an out-of-range port with 400', async () => {
    const app = createPreviewRoutes({ isEnabled: () => true, listPorts: async () => [] })

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 80 }),
    })

    expect(res.status).toBe(400)
  })

  it('reads availability at request time', async () => {
    let enabled = true
    const app = createPreviewRoutes({ isEnabled: () => enabled, listPorts: async () => [entry({ port: 5173 })] })

    const first = await app.request('/ports')
    expect((await readJson(first, PreviewPortsResponseSchema)).enabled).toBe(true)

    enabled = false
    const second = await app.request('/ports')
    expect((await readJson(second, PreviewPortsResponseSchema)).enabled).toBe(false)

    const disabledSession = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 5173 }),
    })
    expect(disabledSession.status).toBe(503)
  })
})

describe('Preview availability', () => {
  it('starts in the provided state', () => {
    expect(createPreviewAvailability(true).isEnabled()).toBe(true)
    expect(createPreviewAvailability(false).isEnabled()).toBe(false)
  })

  it('tracks availability transitions', () => {
    const availability = createPreviewAvailability(true)

    availability.markUnavailable()
    expect(availability.isEnabled()).toBe(false)

    availability.markAvailable()
    expect(availability.isEnabled()).toBe(true)
  })
})
