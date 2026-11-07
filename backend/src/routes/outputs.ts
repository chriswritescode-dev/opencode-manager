import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  GenerateOutputRequestSchema,
  OutputParamsSchema,
  RefineOutputRequestSchema,
  type OutputParams,
} from '@opencode-manager/shared/schemas'
import type { OutputService } from '../services/outputs/output-service'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'
import { ServiceError } from '../utils/service-error'

type OutputQueryResult =
  | { ok: true; definitionId: string; params?: OutputParams }
  | { ok: false; status: 400; error: string }

function readOutputQuery(c: Context): OutputQueryResult {
  const definitionId = c.req.query('definitionId')
  if (!definitionId) {
    return { ok: false, status: 400, error: 'definitionId is required' }
  }

  const rawParams = c.req.query('params')
  if (rawParams === undefined) {
    return { ok: true, definitionId }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawParams)
  } catch {
    return { ok: false, status: 400, error: 'Invalid params JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'Invalid params JSON' }
  }

  const params = OutputParamsSchema.safeParse(parsed)
  if (!params.success) {
    return { ok: false, status: 400, error: 'Invalid params JSON' }
  }
  return { ok: true, definitionId, params: params.data }
}

export function createOutputRoutes(service: OutputService) {
  const app = new Hono()

  app.get('/helper-sessions', (c) => {
    return c.json({ sessionIds: service.listHelperSessionIds() })
  })

  app.get('/:sessionId', async (c) => {
    const query = readOutputQuery(c)
    if (!query.ok) {
      return c.json({ error: query.error }, query.status)
    }

    try {
      const state = await service.getState(c.req.param('sessionId'), query.definitionId, query.params)
      return c.json(state)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read output', ServiceError)
    }
  })

  app.post('/:sessionId', async (c) => {
    const parsed = await parseJsonBody(c, GenerateOutputRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const state = await service.startGeneration(c.req.param('sessionId'), parsed.data)
      return c.json(state, state.generating ? 202 : 200)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to generate output', ServiceError)
    }
  })

  app.post('/:sessionId/refine', async (c) => {
    const parsed = await parseJsonBody(c, RefineOutputRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const state = await service.refine(c.req.param('sessionId'), parsed.data)
      return c.json(state, 202)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to refine the output', ServiceError)
    }
  })

  app.delete('/:sessionId', async (c) => {
    const query = readOutputQuery(c)
    if (!query.ok) {
      return c.json({ error: query.error }, query.status)
    }

    try {
      await service.cancelGeneration(c.req.param('sessionId'), query.definitionId, query.params)
      return c.body(null, 204)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to cancel the output', ServiceError)
    }
  })

  return app
}
