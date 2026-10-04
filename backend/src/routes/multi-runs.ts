import { Hono } from 'hono'
import { LaunchMultiRunRequestSchema } from '@opencode-manager/shared/schemas'
import { MultiRunError, type MultiRunService } from '../services/multi-runs'
import { handleServiceError, parseId, parseJsonBody } from '../utils/route-helpers'

export function createMultiRunRoutes(service: MultiRunService) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      const repoId = parseId(c.req.query('repoId'), 'repoId', MultiRunError)
      return c.json({ runs: service.list(repoId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list multi-runs', MultiRunError)
    }
  })

  app.post('/', async (c) => {
    const parsed = await parseJsonBody(c, LaunchMultiRunRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const run = await service.launch(parsed.data)
      return c.json({ run }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to launch multi-run', MultiRunError)
    }
  })

  app.post('/:id/entries/:entryId/discard', async (c) => {
    try {
      const multiRunId = parseId(c.req.param('id'), 'multi-run id', MultiRunError)
      const entryId = parseId(c.req.param('entryId'), 'entry id', MultiRunError)
      const run = await service.discard(multiRunId, entryId)
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to discard multi-run entry', MultiRunError)
    }
  })

  return app
}
