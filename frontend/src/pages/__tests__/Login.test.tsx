import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  buildManagerBrowserPairingLink,
  PAIRING_CODE_INVALID_MESSAGE,
} from '@opencode-manager/shared/schemas'
import { Login } from '../Login'
import { AuthProvider } from '@/contexts/AuthContext'
import { createFetchFake, type FetchRoute } from '@/test/fetchFake'
import { createTestQueryClient } from '@/test/render'
import { installQrScanner } from '@/test/browserFakes'
import { makeAuthConfig, makeAuthSession } from '@/test/fixtures/api'
import type { AuthConfigFixture } from '@/test/fixtures/api'

const code = 'a'.repeat(43)

class NavigationRequest {
  url: string
  method: string
  headers: Headers
  signal: AbortSignal

  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = input.toString()
    this.method = init.method ?? 'GET'
    this.headers = new Headers(init.headers)
    this.signal = new AbortController().signal
  }
}

function installNavigationRequestStub() {
  vi.stubGlobal('Request', NavigationRequest)
}

interface LoginRenderOptions {
  config?: AuthConfigFixture
  redeem?: FetchRoute['respond']
}

function renderLogin(options: LoginRenderOptions = {}) {
  installNavigationRequestStub()
  const config = options.config ?? makeAuthConfig({ enabledProviders: ['credentials', 'passkey'] })
  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/auth/get-session', respond: () => ({ json: makeAuthSession() }) },
    { method: 'GET', path: '/api/auth-info/config', respond: () => ({ json: config }) },
  ]
  if (options.redeem) {
    routes.push({ method: 'POST', path: '/api/auth/device-pairing/redeem', respond: options.redeem })
  }
  const fetchFake = createFetchFake(routes)
  fetchFake.install()
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <div>home marker</div>,
        hydrateFallbackElement: <p>Hydrating login</p>,
      },
      {
        path: '/login',
        element: (
          <AuthProvider>
            <Login />
          </AuthProvider>
        ),
        loader: () => ({ config }),
        hydrateFallbackElement: <p>Hydrating login</p>,
      },
    ],
    { initialEntries: ['/login'] },
  )
  return {
    fetchFake,
    ...render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  }
}

async function scanQrCode(text: string) {
  const user = userEvent.setup()
  const scanner = installQrScanner(text)
  await user.click(await screen.findByRole('button', { name: 'Sign in with QR code' }))
  await scanner.scan()
}

describe('Login', () => {
  beforeEach(() => {
    installNavigationRequestStub()
  })

  it('starts a QR scan from the sign-in button', async () => {
    const user = userEvent.setup()
    renderLogin()

    expect(screen.queryByText('Scan sign-in QR code')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Sign in with QR code' }))

    expect(await screen.findByText('Scan sign-in QR code')).toBeInTheDocument()
    expect(screen.getByLabelText('QR code scanner preview')).toBeInTheDocument()
  })

  it('redeems the code from a manager sign-in QR code', async () => {
    const { fetchFake } = renderLogin({
      redeem: () => ({ json: { user: { id: 'u1', name: 'User', email: 'u@example.com' } } }),
    })

    await scanQrCode(buildManagerBrowserPairingLink(window.location.origin, code))

    await waitFor(() => {
      expect(fetchFake.findRequests('POST', '/api/auth/device-pairing/redeem')).toHaveLength(1)
    })
    expect(fetchFake.lastRequest('POST', '/api/auth/device-pairing/redeem')?.body).toMatchObject({ code })
    expect(await screen.findByText('home marker')).toBeInTheDocument()
  })

  it('rejects a QR code for another origin', async () => {
    const { fetchFake } = renderLogin()

    await scanQrCode(buildManagerBrowserPairingLink('https://other.example.com', code))

    expect(
      await screen.findByText(
        'This QR code is for https://other.example.com. Open that address to sign in.',
      ),
    ).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/auth/device-pairing/redeem')).toHaveLength(0)
  })

  it.each(['ocm://link?v=2&kind=manager&name=Desk', 'not a pairing link'])(
    'rejects text that is not a manager sign-in code: %s',
    async (text) => {
      const { fetchFake } = renderLogin()

      await scanQrCode(text)

      expect(
        await screen.findByText('That QR code is not a Manager sign-in code.'),
      ).toBeInTheDocument()
      expect(fetchFake.findRequests('POST', '/api/auth/device-pairing/redeem')).toHaveLength(0)
    },
  )

  it('shows the redeem error in the page alert', async () => {
    renderLogin({
      redeem: () => ({ status: 400, json: { error: PAIRING_CODE_INVALID_MESSAGE } }),
    })

    await scanQrCode(buildManagerBrowserPairingLink(window.location.origin, code))

    expect(await screen.findByText(PAIRING_CODE_INVALID_MESSAGE)).toBeInTheDocument()
  })
})
