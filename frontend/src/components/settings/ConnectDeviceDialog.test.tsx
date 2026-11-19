import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DevicePairingLinksResponse } from '@opencode-manager/shared/schemas'
import { ConnectDeviceDialog } from './ConnectDeviceDialog'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const BASE_LINKS: DevicePairingLinksResponse = {
  appLink: 'ocm://link?v=2&kind=manager&name=studio&url=https%3A%2F%2Fstudio.example.com&code=abcdefghijklmnop',
  appLinkBlockedReason: null,
  browserLink: 'https://studio.example.com/pair#c=abcdefghijklmnop',
  expiresAt: new Date(Date.now() + 179_000).toISOString(),
  headerNames: ['CF-Access-Client-Id', 'CF-Access-Client-Secret'],
  warnings: ['plain-http'],
}

interface PairingLinkServerOptions {
  respond?: (call: number) => FetchRouteResult | Promise<FetchRouteResult>
}

function renderDialog(options: PairingLinkServerOptions = {}) {
  let calls = 0
  const linkRoute: FetchRoute = {
    method: 'POST',
    path: '/api/device-pairing/links',
    respond: async () => {
      calls += 1
      return options.respond ? options.respond(calls) : { json: BASE_LINKS }
    },
  }
  const result = renderWithProviders(<ConnectDeviceDialog open onOpenChange={vi.fn()} />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: [linkRoute],
  })
  return { ...result, linkRequests: () => calls }
}

describe('ConnectDeviceDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests pairing links once when it opens', async () => {
    const { linkRequests } = renderDialog()

    await screen.findByAltText('Mobile app pairing QR code')

    expect(linkRequests()).toBe(1)
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

  it('warns about a localhost address while still showing the mobile app QR code', async () => {
    renderDialog({ respond: () => ({ json: { ...BASE_LINKS, warnings: ['plain-http', 'loopback'] } }) })

    expect(await screen.findByAltText('Mobile app pairing QR code')).toBeInTheDocument()
    expect(
      screen.getByText('This address is localhost; other devices cannot reach it.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This address uses plain HTTP, so the sign-in code travels unencrypted.'),
    ).toBeInTheDocument()
  })

  it('explains how to unblock a plain-HTTP app link', async () => {
    renderDialog({
      respond: () => ({
        json: { ...BASE_LINKS, appLink: null, appLinkBlockedReason: 'insecure-origin', warnings: ['plain-http'] },
      }),
    })

    expect(
      await screen.findByText(
        "The mobile app QR code needs HTTPS. Use an HTTPS address, or turn on 'Allow plain-HTTP app links on private networks' if this Manager uses a private IP address.",
      ),
    ).toBeInTheDocument()
  })

  it('warns when the stored remote access headers are unreadable', async () => {
    renderDialog({
      respond: () => ({ json: { ...BASE_LINKS, headerNames: [], warnings: ['plain-http', 'headers-unreadable'] } }),
    })

    expect(
      await screen.findByText('Stored remote access headers could not be decrypted and are not included.'),
    ).toBeInTheDocument()
  })

  it('counts down and requests a new link after it expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const { linkRequests } = renderDialog()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('Expires in 3:00')).toBeInTheDocument()
    expect(linkRequests()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })

    expect(linkRequests()).toBe(2)
  })

  it('times expiry on the client clock when the client clock is ahead of the server', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    renderDialog({
      respond: () => ({ json: { ...BASE_LINKS, expiresAt: new Date(Date.now() - 600_000).toISOString() } }),
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByText('Expires in 2:55')).toBeInTheDocument()
  })

  it('stops the countdown while the links are loading and after a failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    let rejectRequest: ((error: Error) => void) | undefined
    const { linkRequests } = renderDialog({
      respond: () => new Promise<FetchRouteResult>((_resolve, reject) => { rejectRequest = reject }),
    })

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
    expect(linkRequests()).toBe(1)
  })

  it('shows a failed request with a retry button', async () => {
    const user = userEvent.setup()
    renderDialog({
      respond: (call) => {
        if (call === 1) throw new Error('Failed to create pairing links')
        return { json: BASE_LINKS }
      },
    })

    expect(await screen.findByText('Failed to create pairing links')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByAltText('Mobile app pairing QR code')).toBeInTheDocument()
  })
})
