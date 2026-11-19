import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { PAIRING_CODE_INVALID_MESSAGE } from '@opencode-manager/shared/schemas'
import { Pair } from '../Pair'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'


const code = 'a'.repeat(43)

interface PairRenderOptions {
  auth?: TestAuthMode
  redeem?: FetchRoute['respond']
}

function renderPair(options: PairRenderOptions = {}) {
  const routes: FetchRoute[] = []
  if (options.redeem) {
    routes.push({ method: 'POST', path: '/api/auth/device-pairing/redeem', respond: options.redeem })
  }
  return renderWithProviders(
    <Routes>
      <Route path="/pair" element={<Pair />} />
      <Route path="/" element={<div>home marker</div>} />
    </Routes>,
    {
      route: '/pair',
      auth: options.auth,
      fetchRoutes: routes,
    },
  )
}

function storePairingCodeInUrl(pairingCode: string = code) {
  window.history.replaceState(null, '', `/pair#c=${pairingCode}`)
}

describe('Pair', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/pair')
  })

  it('redeems the code once, clears the hash and lands home', async () => {
    storePairingCodeInUrl()

    const { fetchFake } = renderPair({
      auth: 'anonymous',
      redeem: () => ({ json: { user: { id: 'u1', name: 'User', email: 'u@example.com' } } }),
    })

    expect(await screen.findByText('home marker')).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(fetchFake.findRequests('POST', '/api/auth/device-pairing/redeem')).toHaveLength(1)
    expect(fetchFake.lastRequest('POST', '/api/auth/device-pairing/redeem')?.body).toMatchObject({ code })
  })

  it('keeps an existing session without redeeming', async () => {
    storePairingCodeInUrl()

    const { fetchFake } = renderPair({ auth: 'authenticated' })

    expect(await screen.findByText('home marker')).toBeInTheDocument()
    expect(await screen.findByText('Already signed in')).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/auth/device-pairing/redeem')).toHaveLength(0)
    expect(window.location.hash).toBe('')
  })

  it.each([
    {
      name: 'an expired or used code',
      redeem: () => ({ status: 400, json: { error: PAIRING_CODE_INVALID_MESSAGE } }),
      message: PAIRING_CODE_INVALID_MESSAGE,
    },
    {
      name: 'a rate-limited redemption',
      redeem: () => ({ status: 429, json: { error: 'Too many requests' } }),
      message: 'Too many attempts. Wait a minute and try again.',
    },
  ])('shows the message and a sign-in link for $name', async ({ redeem, message }) => {
    storePairingCodeInUrl()

    renderPair({ auth: 'anonymous', redeem })

    expect(await screen.findByText(message)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    })
  })

  it('reports a missing code without redeeming', async () => {
    const { fetchFake } = renderPair({ auth: 'anonymous' })

    expect(await screen.findByText('No pairing code was found')).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/auth/device-pairing/redeem')).toHaveLength(0)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    })
  })
})
