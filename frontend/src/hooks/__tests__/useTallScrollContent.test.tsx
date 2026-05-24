import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTallScrollContent } from '../useTallScrollContent'

let mockObserve: ReturnType<typeof vi.fn>
let mockDisconnect: ReturnType<typeof vi.fn>
let resizeCallback: ((entries: ResizeObserverEntry[]) => void) | null = null

vi.stubGlobal('ResizeObserver', vi.fn((cb: (entries: ResizeObserverEntry[]) => void) => {
  resizeCallback = cb
  return {
    observe: mockObserve,
    disconnect: mockDisconnect,
    unobserve: vi.fn(),
  }
}))

describe('useTallScrollContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockObserve = vi.fn()
    mockDisconnect = vi.fn()
    resizeCallback = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createContainerRef(scrollHeight: number, clientHeight: number) {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
    return { current: el }
  }

  it('returns false when scrollHeight <= clientHeight * ratio', () => {
    const ref = createContainerRef(500, 400)

    const { result } = renderHook(() => useTallScrollContent(ref as React.RefObject<HTMLElement>, 1.5))
    expect(result.current).toBe(false)
  })

  it('returns true when scrollHeight > clientHeight * ratio', () => {
    const ref = createContainerRef(2000, 800)

    const { result } = renderHook(() => useTallScrollContent(ref as React.RefObject<HTMLElement>, 1.5))
    expect(result.current).toBe(true)
  })

  it('updates from false to true when ResizeObserver fires with taller content', () => {
    const ref = createContainerRef(500, 400)

    const { result } = renderHook(() => useTallScrollContent(ref as React.RefObject<HTMLElement>, 1.5))
    expect(result.current).toBe(false)

    Object.defineProperty(ref.current, 'scrollHeight', { value: 2000 })
    act(() => {
      resizeCallback?.([] as ResizeObserverEntry[])
    })

    expect(result.current).toBe(true)
  })

  it('updates from true to false when ResizeObserver fires with smaller container', () => {
    const ref = createContainerRef(2000, 800)

    const { result } = renderHook(() => useTallScrollContent(ref as React.RefObject<HTMLElement>, 1.5))
    expect(result.current).toBe(true)

    Object.defineProperty(ref.current, 'clientHeight', { value: 2000 })
    act(() => {
      resizeCallback?.([] as ResizeObserverEntry[])
    })

    expect(result.current).toBe(false)
  })
})
