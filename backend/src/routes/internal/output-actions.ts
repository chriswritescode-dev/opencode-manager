import { Hono } from 'hono'
import {
  DefineOutputParamsSchema,
  PublishOutputParamsSchema,
  ReadOutputInputParamsSchema,
} from '@opencode-manager/shared/schemas'
import type { OutputService } from '../../services/outputs/output-service'
import { handleServiceError, parseJsonBody } from '../../utils/route-helpers'
import { ServiceError } from '../../utils/service-error'

export function createInternalOutputActionRoutes(service: OutputService) {
  const app = new Hono()

  app.post('/:sessionId/define', async (c) => {
    const parsed = await parseJsonBody(c, DefineOutputParamsSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const definition = service.defineSessionOutput(c.req.param('sessionId'), parsed.data.definition)
      return c.json({ definition })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to define the output', ServiceError)
    }
  })

  app.post('/:sessionId/input', async (c) => {
    const parsed = await parseJsonBody(c, ReadOutputInputParamsSchema, { allowEmpty: true })
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const text = await service.readInput(c.req.param('sessionId'), parsed.data.file)
      return c.json({ text })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read the output input', ServiceError)
    }
  })

  app.post('/:sessionId/publish', async (c) => {
    const parsed = await parseJsonBody(c, PublishOutputParamsSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const result = await service.publish(c.req.param('sessionId'), parsed.data)
      return c.json(result)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to publish the output', ServiceError)
    }
  })

  return app
}
