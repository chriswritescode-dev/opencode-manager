import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PairingQrCode } from './PairingQrCode'

describe('PairingQrCode', () => {
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
