import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { saveFile, saveFileFromUrl } from './download'
import { renderWithProviders } from '@/test/render'
import { installObjectUrl, installPointerCapture } from '@/test/browserFakes'

const originalUserAgent = navigator.userAgent
const originalCanShare = navigator.canShare
const originalShare = navigator.share

const appRoot = createElement('div')

function setIosHomeScreenApp(): void {
  Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true })
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
}

function installShareSheet(share: (data?: ShareData) => Promise<void>): void {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
}

function restoreNavigator(): void {
  Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true })
  Object.defineProperty(navigator, 'canShare', { value: originalCanShare, configurable: true })
  Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true })
  Reflect.deleteProperty(navigator, 'standalone')
}

describe('saveFile', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    installObjectUrl()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreNavigator()
  })

  it('downloads via an anchor outside iOS home screen apps', async () => {
    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('uses the share sheet instead of navigating in an iOS home screen app', async () => {
    setIosHomeScreenApp()
    const share = vi.fn<(data?: ShareData) => Promise<void>>().mockResolvedValue(undefined)
    installShareSheet(share)

    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(true)
    expect(clickSpy).not.toHaveBeenCalled()
    expect(share.mock.calls[0][0]?.files?.[0]?.name).toBe('notes.md')
  })

  it('reports a cancelled share as unsaved', async () => {
    setIosHomeScreenApp()
    installShareSheet(vi.fn(async () => Promise.reject(new DOMException('cancelled', 'AbortError'))))

    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(false)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('offers a retry when the share loses user activation', async () => {
    setIosHomeScreenApp()
    installPointerCapture()
    const share = vi.fn<(data?: ShareData) => Promise<void>>()
      .mockRejectedValueOnce(new DOMException('no activation', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined)
    installShareSheet(share)
    renderWithProviders(appRoot)

    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(false)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(clickSpy).not.toHaveBeenCalled()
  })
})

describe('saveFileFromUrl', () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreNavigator()
  })

  it('reports a fetch failure and returns false in an iOS home screen app', async () => {
    setIosHomeScreenApp()
    renderWithProviders(appRoot, {
      auth: false,
      theme: false,
      fetchRoutes: [
        {
          method: 'GET',
          path: '/api/files/notes.md',
          respond: () => ({ status: 500, json: { error: 'network' } }),
        },
      ],
    })

    const saved = await saveFileFromUrl('/api/files/notes.md', 'notes.md')

    expect(saved).toBe(false)
    expect(await screen.findByText('Failed to save notes.md')).toBeInTheDocument()
  })
})
