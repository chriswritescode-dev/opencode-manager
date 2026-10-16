import { Hono } from 'hono'
import {
  DEFAULT_WALKTHROUGH_SOURCE,
  GenerateChangeWalkthroughRequestSchema,
  RefineChangeWalkthroughRequestSchema,
  parseWalkthroughSourceKey,
} from '@opencode-manager/shared/schemas'
import type { ChangeWalkthroughService } from '../services/change-walkthroughs'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'
import { ServiceError } from '../utils/service-error'

export function createChangeWalkthroughRoutes(service: ChangeWalkthroughService) {
  const app = new Hono()

  app.get('/:sessionId', async (c) => {
    const sourceParam = c.req.query('source')
    const source = sourceParam === undefined ? DEFAULT_WALKTHROUGH_SOURCE : parseWalkthroughSourceKey(sourceParam)
    if (!source) {
      return c.json({ error: 'Invalid walkthrough source' }, 400)
    }

    try {
      const state = await service.getState(c.req.param('sessionId'), source)
      return c.json(state)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read change walkthrough', ServiceError)
    }
  })

  app.post('/:sessionId', async (c) => {
    const parsed = await parseJsonBody(c, GenerateChangeWalkthroughRequestSchema, { allowEmpty: true })
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const state = await service.startGeneration(c.req.param('sessionId'), parsed.data)
      return c.json(state, state.generating ? 202 : 200)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to generate change walkthrough', ServiceError)
    }
  })

  app.post('/:sessionId/refine', async (c) => {
    const parsed = await parseJsonBody(c, RefineChangeWalkthroughRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const state = await service.refine(c.req.param('sessionId'), parsed.data)
      return c.json(state, 202)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to refine the change walkthrough', ServiceError)
    }
  })

  app.delete('/:sessionId', async (c) => {
    const sourceParam = c.req.query('source')
    const source = sourceParam === undefined ? DEFAULT_WALKTHROUGH_SOURCE : parseWalkthroughSourceKey(sourceParam)
    if (!source) {
      return c.json({ error: 'Invalid walkthrough source' }, 400)
    }

    await service.cancelGeneration(c.req.param('sessionId'), source)
    return c.body(null, 204)
  })

  return app
}
