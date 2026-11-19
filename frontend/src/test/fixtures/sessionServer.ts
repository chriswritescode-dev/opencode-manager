import { z } from 'zod'
import {
  ToggleSessionPinRequestSchema,
  type SessionPin,
} from '@opencode-manager/shared/schemas'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import type { FormInfo, PermissionRequest } from '@opencode-manager/shared/opencode'
import type { OpenCodeProject } from '@/api/opencode'
import type { Repo } from '@/api/types'
import type { FetchRoute, FetchRouteResult, RecordedFetchRequest } from '../fetchFake'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'

const OPENCODE_API = '/api/opencode/api'
const DEFAULT_PAGE_SIZE = 25

const createSessionRequestSchema = z.object({
  location: z.object({ directory: z.string().min(1) }).optional(),
})

export interface SessionServerPageInput {
  request: RecordedFetchRequest
  page: number
  offset: number
  limit: number
  sessions: SessionInfo[]
}

export interface SessionServerOptions {
  sessions?: readonly SessionInfo[]
  remoteSessions?: readonly SessionInfo[]
  repos?: readonly Repo[]
  pins?: readonly SessionPin[]
  helperSessionIds?: readonly string[]
  projects?: readonly OpenCodeProject[]
  permissions?: readonly PermissionRequest[]
  forms?: readonly FormInfo[]
  remoteServers?: readonly OpenCodeServer[]
  pageSize?: number
  locationProject?: { id: string; directory: string; canonical: string }
  sessionPage?: (input: SessionServerPageInput) => FetchRouteResult | Promise<FetchRouteResult> | undefined
  sessionRespond?: FetchRoute['respond']
  locationRespond?: FetchRoute['respond']
  deleteRespond?: FetchRoute['respond']
  createRespond?: FetchRoute['respond']
}

export interface SessionServer {
  routes: FetchRoute[]
  sessions: () => SessionInfo[]
  deletedSessionIDs: () => string[]
  createdDirectories: () => string[]
  pins: () => SessionPin[]
  sessionRequests: () => RecordedFetchRequest[]
}

function requestString(request: RecordedFetchRequest, key: string): string | null {
  const value = request.searchParams.get(key)
  return value === null || value === '' ? null : value
}

