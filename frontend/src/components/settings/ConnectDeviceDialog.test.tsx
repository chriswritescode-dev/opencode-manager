import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DevicePairingLinksResponse } from '@opencode-manager/shared/schemas'
import { ConnectDeviceDialog } from './ConnectDeviceDialog'

const mocks = vi.hoisted(() => ({
  createDevicePairingLinks: vi.fn(),
}))

vi.mock('@/api/devicePairing', () => ({
  createDevicePairingLinks: mocks.createDevicePairingLinks,
}))

const BASE_LINKS: DevicePairingLinksResponse = {
  appLink: 'ocm://link?v=2&kind=manager&name=studio&url=https%3A%2F%2Fstudio.example.com&code=abcdefghijklmnop',
  appLinkBlockedReason: null,
  browserLink: 'https://studio.example.com/pair#c=abcdefghijklmnop',
  expiresAt: new Date(Date.now() + 179_000).toISOString(),
  headerNames: ['CF-Access-Client-Id', 'CF-Access-Client-Secret'],
  warnings: ['plain-http'],
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectDeviceDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('ConnectDeviceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDevicePairingLinks.mockResolvedValue(BASE_LINKS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests pairing links once when it opens', async () => {
    renderDialog()

    await screen.findByAltText('Mobile app pairing QR code')

    expect(mocks.createDevicePairingLinks).toHaveBeenCalledTimes(1)
  })

  it('hides the mobile app QR code until it is revealed', async () => {
    const user = userEvent.setup()
    renderDialog()

    const qrCode = await screen.findByAltText('Mobile app pairing QR code')
    expect(qrCode).toHaveClass('blur-md')

    await user.click(screen.getByRole('button', { name: 'Reveal QR code' }))

    expect(qrCode).not.toHaveClass('blur-md')
  })

  it('warns about screen sharing and names the included headers', async () => {
    renderDialog()

    expect(
      await screen.findByText(
        "This QR code contains your remote access headers. Don't show it while screen sharing or recording.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Includes headers: CF-Access-Client-Id, CF-Access-Client-Secret'),
    ).toBeInTheDocument()
  })

  it('shows the browser sign-in QR code on the browser tab', async () => {
    const user = userEvent.setup()
    renderDialog()

    await screen.findByAltText('Mobile app pairing QR code')
    await user.click(screen.getByRole('tab', { name: 'Browser / PWA' }))

    expect(await screen.findByAltText('Browser sign-in QR code')).toBeInTheDocument()
  })

  it('explains a loopback block without showing the mobile app QR code', async () => {
    mocks.createDevicePairingLinks.mockResolvedValue({
      ...BASE_LINKS,
      appLink: null,
      appLinkBlockedReason: 'loopback',
      warnings: ['plain-http', 'loopback'],
    })
    renderDialog()

    expect(
      await screen.findByText(
        'This page is open on localhost, which your phone cannot reach. Open the Manager at its public or LAN address to show the app QR code.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByAltText('Mobile app pairing QR code')).not.toBeInTheDocument()
    expect(
      screen.getByText('This address uses plain HTTP, so the sign-in code travels unencrypted.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This address is localhost; other devices cannot reach it.'),
    ).toBeInTheDocument()
  })

  it('explains how to unblock a plain-HTTP app link', async () => {
    mocks.createDevicePairingLinks.mockResolvedValue({
      ...BASE_LINKS,
      appLink: null,
      appLinkBlockedReason: 'insecure-origin',
      warnings: ['plain-http'],
    })
    renderDialog()

    expect(
      await screen.findByText(
        "The mobile app QR code needs HTTPS. Use an HTTPS address, or turn on 'Allow plain-HTTP app links on private networks' if this Manager uses a private IP address.",
      ),
    ).toBeInTheDocument()
  })

  it('warns when the stored remote access headers are unreadable', async () => {
    mocks.createDevicePairingLinks.mockResolvedValue({
      ...BASE_LINKS,
      headerNames: [],
      warnings: ['plain-http', 'headers-unreadable'],
    })
    renderDialog()

    expect(
      await screen.findByText(
        'Stored remote access headers could not be decrypted and are not included.',
      ),
    ).toBeInTheDocument()
  })

  it('counts down and requests a new link after it expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    renderDialog()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('Expires in 3:00')).toBeInTheDocument()
    expect(mocks.createDevicePairingLinks).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })

    expect(mocks.createDevicePairingLinks).toHaveBeenCalledTimes(2)
  })

  it('times expiry on the client clock when the client clock is ahead of the server', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mocks.createDevicePairingLinks.mockImplementation(async () => ({
      ...BASE_LINKS,
      expiresAt: new Date(Date.now() - 600_000).toISOString(),
    }))

    renderDialog()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mocks.createDevicePairingLinks).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(mocks.createDevicePairingLinks).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Expires in 2:55')).toBeInTheDocument()
  })

  it('stops the countdown while the links are loading and after a failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    let rejectRequest: ((error: Error) => void) | undefined
    mocks.createDevicePairingLinks.mockImplementation(
      () =>
        new Promise<DevicePairingLinksResponse>((_resolve, reject) => {
          rejectRequest = reject
        }),
    )

    renderDialog()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByText('Creating a pairing code…')).toBeInTheDocument()
    expect(screen.queryByText(/^Expires in/)).not.toBeInTheDocument()

    await act(async () => {
      rejectRequest?.(new Error('Failed to create pairing links'))
      await vi.advanceTimersByTimeAsync(65_000)
    })

    expect(screen.getByText('Failed to create pairing links')).toBeInTheDocument()
    expect(screen.queryByText(/^Expires in/)).not.toBeInTheDocument()
    expect(mocks.createDevicePairingLinks).toHaveBeenCalledTimes(1)
  })

  it('shows a failed request with a retry button', async () => {
    const user = userEvent.setup()
    mocks.createDevicePairingLinks.mockRejectedValueOnce(new Error('Failed to create pairing links'))
    renderDialog()

    expect(await screen.findByText('Failed to create pairing links')).toBeInTheDocument()

    mocks.createDevicePairingLinks.mockResolvedValueOnce(BASE_LINKS)
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByAltText('Mobile app pairing QR code')).toBeInTheDocument()
  })
})
