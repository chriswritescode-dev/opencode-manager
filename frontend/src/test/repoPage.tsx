import { Route, Routes } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { RepoDetail } from '@/pages/RepoDetail'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult, RecordedFetchRequest } from '@/test/fetchFake'
import type { Repo, Session } from '@/api/types'
import type { RepoSibling } from '@/api/repos'

export interface RepoDetailPageOptions {
  route?: string
  repo?: Repo
  repoRespond?: FetchRoute['respond']
  siblings?: RepoSibling[]
  sessions?: (directory: string) => Session[]
  createWorkspaceRespond?: FetchRoute['respond']
  serverId?: string
  queryClient?: QueryClient
}

export function repoDetailPageRoutes(options: RepoDetailPageOptions = {}): FetchRoute[] {
  const repo = options.repo ?? makeRepo()
  const sessions = options.sessions ?? ((directory: string) => [
    makeSession({ id: 'ses_1', title: 'Repo session', location: { directory } }),
  ])
  return [
    {
      method: 'GET',
      path: '/api/repos/:id',
      respond: options.repoRespond ?? (() => ({ json: repo })),
    },
    {
      method: 'GET',
      path: '/api/repos/:id/siblings',
      respond: () => ({ json: options.siblings ?? [] }),
    },
    {
      method: 'GET',
      path: '/api/repos/:id/terminals',
      respond: () => ({ json: { terminals: [] } }),
    },
    { method: 'POST', path: '/api/repos/:id/access', respond: () => ({ status: 204 }) },
    {
      method: 'POST',
      path: '/api/repos/:id/workspaces',
      respond: options.createWorkspaceRespond ?? (() => ({ json: { directory: '/abs/repos/demo-ws', worktreeSetup: { status: 'none' } } })),
    },
    { method: 'DELETE', path: '/api/repos/:id/workspaces', respond: () => ({ json: { removed: 0 } }) },
    { method: 'GET', path: '/api/multi-runs', respond: () => ({ json: { runs: [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/session',
      respond: (request: RecordedFetchRequest) => ({ json: { data: sessions(request.searchParams.get('directory') ?? ''), cursor: {} } }),
    },
    {
      method: 'POST',
      path: '/api/opencode/api/session',
      respond: () => ({ json: { data: makeSession({ id: 'ses_new' }) } }),
    },
    { method: 'GET', path: '/api/session-pins', respond: () => ({ json: { pins: [] } }) },
    { method: 'GET', path: '/api/change-walkthroughs/helper-sessions', respond: () => ({ json: { sessionIds: [] } }) },
    { method: 'GET', path: '/api/schedules/all/runs/unread', respond: () => ({ json: { runs: [], total: 0, failed: 0 } }) },
    { method: 'GET', path: '/api/preview/ports', respond: () => ({ json: { enabled: true, ports: [] } }) },
  ]
}

export function renderRepoDetailPage(options: RepoDetailPageOptions = {}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/" element={<div>repositories route</div>} />
        <Route path="/repos/:id" element={<RepoDetail />} />
        <Route path="/repos/:id/sessions/:sessionId" element={<div>session route</div>} />
      </Routes>
    </>,
    {
      route: options.route ?? '/repos/1',
      events: true,
      serverId: options.serverId,
      queryClient: options.queryClient,
      fetchRoutes: repoDetailPageRoutes(options),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

export function jsonStatus(status: number, body: FetchRouteResult['json']): FetchRouteResult {
  return { status, json: body }
}
