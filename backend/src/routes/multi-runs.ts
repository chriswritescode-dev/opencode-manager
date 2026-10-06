import { Hono } from 'hono'
import { FuseMultiRunRequestSchema, LaunchMultiRunRequestSchema } from '@opencode-manager/shared/schemas'
import { MultiRunError, type MultiRunService } from '../services/multi-runs'
import { handleServiceError, parseId, parseJsonBody } from '../utils/route-helpers'
import { ServiceError } from '../utils/service-error'

export function createMultiRunRoutes(service: MultiRunService) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      const repoId = parseId(c.req.query('repoId'), 'repoId', MultiRunError)
      return c.json({ runs: service.list(repoId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list multi-runs', ServiceError)
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
      return handleServiceError(c, error, 'Failed to launch multi-run', ServiceError)
    }
  })

  app.post('/:id/entries/:entryId/discard', async (c) => {
    try {
      const multiRunId = parseId(c.req.param('id'), 'multi-run id', MultiRunError)
      const entryId = parseId(c.req.param('entryId'), 'entry id', MultiRunError)
      const run = await service.discard(multiRunId, entryId)
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to discard multi-run entry', ServiceError)
    }
  })

  app.post('/:id/fusions', async (c) => {
    try {
      const multiRunId = parseId(c.req.param('id'), 'multi-run id', MultiRunError)
      const parsed = await parseJsonBody(c, FuseMultiRunRequestSchema)
      if (!parsed.ok) {
        return parsed.response
      }

      const { run, created } = await service.fuse(multiRunId, parsed.data)
      return c.json({ run }, created ? 201 : 200)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to fuse multi-run', ServiceError)
    }
  })

  return app
}
