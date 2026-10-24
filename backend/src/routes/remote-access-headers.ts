import { Hono } from 'hono'
import { ReplaceRemoteAccessHeadersRequestSchema } from '@opencode-manager/shared/schemas'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'
import { RemoteAccessHeadersError, type RemoteAccessHeadersService } from '../services/remote-access-headers'

const READ_FAILED_MESSAGE = 'Failed to read remote access headers'
const WRITE_FAILED_MESSAGE = 'Failed to update remote access headers'

export function createRemoteAccessHeaderRoutes(service: RemoteAccessHeadersService) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      return c.json(service.getSummary())
    } catch (error) {
      return handleServiceError(c, error, READ_FAILED_MESSAGE, RemoteAccessHeadersError)
    }
  })

  app.put('/', async (c) => {
    const body = await parseJsonBody(c, ReplaceRemoteAccessHeadersRequestSchema)
    if (!body.ok) return body.response

    try {
      return c.json(service.replace(body.data))
    } catch (error) {
      return handleServiceError(c, error, WRITE_FAILED_MESSAGE, RemoteAccessHeadersError)
    }
  })

  app.delete('/', (c) => {
    try {
      service.clear()
      return c.json(service.getSummary())
    } catch (error) {
      return handleServiceError(c, error, WRITE_FAILED_MESSAGE, RemoteAccessHeadersError)
    }
  })

  return app
}