export function createSessionServer(options: SessionServerOptions = {}): SessionServer {
  let sessions = [...(options.sessions ?? [])]
  let pins = [...(options.pins ?? [])]
  const deletedSessionIDs: string[] = []
  const createdDirectories: string[] = []
  const sessionRequests: RecordedFetchRequest[] = []
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const locationProject = options.locationProject ?? { id: 'global', directory: '', canonical: '' }

  const sessionsFor = (request: RecordedFetchRequest): SessionInfo[] =>
    request.path.startsWith('/api/opencode/servers/')
      ? [...(options.remoteSessions ?? [])]
      : sessions

  const sessionRoute: FetchRoute = {
    method: 'GET',
    path: `${OPENCODE_API}/session`,
    respond: async (request) => {
      sessionRequests.push(request)
      const directory = requestString(request, 'directory')
      const search = requestString(request, 'search')?.toLowerCase()
      const limit = Number(request.searchParams.get('limit') ?? pageSize)
      const offset = Number(request.searchParams.get('cursor') ?? 0)
      const page = Math.floor(offset / limit)

      const matching = sessionsFor(request).filter((session) => {
        if (directory && session.location.directory !== directory) return false
        if (search && !(session.title ?? '').toLowerCase().includes(search)) return false
        return true
      })

      if (options.sessionPage) {
        const custom = options.sessionPage({ request, page, offset, limit, sessions: matching })
        if (custom !== undefined) return custom
      }

      const items = matching.slice(offset, offset + limit)
      const next = offset + limit < matching.length ? String(offset + limit) : null
      return { json: { data: items, cursor: next ? { next } : {} } }
    },
  }

  const deleteRoute: FetchRoute = {
    method: 'DELETE',
    path: `${OPENCODE_API}/session/:sessionID`,
    respond: (request, params) => {
      deletedSessionIDs.push(params.sessionID)
      if (options.deleteRespond) return options.deleteRespond(request, params, undefined)
      sessions = sessions.filter((session) => session.id !== params.sessionID)
      return { status: 204 }
    },
  }

  const createRoute: FetchRoute = {
    method: 'POST',
    path: `${OPENCODE_API}/session`,
    respond: (request) => {
      if (options.createRespond) return options.createRespond(request, {}, undefined)
      const parsed = createSessionRequestSchema.safeParse(request.body)
      const directory = parsed.success ? parsed.data.location?.directory ?? '/w/a' : '/w/a'
      createdDirectories.push(directory)
      const created: SessionInfo = {
        id: 'ses_new',
        projectID: 'proj_1',
        title: 'New session',
        time: { created: 1, updated: 1 },
        location: { directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      sessions = [created, ...sessions]
      return { json: { data: created } }
    },
  }

  const pinsRoute: FetchRoute = {
    method: 'PUT',
    path: '/api/session-pins',
    respond: (request) => {
      const parsed = ToggleSessionPinRequestSchema.safeParse(request.body)
      if (parsed.success) {
        const { sessionId, directory, pinned } = parsed.data
        pins = pinned
          ? [...pins.filter((pin) => pin.sessionId !== sessionId || pin.directory !== directory), {
              sessionId,
              directory,
              pinnedAt: Date.now(),
            }]
          : pins.filter((pin) => pin.sessionId !== sessionId || pin.directory !== directory)
      }
      return { json: { pins } }
    },
  }

  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/repos', respond: () => ({ json: [...(options.repos ?? [])] }) },
    { method: 'GET', path: '/api/repos/:id/siblings', respond: () => ({ json: [] }) },
    {
      method: 'GET',
      path: '/api/opencode-servers',
      respond: () => ({
        json: { servers: [...(options.remoteServers ?? [])] },
      }),
    },
    { method: 'GET', path: '/api/opencode-servers/status', respond: () => ({ json: { statuses: [] } }) },
    { method: 'GET', path: '/api/session-pins', respond: () => ({ json: { pins } }) },
    pinsRoute,
    {
      method: 'GET',
      path: '/api/change-walkthroughs/helper-sessions',
      respond: () => ({ json: { sessionIds: [...(options.helperSessionIds ?? [])] } }),
    },
    { method: 'GET', path: `${OPENCODE_API}/session/active`, respond: () => ({ json: { data: {} } }) },
    { method: 'GET', path: `${OPENCODE_API}/permission/request`, respond: () => ({ json: { data: [...(options.permissions ?? [])] } }) },
    { method: 'GET', path: `${OPENCODE_API}/form`, respond: () => ({ json: { data: [...(options.forms ?? [])] } }) },
    { method: 'GET', path: `${OPENCODE_API}/shell`, respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: `${OPENCODE_API}/project`, respond: () => ({ json: [...(options.projects ?? [])] }) },
    {
      method: 'GET',
      path: `${OPENCODE_API}/location`,
      respond: (request) => {
        if (options.locationRespond) return options.locationRespond(request, {}, undefined)
        const directory = request.searchParams.get('location[directory]') ?? ''
        return {
          json: {
            directory,
            project: locationProject.directory
              ? locationProject
              : { id: locationProject.id, directory, canonical: directory },
          },
        }
      },
    },
    {
      method: 'GET',
      path: `${OPENCODE_API}/session/:sessionID`,
      respond: (request, params) => {
        if (options.sessionRespond) return options.sessionRespond(request, params, undefined)
        const session = sessionsFor(request).find((candidate) => candidate.id === params.sessionID)
        return session ? { json: { data: session } } : { status: 404, json: { error: 'Session not found' } }
      },
    },
    sessionRoute,
    createRoute,
    deleteRoute,
  ]

  return {
    routes: [...routes, ...remoteServerRoutes(routes, options.remoteServers ?? [])],
    sessions: () => [...sessions],
    deletedSessionIDs: () => [...deletedSessionIDs],
    createdDirectories: () => [...createdDirectories],
    pins: () => [...pins],
    sessionRequests: () => [...sessionRequests],
  }
}

function remoteServerRoutes(
  routes: readonly FetchRoute[],
  servers: readonly Pick<OpenCodeServer, 'id'>[],
): FetchRoute[] {  return servers.flatMap((server) =>
    routes.flatMap((route) => {
      const path = route.path instanceof RegExp ? null : route.path
      if (path === null || !path.startsWith(OPENCODE_API)) return []
      return [{
        ...route,
        path: `/api/opencode/servers/${server.id}/api${path.slice(OPENCODE_API.length)}`,
      }]
    }),
  )
}
