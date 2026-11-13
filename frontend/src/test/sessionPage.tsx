import { Route, Routes } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import { SessionDetail } from '@/pages/SessionDetail'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { SwipeNavigationProvider } from '@/contexts/SwipeNavigationContext'
import type { SwipeNavigationValue } from '@/contexts/swipe-navigation-context'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher, SwipeNavigationCatcher } from '@/test/test-components'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { Repo } from '@/api/types'
import type { OpenCodeProject } from '@/api/opencode'
import type { SessionInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'

export interface SessionPageOptions {
  route?: string
  repo?: Repo | null
  repoRespond?: FetchRoute['respond']
  session?: SessionInfo | null
  sessionRespond?: FetchRoute['respond']
  messages?: SessionMessageInfo[]
  messageRespond?: FetchRoute['respond']
  forms?: FetchRoute['respond']
  formCancelRespond?: FetchRoute['respond']
  compactRespond?: FetchRoute['respond']
  updateSessionRespond?: FetchRoute['respond']
  forkRespond?: FetchRoute['respond']
  activeSessions?: string[]
  projects?: OpenCodeProject[]
  servers?: FetchRoute['respond']
  serverStatuses?: FetchRoute['respond']
  extraRoutes?: readonly FetchRoute[]
  swipeNavigation?: { current: SwipeNavigationValue | null }
  serverId?: string
  queryClient?: QueryClient
}

function sessionMessagesRoute(messages: SessionMessageInfo[]): FetchRoute['respond'] {
  return () => ({ json: { data: messages, cursor: {} } })
}

export function sessionPageRoutes(options: SessionPageOptions = {}): FetchRoute[] {
  const repo = options.repo === undefined ? makeRepo({ id: 1, fullPath: '/test/repo' }) : options.repo
  const session = options.session === undefined
    ? makeSession({ id: 'session-1', location: { directory: '/test/repo' } })
    : options.session
  return [
    ...(options.extraRoutes ?? []),
    {
      method: 'GET',
      path: '/api/repos/:id',
      respond: options.repoRespond ?? (() => (repo ? { json: repo } : { status: 404, json: { error: 'Repository not found' } })),
    },
    { method: 'POST', path: '/api/repos/:id/access', respond: () => ({ status: 204 }) },
    { method: 'GET', path: '/api/repos/:id/siblings', respond: () => ({ json: [] }) },
    { method: 'GET', path: '/api/repos/:id/terminals', respond: () => ({ json: { terminals: [] } }) },
    { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
    {
      method: 'GET',
      path: '/api/opencode-servers',
      respond: options.servers ?? (() => ({ json: { servers: [] } })),
    },
    {
      method: 'GET',
      path: '/api/opencode-servers/status',
      respond: options.serverStatuses ?? (() => ({ json: { statuses: [] } })),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/session/active',
      respond: () => ({ json: { data: Object.fromEntries((options.activeSessions ?? []).map((id) => [id, {}])) } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/session/:sessionId',
      respond: options.sessionRespond ?? (() => (session ? { json: { data: session } } : { status: 404, json: { error: 'Session not found' } })),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/session/:sessionId/message',
      respond: options.messageRespond ?? sessionMessagesRoute(options.messages ?? []),
    },
    { method: 'GET', path: '/api/opencode/api/session/:sessionId/inbox', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/project', respond: () => ({ json: options.projects ?? [] }) },
    {
      method: 'GET',
      path: '/api/opencode/api/vcs',
      respond: () => ({ json: { data: { branch: { current: null } } } }),
    },
    { method: 'GET', path: '/api/opencode/api/permission/request', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/form', respond: options.forms ?? (() => ({ json: { data: [] } })) },
    { method: 'GET', path: '/api/opencode/api/shell', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/agent', respond: () => ({ json: { data: [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/command',
      respond: () => ({ json: { data: [{ name: 'review', description: 'Review the changes' }] } }),
    },
    { method: 'GET', path: '/api/opencode/api/skill', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/mcp', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
    {
      method: 'GET',
      path: '/api/opencode/api/provider',
      respond: () => ({ json: { data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }] } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/model',
      respond: () => ({
        json: {
          data: [{
            id: 'claude-sonnet-4-5',
            modelID: 'claude-sonnet-4-5',
            providerID: 'anthropic',
            name: 'Claude Sonnet 4.5',
            capabilities: {},
            enabled: true,
            status: 'active',
            limit: { context: 200000, output: 64000 },
            time: { released: 1 },
            cost: [{ input: 3, output: 15 }],
            variants: [],
          }],
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/model/default',
      respond: () => ({ json: { data: { providerID: 'anthropic', id: 'claude-sonnet-4-5' } } }),
    },
    { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: {} }) },
    {
      method: 'GET',
      path: '/api/session-permission-modes/:sessionId',
      respond: () => ({ json: { sessionId: 'session-1', rootSessionId: 'session-1', mode: 'ask', lockedReason: null } }),
    },
    {
      method: 'GET',
      path: '/api/session-sandbox/:sessionId',
      respond: () => ({
        json: {
          sessionId: 'session-1',
          rootSessionId: 'session-1',
          sandboxed: false,
          source: 'default',
          resources: null,
          effectiveResources: { cpus: 2, memoryMib: 2048 },
          lockedReason: null,
          available: false,
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/experimental/session/:sessionId/instructions/entries',
      respond: () => ({ json: { data: [] } }),
    },
    {
      method: 'POST',
      path: '/api/opencode/api/rpc/opencode.goal/get',
      respond: () => ({ json: { output: null } }),
    },
    { method: 'GET', path: '/api/schedules/all/runs/unread', respond: () => ({ json: { runs: [], total: 0, failed: 0 } }) },
    { method: 'GET', path: '/api/change-walkthroughs/helper-sessions', respond: () => ({ json: { sessionIds: [] } }) },
    { method: 'GET', path: '/api/session-pins', respond: () => ({ json: { pins: [] } }) },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/compact',
      respond: options.compactRespond ?? (() => ({ json: { data: { id: 'compaction-1' } } })),
    },
    {
      method: 'PATCH',
      path: '/api/opencode/api/session/:sessionId',
      respond: options.updateSessionRespond ?? (() => ({ status: 204 })),
    },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/fork',
      respond: options.forkRespond ?? (() => ({ json: { data: makeSession({ id: 'session-2', location: { directory: '/test/repo' } }) } })),
    },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/form/:formId/reply',
      respond: () => ({ status: 204 }),
    },
    {
      method: 'DELETE',
      path: '/api/opencode/api/session/:sessionId/form/:formId',
      respond: options.formCancelRespond ?? (() => ({ status: 204 })),
    },
  ]
}

const OPENCODE_API_PATH_PREFIX = '/api/opencode/api/'
const OPENCODE_REMOTE_SERVER_PATH_PREFIX = '/api/opencode/servers'

export function remoteSessionPageRoutes(serverId: string, options: SessionPageOptions = {}): FetchRoute[] {
  const routes = sessionPageRoutes(options)
  const remoteRoutes = routes.map((route) => {
    if (route.path instanceof RegExp) return route
    if (!route.path.startsWith(OPENCODE_API_PATH_PREFIX)) return route
    return {
      ...route,
      path: `${OPENCODE_REMOTE_SERVER_PATH_PREFIX}/${serverId}${route.path.slice('/api/opencode'.length)}`,
    }
  })
  return [...remoteRoutes, ...routes]
}

function renderSessionTree(options: SessionPageOptions, fetchRoutes: FetchRoute[]) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const routes = (
    <Routes>
      <Route path="/" element={<div>home route</div>} />
      <Route path="/repos/:id" element={<div>repo route</div>} />
      <Route path="/servers/:serverId/projects" element={<div>server projects route</div>} />
      <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
      <Route path="/servers/:serverId/sessions/:sessionId" element={<SessionDetail />} />
    </Routes>
  )
  const swipeNavigation = options.swipeNavigation
  const tree = swipeNavigation ? (
    <SwipeNavigationProvider>
      <SwipeNavigationCatcher captured={swipeNavigation} />
      {routes}
    </SwipeNavigationProvider>
  ) : routes
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      {tree}
    </KeyboardShortcutsProvider>,
    {
      route: options.route ?? '/repos/1/sessions/session-1',
      events: true,
      tts: true,
      serverId: options.serverId,
      queryClient: options.queryClient,
      fetchRoutes,
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

export function renderSessionPage(options: SessionPageOptions = {}) {
  return renderSessionTree(options, sessionPageRoutes(options))
}

export function renderRemoteSessionPage(serverId: string, options: SessionPageOptions = {}) {
  return renderSessionTree(
    { ...options, serverId, route: options.route ?? `/servers/${serverId}/sessions/session-1` },
    remoteSessionPageRoutes(serverId, options),
  )
}

export function sessionPageStatus(status: number, body: FetchRouteResult['json']): FetchRouteResult {
  return { status, json: body }
}
