import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { saveFile, saveFileFromUrl } from './download'
import { fetchWrapperBlob } from '@/api/fetchWrapper'
import { showToast } from './toast'

vi.mock('./toast', () => ({
  showToast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/api/fetchWrapper', () => ({
  fetchWrapperBlob: vi.fn(),
}))

function setIosHomeScreenApp(): void {
  Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true })
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
}

describe('saveFile', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'standalone')
    Reflect.deleteProperty(navigator, 'canShare')
    Reflect.deleteProperty(navigator, 'share')
  })

  it('downloads via an anchor outside iOS home screen apps', async () => {
    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('uses the share sheet instead of navigating in an iOS home screen app', async () => {
    setIosHomeScreenApp()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(true)
    expect(clickSpy).not.toHaveBeenCalled()
    const shared = share.mock.calls[0][0].files[0] as File
    expect(shared.name).toBe('notes.md')
  })

  it('reports a cancelled share as unsaved', async () => {
    setIosHomeScreenApp()
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(false)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('offers a retry when the share loses user activation', async () => {
    setIosHomeScreenApp()
    const share = vi.fn()
      .mockRejectedValueOnce(new DOMException('no activation', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const saved = await saveFile(new Blob(['x'], { type: 'text/markdown' }), 'notes.md')

    expect(saved).toBe(false)
    const options = vi.mocked(showToast.info).mock.calls[0][1]
    options?.action?.onClick()
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(clickSpy).not.toHaveBeenCalled()
  })
})

describe('saveFileFromUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'standalone')
  })

  it('reports a fetch failure and returns false in an iOS home screen app', async () => {
    setIosHomeScreenApp()
    vi.mocked(fetchWrapperBlob).mockRejectedValueOnce(new Error('network'))

    const saved = await saveFileFromUrl('/api/files/notes.md', 'notes.md')

    expect(saved).toBe(false)
    expect(showToast.error).toHaveBeenCalledWith('Failed to save notes.md')
  })
})
