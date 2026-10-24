import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, dehydrate } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocationCatcher } from '@/test/test-utils'
import { AuthProvider } from './AuthContext'
import { QueryCachePersistenceProvider } from './QueryCachePersistenceContext'
import { useAuth } from '@/hooks/useAuth'
import { QUERY_CACHE_STORAGE_KEY, queryCacheBuster } from '@/lib/queryPersistence'
import { STORED_AUTH_USER_KEY } from '@/lib/authSession'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  refetch: vi.fn(),
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signInPasskey: vi.fn(),
  signUpEmail: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: mocks.useSession,
  signIn: { email: mocks.signInEmail, social: mocks.signInSocial },
  signUp: { email: mocks.signUpEmail },
  signOut: mocks.signOut,
  authClient: { signIn: { passkey: mocks.signInPasskey } },
}))

type AuthValue = ReturnType<typeof useAuth>

const STORED_USER = { id: 'user-1', email: 'user@example.com', name: 'Ada' }

function renderAuth(initialEntry: string, options: { persistence?: boolean } = {}) {
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  const captured: { current: AuthValue | null } = { current: null }
  const queryClient = new QueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
        <Routes>
          <Route
            path="/login"
            element={(
              <AuthProvider>
                {options.persistence ? (
                  <QueryCachePersistenceProvider persistThrottleMs={0}>
                    <AuthProbe captured={captured} />
                  </QueryCachePersistenceProvider>
                ) : (
                  <AuthProbe captured={captured} />
                )}
              </AuthProvider>
            )}
          />
          <Route path="/" element={null} />
          <Route path="/repos/:id" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { capturedPathname, capturedSearch, captured, queryClient }
}

function AuthProbe({ captured }: { captured: { current: AuthValue | null } }) {
  captured.current = useAuth()
  return null
}

describe('AuthProvider post-login navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.useSession.mockReturnValue({ data: null, error: null, isPending: false, refetch: mocks.refetch })
    mocks.refetch.mockResolvedValue(undefined)
    mocks.signInEmail.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mocks.signInPasskey.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mocks.signInSocial.mockResolvedValue({ data: { url: 'https://github.example.com' } })
    mocks.signUpEmail.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabledProviders: ['credentials'], registrationEnabled: true, isFirstUser: false, adminConfigured: true }),
    }))
  })

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
    const { captured, capturedPathname, capturedSearch } = renderAuth('/login?redirect=%2Frepos%2F7')

    await captured.current?.signInWithPasskey()

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/repos/7')
    })
    expect(capturedSearch.current).toBe('')
  })

  it('sends the redirect target as the OAuth callback URL', async () => {
    const { captured } = renderAuth('/login?redirect=%2Frepos%2F3%3Ftab%3Dworkspaces')

    await captured.current?.signInWithProvider('github')

    expect(mocks.signInSocial).toHaveBeenCalledWith({
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

describe('AuthProvider session restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.useSession.mockReturnValue({ data: null, error: null, isPending: false, refetch: mocks.refetch })
    mocks.refetch.mockResolvedValue(undefined)
    mocks.signOut.mockResolvedValue({ data: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabledProviders: ['credentials'], registrationEnabled: true, isFirstUser: false, adminConfigured: true }),
    }))
  })

  it('stores the validated user for the next cold start', async () => {
    mocks.useSession.mockReturnValue({
      data: { user: STORED_USER },
      error: null,
      isPending: false,
      refetch: mocks.refetch,
    })

    const { captured } = renderAuth('/login')

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))
    expect(JSON.parse(localStorage.getItem(STORED_AUTH_USER_KEY) ?? '')).toEqual(STORED_USER)
  })

  it('treats a transient session failure as signed in with the stored user', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    mocks.useSession.mockReturnValue({
      data: null,
      error: new TypeError('Failed to fetch'),
      isPending: false,
      refetch: mocks.refetch,
    })

    const { captured } = renderAuth('/login')

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))
    expect(captured.current?.user).toEqual(STORED_USER)
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).not.toBeNull()
  })

  it('keeps the stored user while the session is still loading', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    mocks.useSession.mockReturnValue({ data: null, error: null, isPending: true, refetch: mocks.refetch })

    const { captured } = renderAuth('/login')

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))
    expect(captured.current?.isLoading).toBe(false)
  })

  it.each([
    ['a 401 response', { status: 401, statusText: 'Unauthorized' }],
    ['a successful response without a user', null],
  ])('clears the stored user on %s', async (_label, error) => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    mocks.useSession.mockReturnValue({
      data: null,
      error,
      isPending: false,
      refetch: mocks.refetch,
    })

    const { captured } = renderAuth('/login')

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(false))
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
  })

  it('clears the stored user on logout and leaves the cache teardown to its owner', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    const { captured } = renderAuth('/login')
    mocks.signOut.mockImplementation(async (options: { fetchOptions?: { onSuccess?: () => void } }) => {
      options.fetchOptions?.onSuccess?.()
      return { data: null }
    })

    await act(async () => {
      await captured.current?.logout()
    })

    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
    expect(captured.current?.isAuthenticated).toBe(false)
    expect(mocks.signOut).toHaveBeenCalled()
  })

  it('signs out and clears the persisted cache when sign-out fails offline', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    mocks.useSession.mockReturnValue({
      data: { user: STORED_USER },
      error: null,
      isPending: false,
      refetch: mocks.refetch,
    })
    const seededClient = new QueryClient()
    seededClient.setQueryData(['repos'], [{ id: 1 }])
    localStorage.setItem(QUERY_CACHE_STORAGE_KEY, JSON.stringify({
      buster: queryCacheBuster(STORED_USER.id),
      timestamp: Date.now(),
      clientState: dehydrate(seededClient),
    }))
    mocks.signOut.mockRejectedValue(new TypeError('Failed to fetch'))

    const { captured } = renderAuth('/login', { persistence: true })
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
    mocks.useSession.mockReturnValue({
      data: { user: STORED_USER },
      error: null,
      isPending: false,
      refetch: mocks.refetch,
    })

    const { captured } = renderAuth('/login')
    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(true))

    act(() => {
      changeStoredUser()
      window.dispatchEvent(new StorageEvent('storage', { key: STORED_AUTH_USER_KEY }))
    })

    await waitFor(() => expect(captured.current?.isAuthenticated).toBe(false))
    expect(mocks.signOut).toHaveBeenCalled()
  })
})
