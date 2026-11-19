import { beforeEach, describe, expect, it } from 'vitest'
import { useState, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, dehydrate } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describeUserAgent } from '@opencode-manager/shared/utils'
import { PAIRING_CODE_INVALID_MESSAGE } from '@opencode-manager/shared/schemas'
import { authClient } from '@/lib/auth-client'
import { createFetchFake, type FetchFake, type FetchRoute } from '@/test/fetchFake'
import { installPasskeyAuthenticator } from '@/test/browserFakes'
import { makeAuthConfig, makeAuthSession, type AuthSessionFixture } from '@/test/fixtures/api'
import { LocationCatcher } from '@/test/test-components'
import { AuthProvider } from './AuthContext'
import { QueryCachePersistenceProvider } from './QueryCachePersistenceContext'
import { useAuth } from '@/hooks/useAuth'
import { QUERY_CACHE_STORAGE_KEY, queryCacheBuster } from '@/lib/queryPersistence'
import { STORED_AUTH_USER_KEY } from '@/lib/authSession'

type AuthValue = ReturnType<typeof useAuth>

type FixtureUser = AuthSessionFixture['user']

const STORED_USER: FixtureUser = { id: 'user-1', email: 'user@example.com', name: 'Ada' }
const pairingCode = 'a'.repeat(43)

interface SessionState {
  user: FixtureUser | null
}

interface AuthHarnessOptions {
  sessionRoute?: FetchRoute['respond']
  extraRoutes?: FetchRoute[]
  persistence?: boolean
}

interface AuthHarness {
  capturedPathname: { current: string }
  capturedSearch: { current: string }
  captured: { current: AuthValue | null }
  queryClient: QueryClient
  fetchFake: FetchFake
  session: SessionState
}

interface ValueRef<T> {
  current: T
}

