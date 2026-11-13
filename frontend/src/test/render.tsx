import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { expect } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { AuthProvider } from '@/contexts/AuthContext'
import { EventProvider } from '@/contexts/EventContext'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TTSProvider } from '@/contexts/TTSContext'
import { openCodeEventStream, TestEventStreamTransport } from '@/lib/opencode-event-stream'
import { createFetchFake, type FetchFake, type FetchRoute, type FetchRouteResult, type RecordedFetchRequest } from './fetchFake'
import { makeAuthConfig, makeAuthSession, makeSettingsResponse } from './fixtures/api'

export type TestAuthMode = 'authenticated' | 'anonymous' | false

export interface TestProviderOptions {
  route?: string
  initialEntries?: string[]
  fetchRoutes?: readonly FetchRoute[]
  fetchFallback?: (request: RecordedFetchRequest) => FetchRouteResult | Promise<FetchRouteResult>
  auth?: TestAuthMode
  theme?: boolean
  tts?: boolean
  events?: boolean
  toaster?: boolean
  queryClient?: QueryClient
  serverId?: string
  eventStream?: TestEventStreamTransport
}

export interface TestRenderResult {
  queryClient: QueryClient
  fetchFake: FetchFake
  eventStream?: TestEventStreamTransport
}

interface ProviderTreeOptions extends TestProviderOptions {
  queryClient: QueryClient
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function defaultFetchRoutes(auth: TestAuthMode): FetchRoute[] {
  if (auth === false) return []
  return [
    {
      method: 'GET',
      path: '/api/auth/get-session',
      respond: () => ({ json: auth === 'anonymous' ? null : makeAuthSession() }),
    },
    {
      method: 'GET',
      path: '/api/auth-info/config',
      respond: () => ({ json: makeAuthConfig() }),
    },
    {
      method: 'GET',
      path: '/api/settings',
      respond: () => ({ json: makeSettingsResponse() }),
    },
  ]
}

function buildProviderTree(children: ReactNode, options: ProviderTreeOptions): ReactElement {
  let tree = children

  if (options.toaster !== false) {
    tree = (
      <>
        <Toaster position="bottom-right" />
        {tree}
      </>
    )
  }
  const hasAuth = options.auth !== false
  if (hasAuth && options.tts) tree = <TTSProvider>{tree}</TTSProvider>
  if (hasAuth && options.theme !== false) tree = <ThemeProvider>{tree}</ThemeProvider>
  if (hasAuth && options.events) tree = <EventProvider>{tree}</EventProvider>
  if (hasAuth) tree = <AuthProvider>{tree}</AuthProvider>
  if (options.serverId) tree = <OpenCodeServerProvider serverId={options.serverId}>{tree}</OpenCodeServerProvider>

  return (
    <QueryClientProvider client={options.queryClient}>
      <MemoryRouter initialEntries={options.initialEntries ?? [options.route ?? '/']}>
        {tree}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function setupTestEnvironment(options: TestProviderOptions): TestRenderResult {
  const auth = options.auth ?? 'authenticated'
  const fetchFake = createFetchFake([
    ...(options.fetchRoutes ?? []),
    ...defaultFetchRoutes(auth),
  ], options.fetchFallback ? { fallback: options.fetchFallback } : {})
  fetchFake.install()

  let eventStream: TestEventStreamTransport | undefined
  if (options.events) {
    eventStream = options.eventStream ?? new TestEventStreamTransport()
    openCodeEventStream.setTransport(eventStream)
  }

  return {
    queryClient: options.queryClient ?? createTestQueryClient(),
    fetchFake,
    eventStream,
  }
}

export function renderWithProviders(ui: ReactElement, options: TestProviderOptions = {}) {
  const environment = setupTestEnvironment(options)
  const result = render(buildProviderTree(ui, { ...options, queryClient: environment.queryClient }))
  return { ...result, ...environment }
}

export function renderHookWithProviders<T>(hook: () => T, options: TestProviderOptions = {}) {
  const environment = setupTestEnvironment(options)
  const queryClient = environment.queryClient
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return buildProviderTree(children, { ...options, queryClient })
  }
  const result = renderHook(hook, { wrapper })
  return { ...result, ...environment }
}

export async function connectTestEventStream(eventStream: TestEventStreamTransport | undefined): Promise<void> {
  if (!eventStream) throw new Error('connectTestEventStream requires events: true')
  await waitFor(() => expect(eventStream.openedUrls.length).toBeGreaterThan(0))
  await act(async () => {
    eventStream.connected()
  })
  await act(async () => {
    await Promise.resolve()
  })
}
