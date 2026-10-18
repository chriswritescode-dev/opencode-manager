import { Hono } from 'hono'
import {
  CreateOpenCodeServerRequestSchema,
  TestOpenCodeServerRequestSchema,
  UpdateOpenCodeServerRequestSchema,
  type OpenCodeServerStatus,
} from '@opencode-manager/shared/schemas'
import { OpenCodeServerError, type OpenCodeServerRegistry } from '../services/opencode-server-registry'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'

export type OpenCodeServerStatusProvider = () => OpenCodeServerStatus[]

export function createOpenCodeServerRoutes(
  registry: OpenCodeServerRegistry,
  statusProvider?: OpenCodeServerStatusProvider,
) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      return c.json({ servers: registry.list() })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list OpenCode servers', OpenCodeServerError)
    }
  })

  app.post('/', async (c) => {
    const parsed = await parseJsonBody(c, CreateOpenCodeServerRequestSchema)
    if (!parsed.ok) return parsed.response

    try {
      const server = await registry.create(parsed.data)
      const test = await registry.test({ serverId: server.id })
      return c.json({ server, test }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create OpenCode server', OpenCodeServerError)
    }
  })

  app.post('/test', async (c) => {
    const parsed = await parseJsonBody(c, TestOpenCodeServerRequestSchema)
    if (!parsed.ok) return parsed.response

    try {
      return c.json(await registry.test(parsed.data))
    } catch (error) {
      return handleServiceError(c, error, 'Failed to test OpenCode server', OpenCodeServerError)
    }
  })

  app.get('/status', (c) => {
    if (!statusProvider) return c.json({ statuses: [] })
    try {
      return c.json({ statuses: statusProvider() })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read OpenCode server status', OpenCodeServerError)
    }
  })

  app.get('/:id', (c) => {
    try {
      const server = registry.get(c.req.param('id'))
      if (!server) return c.json({ error: 'OpenCode server not found' }, 404)
      return c.json({ server })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read OpenCode server', OpenCodeServerError)
    }
  })

  app.patch('/:id', async (c) => {
    const parsed = await parseJsonBody(c, UpdateOpenCodeServerRequestSchema)
    if (!parsed.ok) return parsed.response

    try {
      const server = await registry.update(c.req.param('id'), parsed.data)
      return c.json({ server })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update OpenCode server', OpenCodeServerError)
    }
  })

  app.delete('/:id', (c) => {
    try {
      registry.delete(c.req.param('id'))
      return c.body(null, 204)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete OpenCode server', OpenCodeServerError)
    }
  })

  app.post('/:id/test', async (c) => {
    try {
      return c.json(await registry.test({ serverId: c.req.param('id') }))
    } catch (error) {
      return handleServiceError(c, error, 'Failed to test OpenCode server', OpenCodeServerError)
    }
  })

  return app
}