function authRoutes(state: SessionState): FetchRoute[] {
  const signIn = () => {
    state.user = STORED_USER
    return { json: makeAuthSession({ user: STORED_USER }) }
  }
  return [
    {
      method: 'GET',
      path: '/api/auth/get-session',
      respond: () => ({ json: state.user ? makeAuthSession({ user: state.user }) : null }),
    },
    {
      method: 'GET',
      path: '/api/auth-info/config',
      respond: () => ({ json: makeAuthConfig({ enabledProviders: ['credentials', 'passkey'] }) }),
    },
    { method: 'POST', path: '/api/auth/sign-in/email', respond: signIn },
    { method: 'POST', path: '/api/auth/sign-up/email', respond: signIn },
    {
      method: 'POST',
      path: '/api/auth/sign-in/social',
      respond: () => ({ json: { url: 'https://github.example.com', redirect: true } }),
    },
    {
      method: 'GET',
      path: '/api/auth/passkey/generate-authenticate-options',
      respond: () => ({ json: { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost', allowCredentials: [] } }),
    },
    { method: 'POST', path: '/api/auth/passkey/verify-authentication', respond: signIn },
    {
      method: 'POST',
      path: '/api/auth/sign-out',
      respond: () => {
        state.user = null
        return { json: {} }
      },
    },
  ]
}

function AuthProbe({ captured }: { captured: { current: AuthValue | null } }) {
  const auth = useAuth()
  const [error, setError] = useState<string | null>(null)
  captured.current = auth

  const pair = async () => {
    const result = await auth.signInWithPairingCode(pairingCode)
    setError(result.error ?? null)
  }

  return (
    <>
      <button type="button" onClick={pair}>
        Pair
      </button>
      {error ? <p>{error}</p> : null}
    </>
  )
}

function renderAuth(initialEntry: string, options: AuthHarnessOptions = {}): AuthHarness {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const captured: ValueRef<AuthValue | null> = { current: null }
  const queryClient = new QueryClient()
  const session: SessionState = { user: null }

  const routes: FetchRoute[] = []
  if (options.sessionRoute) {
    routes.push({ method: 'GET', path: '/api/auth/get-session', respond: options.sessionRoute })
  }
  routes.push(...(options.extraRoutes ?? []), ...authRoutes(session))
  const fetchFake = createFetchFake(routes)
  fetchFake.install()

  const probe = <AuthProbe captured={captured} />
  const content: ReactNode = options.persistence
    ? <QueryCachePersistenceProvider persistThrottleMs={0}>{probe}</QueryCachePersistenceProvider>
    : probe

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
        <Routes>
          <Route path="/login" element={<AuthProvider>{content}</AuthProvider>} />
          <Route path="/repos/1" element={<div>repos marker</div>} />
          <Route path="/repos/:id" element={<div>repo marker</div>} />
          <Route path="/" element={<div>home marker</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { capturedPathname, capturedSearch, captured, queryClient, fetchFake, session }
}

async function pair() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Pair' }))
}

beforeEach(() => {
  authClient.$store.notify('$sessionSignal')
})

describe('AuthProvider post-login navigation', () => {
  it('returns to the requested page after signing in with a password', async () => {
    const { captured, capturedPathname, capturedSearch } = renderAuth('/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces')

    await captured.current?.signInWithEmail('user@example.com', 'password')

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/repos/2')
    })
    expect(capturedSearch.current).toBe('?tab=workspaces')
  })

  it('falls back to the app root for an unsafe redirect target', async () => {
    const { captured, capturedPathname } = renderAuth('/login?redirect=%2F%2Fevil.example.com')

    await captured.current?.signInWithEmail('user@example.com', 'password')

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/')
    })
  })

  it('returns to the requested page after signing in with a passkey', async () => {
    installPasskeyAuthenticator()
    const { captured, capturedPathname, capturedSearch, fetchFake } = renderAuth('/login?redirect=%2Frepos%2F7')

    await captured.current?.signInWithPasskey()

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/repos/7')
    })
    expect(capturedSearch.current).toBe('')
    expect(fetchFake.findRequests('POST', '/api/auth/passkey/verify-authentication')).toHaveLength(1)
  })

  it('sends the redirect target as the OAuth callback URL', async () => {
    const { captured, fetchFake } = renderAuth('/login?redirect=%2Frepos%2F3%3Ftab%3Dworkspaces')

    await captured.current?.signInWithProvider('github')

    expect(fetchFake.lastRequest('POST', '/api/auth/sign-in/social')?.body).toMatchObject({
      provider: 'github',
      callbackURL: '/repos/3?tab=workspaces',
    })
  })

  it('lands on the app root without a redirect target', async () => {
    const { captured, capturedPathname } = renderAuth('/login')

    await captured.current?.signInWithEmail('user@example.com', 'password')

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/')
    })
  })
})

describe('AuthProvider signInWithPairingCode', () => {
  const redeemRoute = (respond: FetchRoute['respond']): FetchRoute => ({
    method: 'POST',
    path: '/api/auth/device-pairing/redeem',
    respond,
  })

  it('redeems the code with the described device and returns to the redirect target', async () => {
    const { fetchFake } = renderAuth('/login?redirect=%2Frepos%2F1', {
      extraRoutes: [
        redeemRoute(() => ({ json: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } } })),
      ],
    })

    await pair()

    expect(await screen.findByText('repos marker')).toBeInTheDocument()
    expect(fetchFake.lastRequest('POST', '/api/auth/device-pairing/redeem')?.body).toEqual({
      code: pairingCode,
      deviceName: describeUserAgent(navigator.userAgent),
    })
    expect(fetchFake.findRequests('GET', '/api/auth/get-session').length).toBeGreaterThan(1)
  })

  it('lands home without a redirect target', async () => {
    renderAuth('/login', {
      extraRoutes: [redeemRoute(() => ({ json: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } } }))],
    })

    await pair()

    expect(await screen.findByText('home marker')).toBeInTheDocument()
  })

  it('shows the server message when the code expired or was already used', async () => {
    const { fetchFake } = renderAuth('/login?redirect=%2Frepos%2F1', {
      extraRoutes: [redeemRoute(() => ({ status: 400, json: { error: PAIRING_CODE_INVALID_MESSAGE } }))],
    })

    await pair()

    expect(await screen.findByText(PAIRING_CODE_INVALID_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('repos marker')).not.toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/auth/get-session')).toHaveLength(1)
  })

  it('shows the rate-limit message for a 429', async () => {
    const { fetchFake } = renderAuth('/login', {
      extraRoutes: [redeemRoute(() => ({ status: 429, json: { error: 'Too many attempts' } }))],
    })

    await pair()

    expect(await screen.findByText('Too many attempts. Wait a minute and try again.')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/auth/get-session')).toHaveLength(1)
  })
})

