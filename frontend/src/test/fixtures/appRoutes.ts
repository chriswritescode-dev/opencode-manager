import type { FormInfo, McpServer, PermissionRequest, SessionInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeServer, OpenCodeServerStatus, SessionPin } from '@opencode-manager/shared/schemas'
import type { RepoSibling } from '@opencode-manager/shared/utils'
import type { OpenCodeProject, ShellInfo } from '@/api/opencode'
import type { Repo } from '@/api/types'
import type { UnreadScheduleRunsResponse } from '@/api/schedules'
import type { FetchRoute, RecordedFetchRequest } from '../fetchFake'
import { makeHealthResponse, makeSession } from './api'

export interface AppRoutesSeed {
  repos?: readonly Repo[]
  siblings?: readonly RepoSibling[]
  servers?: readonly OpenCodeServer[]
  statuses?: readonly OpenCodeServerStatus[]
  projects?: readonly OpenCodeProject[]
  sessions?: readonly SessionInfo[]
  sessionDetails?: readonly SessionInfo[]
  active?: Record<string, { type?: string }>
  pins?: readonly SessionPin[]
  permissions?: readonly PermissionRequest[]
  forms?: readonly FormInfo[]
  shells?: readonly ShellInfo[]
  mcpServers?: readonly McpServer[]
  unreadSchedules?: UnreadScheduleRunsResponse
  sessionNextCursor?: string
}

const LOCAL_API = '/api/opencode/api'
const REMOTE_API = '/api/opencode/servers/:serverId/api'

function requestDirectory(request: RecordedFetchRequest): string | null {
  return request.searchParams.get('directory') ?? request.searchParams.get('location[directory]')
}

function directoryMatches(request: RecordedFetchRequest, session: SessionInfo): boolean {
  const directory = requestDirectory(request)
  return directory === null || session.location.directory === directory
}

function searchMatches(request: RecordedFetchRequest, session: SessionInfo): boolean {
  const search = request.searchParams.get('search')
  if (search === null || search.trim() === '') return true
  return (session.title ?? '').toLowerCase().includes(search.trim().toLowerCase())
}

function matchingSessions(seed: AppRoutesSeed, request: RecordedFetchRequest): SessionInfo[] {
  return (seed.sessions ?? []).filter(
    (session) => directoryMatches(request, session) && searchMatches(request, session),
  )
}

function sessionResponse(seed: AppRoutesSeed, sessionID: string) {
  const session = [...(seed.sessions ?? []), ...(seed.sessionDetails ?? [])].find(
    (candidate) => candidate.id === sessionID,
  )
  if (session === undefined) {
    return {
      status: 404,
      json: { _tag: 'SessionNotFoundError', sessionID, message: 'Session not found' },
    }
  }
  return { json: { data: session } }
}

function sessionRoutes(prefix: string, seed: AppRoutesSeed): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: `${prefix}/session`,
      respond: (request) => ({
        json: {
          data: matchingSessions(seed, request),
          cursor: seed.sessionNextCursor ? { next: seed.sessionNextCursor } : {},
        },
      }),
    },
    {
      method: 'POST',
      path: `${prefix}/session`,
      respond: () => ({ json: { data: makeSession({ id: 'new-session' }) } }),
    },
    {
      method: 'GET',
      path: `${prefix}/session/active`,
      respond: () => ({ json: { data: seed.active ?? {} } }),
    },
    {
      method: 'GET',
      path: `${prefix}/session/:sessionID`,
      respond: (_request, params) => sessionResponse(seed, params.sessionID),
    },
    { method: 'GET', path: `${prefix}/permission/request`, respond: () => ({ json: { data: seed.permissions ?? [] } }) },
    { method: 'GET', path: `${prefix}/form`, respond: () => ({ json: { data: seed.forms ?? [] } }) },
    {
      method: 'GET',
      path: `${prefix}/mcp`,
      respond: (request) => ({
        json: { location: { directory: requestDirectory(request) ?? '' }, data: [...(seed.mcpServers ?? [])] },
      }),
    },
    { method: 'GET', path: `${prefix}/shell`, respond: () => ({ json: { data: seed.shells ?? [] } }) },
    { method: 'GET', path: `${prefix}/project`, respond: () => ({ json: seed.projects ?? [] }) },
    {
      method: 'GET',
      path: `${prefix}/location`,
      respond: (request) => {
        const directory = request.searchParams.get('location[directory]') ?? ''
        return { json: { directory, project: { id: 'project_1', directory, canonical: directory } } }
      },
    },
  ]
}

export function appRoutes(seed: AppRoutesSeed = {}): FetchRoute[] {
  const repos = seed.repos ?? []
  const servers = seed.servers ?? []

  return [
    { method: 'GET', path: '/api/repos', respond: () => ({ json: [...repos] }) },
    {
      method: 'GET',
      path: '/api/repos/:id/siblings',
      respond: () => ({ json: [...(seed.siblings ?? [])] }),
    },
    {
      method: 'GET',
      path: '/api/repos/:id',
      respond: (_request, params) => {
        const repo = repos.find((candidate) => candidate.id === Number(params.id))
        if (repo === undefined) return { status: 404, json: { error: 'Repo not found' } }
        return { json: repo }
      },
    },
    { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [...servers] } }) },
    {
      method: 'GET',
      path: '/api/opencode-servers/status',
      respond: () => ({ json: { statuses: [...(seed.statuses ?? [])] } }),
    },
    { method: 'GET', path: '/api/session-pins', respond: () => ({ json: { pins: [...(seed.pins ?? [])] } }) },
    {
      method: 'GET',
      path: '/api/change-walkthroughs/helper-sessions',
      respond: () => ({ json: { sessionIds: [] } }),
    },
    { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse() }) },
    {
      method: 'GET',
      path: '/api/schedules/all/runs/unread',
      respond: () => ({ json: seed.unreadSchedules ?? { runs: [], total: 0, failed: 0 } }),
    },
    { method: 'POST', path: '/api/schedules/all/runs/viewed', respond: () => ({ json: { updated: 0 } }) },
    ...sessionRoutes(LOCAL_API, seed),
    ...sessionRoutes(REMOTE_API, seed),
  ]
}
