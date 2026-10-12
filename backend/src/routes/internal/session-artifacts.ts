import { Hono } from 'hono'
import { z } from 'zod'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { OpenCodeClient } from '../../services/opencode/client'
import { resolveSessionArtifactFile, SessionArtifactError } from '../../services/session-artifacts'
import { handleOpenCodeError, parseJsonBody } from '../../utils/route-helpers'

const ResolveSessionArtifactRequestSchema = z.object({ path: z.string().min(1) }).strict()

export function createInternalSessionArtifactRoutes(openCodeClient: OpenCodeClient) {
  const app = new Hono()

  app.post('/:sessionId/resolve', async (c) => {
    const parsed = await parseJsonBody(c, ResolveSessionArtifactRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const path = await resolveSessionArtifactFile(openCodeClient, c.req.param('sessionId'), parsed.data.path)
      return c.json({ path })
    } catch (error) {
      if (error instanceof SessionArtifactError) {
        return c.json({ error: error.message }, error.status as ContentfulStatusCode)
      }
      return handleOpenCodeError(c, error, 'Failed to resolve artifact file', { unknownStatus: 502 })
    }
  })

  return app
}