describe('AuthProvider session restore', () => {
  it('stores the validated user for the next cold start', async () => {
    const { captured } = renderAuth('/login', {
      sessionRoute: () => ({ json: makeAuthSession({ user: STORED_USER }) }),
    })

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))
    expect(JSON.parse(localStorage.getItem(STORED_AUTH_USER_KEY) ?? '')).toEqual(STORED_USER)
  })

  it('treats a transient session failure as signed in with the stored user', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const { captured } = renderAuth('/login', {
      sessionRoute: () => {
        throw new TypeError('Failed to fetch')
      },
    })

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))
    expect(captured.current?.user).toEqual(STORED_USER)
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).not.toBeNull()
  })

  it('keeps the stored user while the session is still loading', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const { captured } = renderAuth('/login', {
      sessionRoute: () => new Promise<never>(() => undefined),
    })

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))
    expect(captured.current?.isLoading).toBe(false)
  })

  it.each([
    ['a 401 response', () => ({ status: 401, json: { error: 'Unauthorized' } })],
    ['a successful response without a user', () => ({ json: null })],
  ])('clears the stored user on %s', async (_label, sessionRoute) => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const { captured } = renderAuth('/login', { sessionRoute })

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(false))
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
  })

  it('clears the stored user on logout and leaves the cache teardown to its owner', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const { captured, fetchFake } = renderAuth('/login')

    await act(async () => {
      await captured.current?.logout()
    })

    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
    expect(captured.current?.isAuthenticated).toBe(false)
    expect(fetchFake.findRequests('POST', '/api/auth/sign-out')).toHaveLength(1)
  })

  it('signs out and clears the persisted cache when sign-out fails offline', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const seededClient = new QueryClient()
    seededClient.setQueryData(['repos'], [{ id: 1 }])
    localStorage.setItem(QUERY_CACHE_STORAGE_KEY, JSON.stringify({
      buster: queryCacheBuster(STORED_USER.id),
      timestamp: Date.now(),
      clientState: dehydrate(seededClient),
    }))

    const { captured } = renderAuth('/login', {
      persistence: true,
      sessionRoute: () => ({ json: makeAuthSession({ user: STORED_USER }) }),
      extraRoutes: [
        {
          method: 'POST',
          path: '/api/auth/sign-out',
          respond: () => {
            throw new TypeError('Failed to fetch')
          },
        },
      ],
    })
    await waitFor(() => expect(localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).not.toBeNull())

    await act(async () => {
      await captured.current?.logout()
    })

    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(false))
    await waitFor(() => expect(localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull())
  })

  it.each([
    ['removes the stored user', () => localStorage.removeItem(STORED_AUTH_USER_KEY)],
    ['switches the stored user', () => localStorage.setItem(
      STORED_AUTH_USER_KEY,
      JSON.stringify({ id: 'user-2', email: 'two@example.com', name: 'Grace' }),
    )],
  ])('signs out when another tab %s', async (_label, changeStoredUser) => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const { captured, fetchFake } = renderAuth('/login', {
      sessionRoute: () => ({ json: makeAuthSession({ user: STORED_USER }) }),
    })
    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))

    act(() => {
      changeStoredUser()
      window.dispatchEvent(new StorageEvent('storage', { key: STORED_AUTH_USER_KEY }))
    })

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(false))
    expect(fetchFake.findRequests('POST', '/api/auth/sign-out')).toHaveLength(1)
  })
})
