import { Hono } from 'hono'
import { WalkthroughChangesParamsSchema } from '@opencode-manager/shared/schemas'
import type { ChangeWalkthroughService } from '../../services/change-walkthroughs'
import { handleServiceError, parseJsonBody } from '../../utils/route-helpers'
import { ServiceError } from '../../utils/service-error'

export function createInternalWalkthroughSessionRoutes(service: ChangeWalkthroughService) {
  const app = new Hono()

  app.post('/:sessionId/changes', async (c) => {
    const parsed = await parseJsonBody(c, WalkthroughChangesParamsSchema, { allowEmpty: true })
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const text = await service.readChangesForWalkthroughSession(c.req.param('sessionId'), parsed.data.file)
      return c.json({ text })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read walkthrough changes', ServiceError)
    }
  })

  app.post('/:sessionId/publish', async (c) => {
    try {
      const result = await service.publishFromWalkthroughSession(c.req.param('sessionId'))
      return c.json(result)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to publish the walkthrough', ServiceError)
    }
  })

  return app
}
