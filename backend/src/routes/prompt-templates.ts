import { Hono, type Context } from 'hono'
import type { Database } from 'bun:sqlite'
import {
  CreatePromptTemplateRequestSchema,
  UpdatePromptTemplateRequestSchema,
} from '@opencode-manager/shared/schemas'
import { PromptTemplateService, PromptTemplateServiceError } from '../services/prompt-templates'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

function parseId(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (Number.isNaN(parsed)) throw new PromptTemplateServiceError('Invalid id', 400)
  return parsed
}

function handleTemplateError(c: Context, error: unknown, fallback: string) {
  if (error instanceof PromptTemplateServiceError) {
    return c.json({ error: error.message }, error.statusCode as 400 | 404 | 500)
  }
  logger.error(fallback, error)
  return c.json({ error: getErrorMessage(error) }, 500)
}

export function createPromptTemplateRoutes(database: Database) {
  const app = new Hono()
  const service = new PromptTemplateService(database)

  app.get('/', (c) => {
    try {
      return c.json({ templates: service.list() })
    } catch (error) {
      return handleTemplateError(c, error, 'Failed to list templates')
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const input = CreatePromptTemplateRequestSchema.parse(body)
      const template = service.create(input)
      return c.json({ template }, 201)
    } catch (error) {
      return handleTemplateError(c, error, 'Failed to create template')
    }
  })

  app.get('/:id', (c) => {
    try {
      const id = parseId(c.req.param('id'))
      return c.json({ template: service.getById(id) })
    } catch (error) {
      return handleTemplateError(c, error, 'Failed to get template')
    }
  })

  app.patch('/:id', async (c) => {
    try {
      const id = parseId(c.req.param('id'))
      const body = await c.req.json()
      const input = UpdatePromptTemplateRequestSchema.parse(body)
      const template = service.update(id, input)
      return c.json({ template })
    } catch (error) {
      return handleTemplateError(c, error, 'Failed to update template')
    }
  })

  app.delete('/:id', (c) => {
    try {
      const id = parseId(c.req.param('id'))
      service.delete(id)
      return c.body(null, 204)
    } catch (error) {
      return handleTemplateError(c, error, 'Failed to delete template')
    }
  })

  return app
}
