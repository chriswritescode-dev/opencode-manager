import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_USER_PREFERENCES } from '@opencode-manager/shared/schemas'
import { createUseSettingsMock } from '@/test/test-utils'
import { ConnectDeviceSettings } from './ConnectDeviceSettings'

const UNAVAILABLE_MESSAGE =
  'This page is open on localhost, which other devices cannot reach. Open the Manager at its public or LAN address to pair a device.'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  updateSettings: vi.fn(),
  createDevicePairingLinks: vi.fn(),
  getDevicePairingAvailability: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/api/devicePairing', () => ({
  createDevicePairingLinks: mocks.createDevicePairingLinks,
  getDevicePairingAvailability: mocks.getDevicePairingAvailability,
}))

function renderSettings() {
  mocks.useSettings.mockReturnValue(
    createUseSettingsMock({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        devicePairing: { allowPrivateNetworkHttp: false },
      },
      updateSettings: mocks.updateSettings,
    }),
  )

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectDeviceSettings />
    </QueryClientProvider>,
  )
}

describe('ConnectDeviceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDevicePairingLinks.mockResolvedValue({
      appLink: 'ocm://link?v=2&kind=manager&name=studio&url=https%3A%2F%2Fstudio.example.com&code=abcdefghijklmnop',
      appLinkBlockedReason: null,
      browserLink: 'https://studio.example.com/pair#c=abcdefghijklmnop',
      expiresAt: new Date(Date.now() + 179_000).toISOString(),
      headerNames: [],
      warnings: [],
    })
    mocks.getDevicePairingAvailability.mockResolvedValue({
      available: true,
      reason: null,
      message: null,
    })
  })

  it('persists the private-network plain-HTTP preference', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(
      screen.getByRole('switch', { name: 'Allow plain-HTTP app links on private networks' }),
    )

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      devicePairing: { allowPrivateNetworkHttp: true },
    })
  })

  it('opens the pairing dialog from the QR code button', async () => {
    const user = userEvent.setup()
    renderSettings()

    const button = screen.getByRole('button', { name: 'Show QR code' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(await screen.findByAltText('Mobile app pairing QR code')).toBeInTheDocument()
  })

  it('disables the QR code button while availability loads', async () => {
    mocks.getDevicePairingAvailability.mockReturnValue(new Promise(() => undefined))
    renderSettings()

    expect(screen.getByRole('button', { name: 'Show QR code' })).toBeDisabled()
  })

  it('disables the QR code button and shows the reason when pairing is unavailable', async () => {
    const user = userEvent.setup()
    mocks.getDevicePairingAvailability.mockResolvedValue({
      available: false,
      reason: 'loopback',
      message: UNAVAILABLE_MESSAGE,
    })
    renderSettings()

    const button = screen.getByRole('button', { name: 'Show QR code' })
    await screen.findByText(UNAVAILABLE_MESSAGE)
    expect(button).toBeDisabled()

    await user.click(button)

    expect(screen.queryByAltText('Mobile app pairing QR code')).not.toBeInTheDocument()
    expect(mocks.createDevicePairingLinks).not.toHaveBeenCalled()
  })

  it('keeps the QR code button enabled when the availability check fails', async () => {
    mocks.getDevicePairingAvailability.mockRejectedValue(new Error('availability failed'))
    renderSettings()

    const button = screen.getByRole('button', { name: 'Show QR code' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
