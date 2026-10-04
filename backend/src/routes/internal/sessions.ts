import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import {
  InternalCreateSessionRequestSchema,
  InternalForkSessionRequestSchema,
  InternalSessionPromptRequestSchema,
} from '@opencode-manager/shared/schemas'
import { buildSessionPath } from '@opencode-manager/shared/utils'
import { getRepoById } from '../../db/queries'
import { handleOpenCodeError, parseJsonBody } from '../../utils/route-helpers'
import type { OpenCodeClient } from '../../services/opencode/client'
import type { SessionPermissionModeService } from '../../services/session-permission-modes'
import { SessionLaunchError, SessionLauncher } from '../../services/session-launcher'
import {
  isSessionBusy,
  readLatestAssistantReply,
  truncateSessionReply,
  waitForSessionSettled,
} from '../../services/session-reply'
import { resolveRepoForDirectory, resolveRepoProjectId } from '../../services/repo'

const INTERNAL_SESSION_LIST_LIMIT_MIN = 1
const INTERNAL_SESSION_LIST_LIMIT_MAX = 50
const INTERNAL_SESSION_LIST_LIMIT_DEFAULT = 10
const INTERNAL_SESSION_WORKSPACE_NAME_FALLBACK = 'ocm-session'
const INTERNAL_SESSION_REPLY_WAIT_MAX_MS = 45000

const ListSessionsQuerySchema = z.object({
  repoId: z.coerce.number().int().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(INTERNAL_SESSION_LIST_LIMIT_MIN)
    .max(INTERNAL_SESSION_LIST_LIMIT_MAX)
    .default(INTERNAL_SESSION_LIST_LIMIT_DEFAULT),
})

const ReplyQuerySchema = z.object({
  waitMs: z.coerce.number().int().min(0).max(INTERNAL_SESSION_REPLY_WAIT_MAX_MS).optional(),
})

function handleSessionRouteError(c: Context, error: unknown) {
  if (error instanceof SessionLaunchError) {
    return c.json({ error: error.message }, error.status)
  }
  return handleOpenCodeError(c, error, 'Internal session request failed', { unknownStatus: 502 })
}

export function createInternalSessionRoutes(
  db: Database,
  openCodeClient: OpenCodeClient,
  permissionModes: SessionPermissionModeService,
) {
  const app = new Hono()
  const sessionLauncher = new SessionLauncher(db, openCodeClient)

  app.get('/', async (c) => {
    const parsedQuery = ListSessionsQuerySchema.safeParse(c.req.query())
    if (!parsedQuery.success) {
      return c.json({ error: 'Invalid query', details: parsedQuery.error.issues }, 400)
    }

    const { repoId, limit } = parsedQuery.data
    const repo = repoId === undefined ? undefined : getRepoById(db, repoId)
    if (repoId !== undefined && !repo) {
      return c.json({ error: 'Repository not found' }, 404)
    }

    try {
      const project = repo ? await resolveRepoProjectId(openCodeClient, repo.fullPath) : undefined
      const response = await openCodeClient.api.session.list({
        limit,
        order: 'desc',
        parentID: null,
        ...(project ? { project } : {}),
      })
      const active = await openCodeClient.api.session.active()

      const repoIdByDirectory = new Map<string, number | null>()
      for (const directory of new Set(response.data.map((session) => session.location.directory))) {
        const matchedRepo = await resolveRepoForDirectory(db, directory)
        repoIdByDirectory.set(directory, matchedRepo?.id ?? null)
      }

      const sessions = response.data.map((session) => {
        const directory = session.location.directory
        return {
          id: session.id,
          title: session.title ?? null,
          directory,
          repoId: repoIdByDirectory.get(directory) ?? null,
          busy: session.id in active,
          outcome: session.outcome ?? null,
          updated: session.time.updated,
        }
      })

      return c.json({ sessions })
    } catch (error) {
      return handleSessionRouteError(c, error)
    }
  })

  app.post('/', async (c) => {
    const body = await parseJsonBody(c, InternalCreateSessionRequestSchema)
    if (!body.ok) {
      return body.response
    }

    const input = body.data
    try {
      const launched = await sessionLauncher.launch({
        repoId: input.repoId,
        prompt: input.prompt,
        ...(input.title ? { title: input.title } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.worktree
          ? {
              workspace: {
                name: input.title ?? INTERNAL_SESSION_WORKSPACE_NAME_FALLBACK,
                ...(input.ref ? { ref: input.ref } : {}),
              },
            }
          : {}),
      })

      permissionModes.pinAsk(launched.sessionId)

      const url = buildSessionPath(
        launched.repoId,
        launched.sessionId,
        launched.workspaceDirectory ? { repoTab: 'workspaces' } : undefined,
      )
      return c.json({ ...launched, url }, 201)
    } catch (error) {
      return handleSessionRouteError(c, error)
    }
  })

  app.post('/:sessionId/prompt', async (c) => {
    const sessionId = c.req.param('sessionId')
    const body = await parseJsonBody(c, InternalSessionPromptRequestSchema)
    if (!body.ok) {
      return body.response
    }

    try {
      await openCodeClient.api.session.prompt({
        sessionID: sessionId,
        text: body.data.text,
        delivery: 'queue',
      })
      return c.json({ queued: true }, 202)
    } catch (error) {
      return handleSessionRouteError(c, error)
    }
  })

  app.get('/:sessionId/reply', async (c) => {
    const sessionId = c.req.param('sessionId')
    const parsedQuery = ReplyQuerySchema.safeParse(c.req.query())
    if (!parsedQuery.success) {
      return c.json({ error: 'Invalid query', details: parsedQuery.error.issues }, 400)
    }

    try {
      const waitMs = parsedQuery.data.waitMs ?? 0
      if (waitMs > 0) {
        await waitForSessionSettled(openCodeClient, sessionId, waitMs)
      }

      const [busy, reply] = await Promise.all([
        isSessionBusy(openCodeClient, sessionId),
        readLatestAssistantReply(openCodeClient, sessionId),
      ])

      return c.json({
        busy,
        responseText: reply?.responseText ? truncateSessionReply(reply.responseText) : null,
        errorText: reply?.errorText ?? null,
        completed: reply?.completed ?? false,
      })
    } catch (error) {
      return handleSessionRouteError(c, error)
    }
  })

  app.post('/:sessionId/fork', async (c) => {
    const sessionId = c.req.param('sessionId')
    const body = await parseJsonBody(c, InternalForkSessionRequestSchema, { allowEmpty: true })
    if (!body.ok) {
      return body.response
    }

    const beforeMessageId = body.data.beforeMessageId
    try {
      const forked = await openCodeClient.api.session.fork({
        sessionID: sessionId,
        ...(beforeMessageId ? { before: beforeMessageId } : {}),
      })
      permissionModes.pinAsk(forked.id)
      return c.json({ sessionId: forked.id, directory: forked.location.directory })
    } catch (error) {
      return handleSessionRouteError(c, error)
    }
  })

  return app
}
