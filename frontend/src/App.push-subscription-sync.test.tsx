import { describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  installMatchMedia,
  installNavigationRequest,
  installNotification,
  installServiceWorkerPushSubscription,
} from '@/test/browserFakes'
import { makeAuthConfig, makeAuthSession, makeSettingsResponse } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'

const routes: FetchRoute[] = [
  { method: 'GET', path: '/api/auth/get-session', respond: () => ({ json: makeAuthSession() }) },
  { method: 'GET', path: '/api/auth-info/config', respond: () => ({ json: makeAuthConfig() }) },
  { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse() }) },
  {
    method: 'POST',
    path: '/api/notifications/subscribe',
    respond: (request) => ({
      json: {
        subscription: {
          id: 1,
          userId: 'test-user',
          endpoint: request.body?.endpoint,
          p256dh: 'p256dh-key',
          auth: 'auth-secret',
          deviceName: null,
          createdAt: 1,
          lastUsedAt: null,
        },
      },
    }),
  },
  { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
  { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [] } }) },
  { method: 'GET', path: '/api/opencode/api/session/active', respond: () => ({ json: { data: {} } }) },
  { method: 'GET', path: '/api/opencode/api/permission/request', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/form', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/shell', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: /^\/api\//, respond: () => ({ json: {} }) },
]

describe('AppShell', () => {
  it('syncs the registered push subscription once in the authenticated shell', async () => {
    installNavigationRequest()
    installMatchMedia(false)
    installNotification('granted')
    const subscription = installServiceWorkerPushSubscription()
    const { AppShell } = await import('./App')

    const { fetchFake } = renderWithProviders(
      <TooltipProvider>
        <AppShell />
      </TooltipProvider>,
      { events: true, fetchRoutes: routes },
    )

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(1))
    const syncRequest = fetchFake.lastRequest('POST', '/api/notifications/subscribe')
    expect(syncRequest?.body).toMatchObject({ endpoint: subscription.endpoint, keys: subscription.keys })
  }, 20000)
})
