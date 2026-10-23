import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocationCatcher } from '@/test/test-utils'
import { AuthProvider } from './AuthContext'
import { useAuth } from '@/hooks/useAuth'

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

function AuthProbe({ captured }: { captured: { current: AuthValue | null } }) {
  captured.current = useAuth()
  return null
}

function renderAuth(initialEntry: string) {
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  const captured: { current: AuthValue | null } = { current: null }

  render(
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
    </MemoryRouter>,
  )

  return { capturedPathname, capturedSearch, captured }
}

describe('AuthProvider post-login navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSession.mockReturnValue({ data: null, isPending: false, refetch: mocks.refetch })
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
