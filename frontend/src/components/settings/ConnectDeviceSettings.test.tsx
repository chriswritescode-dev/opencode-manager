import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_USER_PREFERENCES } from '@opencode-manager/shared/schemas'
import { createUseSettingsMock } from '@/test/test-utils'
import { ConnectDeviceSettings } from './ConnectDeviceSettings'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  updateSettings: vi.fn(),
  createDevicePairingLinks: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/api/devicePairing', () => ({
  createDevicePairingLinks: mocks.createDevicePairingLinks,
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

    await user.click(screen.getByRole('button', { name: 'Show QR code' }))

    expect(await screen.findByAltText('Mobile app pairing QR code')).toBeInTheDocument()
  })
})
