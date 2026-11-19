import path from 'node:path'
import { Hono } from 'hono'
import { ENV } from '@opencode-manager/shared/config/env'
import { CreatePreviewSessionRequestSchema } from '@opencode-manager/shared/schemas'
import { canonicalPathSync } from '../utils/fs-safe'
import { listListeningPorts, isReservedPreviewPort, type PreviewPortEntry } from '../services/preview/ports'
import { PreviewSessionStore } from '../services/preview/gateway'

export interface PreviewAvailability {
  isEnabled: () => boolean
  markAvailable: () => void
  markUnavailable: () => void
}

export function createPreviewAvailability(initialEnabled: boolean): PreviewAvailability {
  let enabled = initialEnabled
  return {
    isEnabled: () => enabled,
    markAvailable: () => { enabled = true },
    markUnavailable: () => { enabled = false },
  }
}

export interface PreviewRoutesDeps {
  isEnabled: () => boolean
  listPorts: () => Promise<PreviewPortEntry[]>
  store: PreviewSessionStore
}

function isInsideDirectory(canonicalCwd: string | null, canonicalDirectory: string | null): boolean {
  if (!canonicalCwd || !canonicalDirectory) return false
  if (canonicalCwd === canonicalDirectory) return true
  const prefix = canonicalDirectory.endsWith(path.sep) ? canonicalDirectory : `${canonicalDirectory}${path.sep}`
  return canonicalCwd.startsWith(prefix)
}

export function createPreviewRoutes(deps: Partial<PreviewRoutesDeps> = {}) {
  const resolvedDeps: PreviewRoutesDeps = {
    isEnabled: deps.isEnabled ?? (() => ENV.PREVIEW.PORT > 0),
    listPorts: deps.listPorts ?? (() => listListeningPorts()),
    store: deps.store ?? new PreviewSessionStore(),
  }
  const app = new Hono()

  app.get('/ports', async (c) => {
    const directory = c.req.query('directory')
    const canonicalDirectory = directory ? canonicalPathSync(directory) : null
    const ports = await resolvedDeps.listPorts()
    const decorated = ports.map((entry) => ({
      ...entry,
      inDirectory: isInsideDirectory(entry.cwd ? canonicalPathSync(entry.cwd) : null, canonicalDirectory),
    }))
    decorated.sort((left, right) => {
      if (left.inDirectory !== right.inDirectory) return left.inDirectory ? -1 : 1
      return left.port - right.port
    })
    return c.json({ enabled: resolvedDeps.isEnabled(), ports: decorated })
  })

  app.post('/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = CreatePreviewSessionRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }

    if (!resolvedDeps.isEnabled()) {
      return c.json({ error: 'Preview is disabled' }, 503)
    }

    if (isReservedPreviewPort(parsed.data.port)) {
      return c.json({ error: 'Port is reserved' }, 400)
    }

    const ports = await resolvedDeps.listPorts()
    const match = ports.find((entry) => entry.port === parsed.data.port)
    if (!match) {
      return c.json({ error: `Port ${parsed.data.port} is not listening` }, 404)
    }

    const token = resolvedDeps.store.issueStartToken({ port: match.port, host: match.host })
    return c.json({
      token,
      previewPort: ENV.PREVIEW.PORT,
      publicUrl: ENV.PREVIEW.PUBLIC_URL || null,
    })
  })

  return app
}
