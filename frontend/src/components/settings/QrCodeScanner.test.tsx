import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QrCodeScanner } from './QrCodeScanner'
import { installPointerCapture, installQrScanner } from '@/test/browserFakes'

const pairingLink = 'ocm://pair?v=2&kind=manager&name=Desk&code=abc'

function renderScanner() {
  installPointerCapture()
  const onOpenChange = vi.fn()
  const onResult = vi.fn()
  render(<QrCodeScanner open onOpenChange={onOpenChange} onResult={onResult} />)
  return { onOpenChange, onResult }
}

function installCameraFailure(error: DOMException) {
  installQrScanner(pairingLink)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        throw error
      },
    },
  })
}

describe('QrCodeScanner', () => {
  it('reports the decoded pairing link and closes the dialog', async () => {
    const scanner = installQrScanner(pairingLink)
    const { onOpenChange, onResult } = renderScanner()

    await scanner.scan()

    expect(onResult).toHaveBeenCalledWith(pairingLink)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each([
    ['NotAllowedError', 'Camera permission was denied. Allow camera access for this site. Paste the pairing link instead.'],
    ['NotFoundError', 'No camera was found on this device. Paste the pairing link instead.'],
    ['NotReadableError', 'The camera is already in use by another application. Paste the pairing link instead.'],
    ['AbortError', 'The camera could not be started. Paste the pairing link instead.'],
  ])('explains a %s camera failure', async (errorName, message) => {
    installCameraFailure(new DOMException('camera failed', errorName))
    renderScanner()

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('reports a browser without camera access', async () => {
    installQrScanner(pairingLink)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} })
    renderScanner()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Camera access is not available in this browser. Paste the pairing link instead.',
    )
  })
})
