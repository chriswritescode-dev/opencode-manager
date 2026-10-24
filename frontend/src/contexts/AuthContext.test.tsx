import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describeUserAgent } from '@opencode-manager/shared/utils'
import { PAIRING_CODE_INVALID_MESSAGE } from '@opencode-manager/shared/schemas'
import { FetchError } from '@/api/fetchWrapper'
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
  redeemDevicePairingCode: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: mocks.useSession,
  signIn: { email: mocks.signInEmail, social: mocks.signInSocial },
  signUp: { email: mocks.signUpEmail },
  signOut: mocks.signOut,
  authClient: { signIn: { passkey: mocks.signInPasskey }, passkey: { addPasskey: vi.fn() } },
}))

vi.mock('@/api/devicePairing', () => ({
  redeemDevicePairingCode: mocks.redeemDevicePairingCode,
}))

type AuthValue = ReturnType<typeof useAuth>

const pairingCode = 'a'.repeat(43)

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

function PairingSignIn() {
  const { signInWithPairingCode } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const result = await signInWithPairingCode(pairingCode)
    setError(result.error ?? null)
  }

  return (
    <>
      <button type="button" onClick={submit}>
        Pair
      </button>
      {error && <p>{error}</p>}
    </>
  )
}

function renderPairing(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PairingSignIn />} />
          <Route path="/repos/1" element={<div>repos marker</div>} />
          <Route path="/" element={<div>home marker</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function pair() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Pair' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useSession.mockReturnValue({ data: null, isPending: false, refetch: mocks.refetch })
  mocks.refetch.mockResolvedValue(undefined)
  mocks.signInEmail.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.signInPasskey.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.signInSocial.mockResolvedValue({ data: { url: 'https://github.example.com' } })
  mocks.signUpEmail.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.redeemDevicePairingCode.mockResolvedValue({ user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ enabledProviders: ['credentials'], registrationEnabled: true, isFirstUser: false, adminConfigured: true }),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
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

describe('AuthProvider signInWithPairingCode', () => {
  it('redeems the code with the described device and returns to the redirect target', async () => {
    renderPairing('/login?redirect=%2Frepos%2F1')

    await pair()

    expect(await screen.findByText('repos marker')).toBeInTheDocument()
    expect(mocks.redeemDevicePairingCode).toHaveBeenCalledWith({
      code: pairingCode,
      deviceName: describeUserAgent(navigator.userAgent),
    })
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('lands home without a redirect target', async () => {
    renderPairing('/login')

    await pair()

    expect(await screen.findByText('home marker')).toBeInTheDocument()
  })

  it('shows the server message when the code expired or was already used', async () => {
    mocks.redeemDevicePairingCode.mockRejectedValue(
      new FetchError(PAIRING_CODE_INVALID_MESSAGE, 400, 'PAIRING_CODE_INVALID'),
    )
    renderPairing('/login?redirect=%2Frepos%2F1')

    await pair()

    expect(await screen.findByText(PAIRING_CODE_INVALID_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('repos marker')).not.toBeInTheDocument()
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it('shows the rate-limit message for a 429', async () => {
    mocks.redeemDevicePairingCode.mockRejectedValue(
      new FetchError('Too many attempts', 429, 'RATE_LIMITED'),
    )
    renderPairing('/login')

    await pair()

    expect(
      await screen.findByText('Too many attempts. Wait a minute and try again.'),
    ).toBeInTheDocument()
    expect(mocks.refetch).not.toHaveBeenCalled()
  })
})
