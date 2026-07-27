import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import * as filesystemService from '../services/filesystem'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'

export function createFilesystemRoutes() {
  const app = new Hono()

  app.get('/browse', async (c) => {
    try {
      const requestedPath = c.req.query('path')
      const result = await filesystemService.browseDirectory(requestedPath)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to browse directory:', error)
      return c.json({ error: getErrorMessage(error) || 'Failed to browse directory' }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  return app
}
