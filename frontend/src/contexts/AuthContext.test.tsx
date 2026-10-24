import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocationCatcher } from '@/test/test-utils'
import { AuthProvider } from './AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { QUERY_CACHE_STORAGE_KEY } from '@/lib/queryPersistence'
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

function renderAuth(initialEntry: string) {
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
                <AuthProbe captured={captured} />
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

  it('clears the stored user, the persisted cache and the query cache on logout', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER))
    localStorage.setItem(QUERY_CACHE_STORAGE_KEY, '{}')
    const { captured, queryClient } = renderAuth('/login')
    const clearSpy = vi.spyOn(queryClient, 'clear')
    queryClient.setQueryData(['repos'], [{ id: 1 }])
    mocks.signOut.mockImplementation(async (options: { fetchOptions?: { onSuccess?: () => void } }) => {
      options.fetchOptions?.onSuccess?.()
      return { data: null }
    })

    await captured.current?.logout()

    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
    expect(localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
    expect(clearSpy).toHaveBeenCalled()
  })
})
