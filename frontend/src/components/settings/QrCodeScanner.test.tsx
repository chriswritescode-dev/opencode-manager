import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QrCodeScanner } from './QrCodeScanner'

const { decodeMock } = vi.hoisted(() => ({ decodeMock: vi.fn() }))

vi.mock('jsqr', () => ({ default: decodeMock }))

const frameQueue: FrameRequestCallback[] = []
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  frameQueue.push(callback)
  return frameQueue.length
})
const cancelFrame = vi.fn()

const imageDataMock = vi.fn((_x: number, _y: number, width: number, height: number) => ({
  data: new Uint8ClampedArray(width * height * 4),
  width,
  height,
}))

const contextMock = {
  drawImage: vi.fn(),
  getImageData: imageDataMock,
}

const getUserMediaMock = vi.fn(async () => ({ getTracks: () => [] }))
const originalGetContext = HTMLCanvasElement.prototype.getContext

async function runFrame(timestamp: number) {
  await waitFor(() => expect(frameQueue.length).toBeGreaterThan(0))
  const callback = frameQueue.shift()
  await act(async () => {
    callback?.(timestamp)
  })
}

function renderScanner() {
  return render(<QrCodeScanner open onOpenChange={vi.fn()} onResult={vi.fn()} />)
}

describe('QrCodeScanner', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: () => Promise.resolve(),
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 4,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1280,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 720,
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    frameQueue.length = 0
    decodeMock.mockReturnValue(null)
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => contextMock,
    ) as unknown as HTMLCanvasElement['getContext']
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: getUserMediaMock },
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('decodes at most once per 100ms of animation frames', async () => {
    renderScanner()

    await runFrame(100)
    expect(decodeMock).toHaveBeenCalledTimes(1)

    await runFrame(130)
    await runFrame(160)
    await runFrame(190)
    expect(decodeMock).toHaveBeenCalledTimes(1)

    await runFrame(200)
    expect(decodeMock).toHaveBeenCalledTimes(2)
  })

  it('only resizes the canvas when the scan dimensions change', async () => {
    const widthSetter = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set')
    const heightSetter = vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set')

    renderScanner()

    await runFrame(100)
    expect(widthSetter).toHaveBeenCalledTimes(1)
    expect(heightSetter).toHaveBeenCalledTimes(1)
    expect(imageDataMock).toHaveBeenNthCalledWith(1, 0, 0, 640, 360)

    await runFrame(250)
    expect(widthSetter).toHaveBeenCalledTimes(1)
    expect(heightSetter).toHaveBeenCalledTimes(1)
    expect(imageDataMock).toHaveBeenNthCalledWith(2, 0, 0, 640, 360)

    widthSetter.mockRestore()
    heightSetter.mockRestore()
  })
})
