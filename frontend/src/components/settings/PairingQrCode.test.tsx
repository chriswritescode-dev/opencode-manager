import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PairingQrCode } from './PairingQrCode'

describe('PairingQrCode', () => {
  afterEach(() => {
    vi.doUnmock('uqr')
    vi.resetModules()
  })

  it('reports a renderer that fails to load', async () => {
    vi.resetModules()
    vi.doMock('uqr', () => {
      throw new Error('chunk failed')
    })
    const { PairingQrCode: FreshPairingQrCode } = await import('./PairingQrCode')

    render(<FreshPairingQrCode value="https://studio.example.com/pair#c=abc" label="Pairing QR code" />)

    expect(
      await screen.findByText('The QR code could not be loaded. Reload the page and try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByAltText('Pairing QR code')).not.toBeInTheDocument()
  })

  it('renders the QR code once uqr has loaded', async () => {
    render(<PairingQrCode value="https://studio.example.com/pair#c=abc" label="Pairing QR code" />)

    const image = await screen.findByAltText('Pairing QR code')
    expect(image).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'))
  })

  it('reports values too large to encode', async () => {
    render(<PairingQrCode value={'a'.repeat(10_000)} label="Pairing QR code" />)

    expect(
      await screen.findByText(
        'This QR code holds too much data. Remove some remote access headers.',
      ),
    ).toBeInTheDocument()
  })
})
