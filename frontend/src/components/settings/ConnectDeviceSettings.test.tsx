import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DevicePairingAvailability, DevicePairingLinksResponse } from '@opencode-manager/shared/schemas'
import { ConnectDeviceSettings } from './ConnectDeviceSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const UNAVAILABLE_MESSAGE =
  'This page is open on localhost, which other devices cannot reach. Open the Manager at its public or LAN address to pair a device.'

const LINKS: DevicePairingLinksResponse = {
  appLink: 'ocm://link?v=2&kind=manager&name=studio&url=https%3A%2F%2Fstudio.example.com&code=abcdefghijklmnop',
  appLinkBlockedReason: null,
  browserLink: 'https://studio.example.com/pair#c=abcdefghijklmnop',
  expiresAt: new Date(Date.now() + 179_000).toISOString(),
  headerNames: [],
  warnings: [],
}

interface RenderOptions {
  availability?: () => FetchRouteResult | Promise<FetchRouteResult>
  preferences?: Parameters<typeof createSettingsServer>[0]
}

function renderSettings(options: RenderOptions = {}) {
  const settings = createSettingsServer({ devicePairing: { allowPrivateNetworkHttp: false }, ...options.preferences })
  const fetchRoutes: FetchRoute[] = [
    ...settings.routes,
    {
      method: 'GET',
      path: '/api/device-pairing/availability',
      respond: options.availability ?? (() => ({ json: { available: true, reason: null, message: null } satisfies DevicePairingAvailability })),
    },
    { method: 'POST', path: '/api/device-pairing/links', respond: () => ({ json: LINKS }) },
  ]
  return renderWithProviders(<ConnectDeviceSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
}

describe('ConnectDeviceSettings', () => {
  it('persists the private-network plain-HTTP preference', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings()

    await user.click(
      screen.getByRole('switch', { name: 'Allow plain-HTTP app links on private networks' }),
    )

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toEqual({
      preferences: { devicePairing: { allowPrivateNetworkHttp: true } },
    })
  })

  it('opens the pairing dialog from the QR code button', async () => {
    const user = userEvent.setup()
    renderSettings()

    const button = screen.getByRole('button', { name: 'Show QR code' })
    await vi.waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(await screen.findByAltText('Mobile app pairing QR code')).toBeInTheDocument()
  })

  it('disables the QR code button while availability loads', async () => {
    renderSettings({ availability: () => new Promise<FetchRouteResult>(() => undefined) })

    expect(screen.getByRole('button', { name: 'Show QR code' })).toBeDisabled()
  })

  it('disables the QR code button and shows the reason when pairing is unavailable', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings({
      availability: () => ({ json: { available: false, reason: 'loopback', message: UNAVAILABLE_MESSAGE } }),
    })

    const button = screen.getByRole('button', { name: 'Show QR code' })
    await screen.findByText(UNAVAILABLE_MESSAGE)
    expect(button).toBeDisabled()

    await user.click(button)

    expect(screen.queryByAltText('Mobile app pairing QR code')).not.toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/device-pairing/links')).toHaveLength(0)
  })

  it('keeps the QR code button enabled when the availability check fails', async () => {
    renderSettings({
      availability: () => {
        throw new Error('availability failed')
      },
    })

    const button = screen.getByRole('button', { name: 'Show QR code' })
    await vi.waitFor(() => expect(button).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
