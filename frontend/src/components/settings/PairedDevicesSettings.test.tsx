import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PairedDevice } from '@opencode-manager/shared/schemas'
import { PairedDevicesSettings } from './PairedDevicesSettings'

const mocks = vi.hoisted(() => ({
  listPairedDevices: vi.fn(),
  revokePairedDevice: vi.fn(),
}))

vi.mock('@/api/devicePairing', () => ({
  listPairedDevices: mocks.listPairedDevices,
  revokePairedDevice: mocks.revokePairedDevice,
}))

const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const CURRENT_DEVICE: PairedDevice = {
  id: 'session-current',
  deviceName: 'Chris MacBook',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ipAddress: '192.168.1.10',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  isCurrent: true,
}

const IPHONE_DEVICE: PairedDevice = {
  id: 'session-iphone',
  deviceName: null,
  userAgent: IPHONE_SAFARI_UA,
  ipAddress: '192.168.1.44',
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
  isCurrent: false,
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <PairedDevicesSettings />
    </QueryClientProvider>,
  )
}

describe('PairedDevicesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listPairedDevices.mockResolvedValue([CURRENT_DEVICE])
    mocks.revokePairedDevice.mockResolvedValue(undefined)
  })

  it('shows the device name when one is set', async () => {
    renderSettings()

    expect(await screen.findByText('Chris MacBook')).toBeInTheDocument()
  })

  it('shows when the device signed in', async () => {
    mocks.listPairedDevices.mockResolvedValue([{ ...CURRENT_DEVICE, ipAddress: null }])
    renderSettings()

    expect(await screen.findByText(/^Signed in /)).toBeInTheDocument()
  })

  it('falls back to a user-agent label when the device has no name', async () => {
    mocks.listPairedDevices.mockResolvedValue([IPHONE_DEVICE])
    renderSettings()

    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument()
  })

  it('marks the current device and hides its revoke button', async () => {
    mocks.listPairedDevices.mockResolvedValue([CURRENT_DEVICE])
    renderSettings()

    expect(await screen.findByText('This device')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Revoke / })).not.toBeInTheDocument()
  })

  it('revokes a paired device after confirmation and refetches the list', async () => {
    mocks.listPairedDevices.mockResolvedValue([CURRENT_DEVICE, IPHONE_DEVICE])
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('button', { name: 'Revoke Safari on iPhone' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mocks.revokePairedDevice).toHaveBeenCalledWith('session-iphone'))
    await waitFor(() => expect(mocks.listPairedDevices).toHaveBeenCalledTimes(2))
  })

  it('shows the error message when the revoke fails', async () => {
    mocks.listPairedDevices.mockResolvedValue([CURRENT_DEVICE, IPHONE_DEVICE])
    mocks.revokePairedDevice.mockRejectedValueOnce(new Error('This device is no longer paired'))
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('button', { name: 'Revoke Safari on iPhone' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('This device is no longer paired')).toBeInTheDocument()
  })
})
