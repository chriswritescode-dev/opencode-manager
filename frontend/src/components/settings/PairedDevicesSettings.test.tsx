import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import type { PairedDevice } from '@opencode-manager/shared/schemas'
import { PairedDevicesSettings } from './PairedDevicesSettings'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const revokeRequestSchema = z.object({ id: z.string() })

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

interface DevicesServerOptions {
  devices?: PairedDevice[]
  revoke?: () => void
}

function renderSettings(options: DevicesServerOptions = {}) {
  let devices = options.devices ?? [CURRENT_DEVICE]
  const fetchRoutes: FetchRoute[] = [
    { method: 'GET', path: '/api/auth/device-pairing/devices', respond: () => ({ json: { devices } }) },
    {
      method: 'POST',
      path: '/api/auth/device-pairing/devices/revoke',
      respond: (request) => {
        if (options.revoke) options.revoke()
        const body = revokeRequestSchema.parse(request.body)
        devices = devices.filter((device) => device.id !== body.id)
        return { status: 200 }
      },
    },
  ]
  return renderWithProviders(<PairedDevicesSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
}

describe('PairedDevicesSettings', () => {
  it('shows the device name when one is set', async () => {
    renderSettings()

    expect(await screen.findByText('Chris MacBook')).toBeInTheDocument()
  })

  it('shows when the device signed in', async () => {
    renderSettings({ devices: [{ ...CURRENT_DEVICE, ipAddress: null }] })

    expect(await screen.findByText(/^Signed in /)).toBeInTheDocument()
  })

  it('falls back to a user-agent label when the device has no name', async () => {
    renderSettings({ devices: [IPHONE_DEVICE] })

    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument()
  })

  it('marks the current device and hides its revoke button', async () => {
    renderSettings({ devices: [CURRENT_DEVICE] })

    expect(await screen.findByText('This device')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Revoke / })).not.toBeInTheDocument()
  })

  it('revokes a paired device after confirmation and refetches the list', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings({ devices: [CURRENT_DEVICE, IPHONE_DEVICE] })

    await user.click(await screen.findByRole('button', { name: 'Revoke Safari on iPhone' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/auth/device-pairing/devices/revoke')?.body).toEqual({
        id: 'session-iphone',
      }),
    )
    await waitFor(() =>
      expect(fetchFake.findRequests('GET', '/api/auth/device-pairing/devices')).toHaveLength(2),
    )
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument())
  })

  it('shows the error message when the revoke fails', async () => {
    const user = userEvent.setup()
    renderSettings({
      devices: [CURRENT_DEVICE, IPHONE_DEVICE],
      revoke: () => {
        throw new Error('This device is no longer paired')
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Revoke Safari on iPhone' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('This device is no longer paired')).toBeInTheDocument()
    expect(screen.getByText('Safari on iPhone')).toBeInTheDocument()
  })
})
