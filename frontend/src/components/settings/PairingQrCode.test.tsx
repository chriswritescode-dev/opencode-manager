import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PairingQrCode } from './PairingQrCode'

const pairingLink = 'https://studio.example.com/pair#c=abc'

describe('PairingQrCode', () => {
  it('reports a renderer that fails to load', async () => {
    render(
      <PairingQrCode
        value={pairingLink}
        label="Pairing QR code"
        loadRenderer={async () => {
          throw new Error('chunk failed')
        }}
      />,
    )

    expect(
      await screen.findByText('The QR code could not be loaded. Reload the page and try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByAltText('Pairing QR code')).not.toBeInTheDocument()
  })

  it('renders the QR code once the renderer has loaded', async () => {
    render(<PairingQrCode value={pairingLink} label="Pairing QR code" />)

    const image = await screen.findByAltText('Pairing QR code')
    expect(image).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'))
  })

  it('reports values too large to encode', async () => {
    render(<PairingQrCode value={'a'.repeat(10_000)} label="Pairing QR code" />)

    expect(
      await screen.findByText('This QR code holds too much data. Remove some remote access headers.'),
    ).toBeInTheDocument()
  })
})
