import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PAIRING_CODE_INVALID_MESSAGE } from '@opencode-manager/shared/schemas'
import { Pair } from '../Pair'

const mocks = vi.hoisted(() => ({
  signInWithPairingCode: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/hooks/useAuth', async () => {
  const { useNavigate } = await import('react-router-dom')
  return {
    useAuth: () => {
      const navigate = useNavigate()
      return {
        signInWithPairingCode: async (code: string) => {
          const result = await mocks.signInWithPairingCode(code)
          if (!result.error) navigate('/', { replace: true })
          return result
        },
      }
    },
  }
})

const code = 'a'.repeat(43)

function renderPair() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/pair']}>
        <Routes>
          <Route path="/pair" element={<Pair />} />
          <Route path="/" element={<div>home marker</div>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
}

describe('Pair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/pair')
    mocks.getSession.mockResolvedValue({ data: null })
    mocks.signInWithPairingCode.mockResolvedValue({})
  })

  it('redeems once with the hash cleared first and lands home', async () => {
    window.history.replaceState(null, '', '/pair#c=' + code)
    mocks.signInWithPairingCode.mockImplementation(async () => {
      expect(window.location.hash).toBe('')
      return {}
    })

    renderPair()

    await screen.findByText('home marker')
    expect(window.location.hash).toBe('')
    expect(mocks.signInWithPairingCode).toHaveBeenCalledTimes(1)
    expect(mocks.signInWithPairingCode).toHaveBeenCalledWith(code)
    expect(mocks.getSession).toHaveBeenCalled()
  })

  it('keeps an existing session without redeeming', async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    window.history.replaceState(null, '', '/pair#c=' + code)

    renderPair()

    await screen.findByText('home marker')
    expect(mocks.signInWithPairingCode).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('shows the message and a sign-in link for an expired or used code', async () => {
    window.history.replaceState(null, '', '/pair#c=' + code)
    mocks.signInWithPairingCode.mockResolvedValue({ error: PAIRING_CODE_INVALID_MESSAGE })

    renderPair()

    expect(await screen.findByText(PAIRING_CODE_INVALID_MESSAGE)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    })
  })

  it('shows the rate-limit message for a 429', async () => {
    window.history.replaceState(null, '', '/pair#c=' + code)
    mocks.signInWithPairingCode.mockResolvedValue({
      error: 'Too many attempts. Wait a minute and try again.',
    })

    renderPair()

    expect(
      await screen.findByText('Too many attempts. Wait a minute and try again.'),
    ).toBeInTheDocument()
  })

  it('reports a missing code', async () => {
    renderPair()

    expect(await screen.findByText('No pairing code was found')).toBeInTheDocument()
    expect(mocks.signInWithPairingCode).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    })
  })
})
