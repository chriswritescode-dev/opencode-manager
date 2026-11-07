import { Hono } from 'hono'
import {
  PromoteOutputDefinitionRequestSchema,
  UserOutputDefinitionInputSchema,
} from '@opencode-manager/shared/schemas'
import type { OutputDefinitionRegistry } from '../services/outputs/definition-registry'
import { OutputError } from '../services/outputs/output-error'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'

export function createOutputDefinitionRoutes(registry: OutputDefinitionRegistry) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      return c.json({ definitions: registry.list(c.req.query('sessionId')) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list output definitions', OutputError)
    }
  })

  app.post('/', async (c) => {
    const parsed = await parseJsonBody(c, UserOutputDefinitionInputSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      return c.json({ definition: registry.createGlobal(parsed.data) }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create output definition', OutputError)
    }
  })

  app.put('/:id', async (c) => {
    const parsed = await parseJsonBody(c, UserOutputDefinitionInputSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      return c.json({ definition: registry.putGlobal(c.req.param('id'), parsed.data) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to save output definition', OutputError)
    }
  })

  app.delete('/:id', (c) => {
    try {
      registry.deleteGlobal(c.req.param('id'))
      return c.body(null, 204)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete output definition', OutputError)
    }
  })

  app.post('/promote', async (c) => {
    const parsed = await parseJsonBody(c, PromoteOutputDefinitionRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      return c.json({ definition: registry.promote(parsed.data) }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to promote output definition', OutputError)
    }
  })

  return app
}
