import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRightEdgeSwipe, useSwipeBack, useSwipeDismiss } from './useMobile'
import { SwipeNavigationProvider } from '@/contexts/SwipeNavigationContext'
import { useSwipeNavigation } from '@/contexts/swipe-navigation-context'
import { createTouchEvent, installWindowSize } from '@/test/browserFakes'

function createElement(): HTMLDivElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return element
}

function removeElement(element: HTMLElement): void {
  document.body.removeChild(element)
}

describe('useSwipeBack', () => {
  const onClose = vi.fn()
  const onBack = vi.fn()
  const canBack = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
    onBack.mockClear()
    canBack.mockClear()
    installWindowSize(375)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onClose when swipe completes and canBack is false', () => {
    canBack.mockReturnValue(false)
    const element = createElement()

    const { result } = renderHook(() =>
      useSwipeBack(onClose, { enabled: true, canBack, onBack, threshold: 80 }),
    )
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 100 }]))

    expect(canBack).toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('calls onBack when swipe completes and canBack is true', () => {
    canBack.mockReturnValue(true)
    const element = createElement()

    const { result } = renderHook(() =>
      useSwipeBack(onClose, { enabled: true, canBack, onBack, threshold: 80 }),
    )
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 100 }]))

    expect(canBack).toHaveBeenCalled()
    expect(onBack).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('does not call onBack when canBack was false at swipe start', () => {
    canBack.mockReturnValueOnce(false).mockReturnValue(true)
    const element = createElement()

    const { result } = renderHook(() =>
      useSwipeBack(onClose, { enabled: true, canBack, onBack, threshold: 80 }),
    )
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 100 }]))

    expect(canBack).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('falls back to onClose when canBack is not provided', () => {
    const { result } = renderHook(() => useSwipeBack(onClose, { enabled: true, threshold: 80 }))

    expect(result.current.bind).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('returns swipeStyles for visual feedback', () => {
    const { result } = renderHook(() => useSwipeBack(onClose, { enabled: true }))

    expect(result.current.swipeStyles).toBeDefined()
    expect(result.current.swipeStyles.transform).toBeUndefined()
    expect(result.current.swipeStyles.transition).toBe('transform 0.2s ease-out')
  })

  it('disables swipe when enabled is false', () => {
    const { result } = renderHook(() => useSwipeBack(onClose, { enabled: false }))

    expect(result.current.bind).toBeDefined()
  })

  it('binds touch event listeners to element', () => {
    const element = document.createElement('div')
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener')

    const { result } = renderHook(() => useSwipeBack(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    expect(addEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function), { passive: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function), { passive: true })

    cleanup()
    expect(removeEventListenerSpy).toHaveBeenCalled()
  })

  it('suspends route-level swipe-back while active', () => {
    let swipeNavValue: ReturnType<typeof useSwipeNavigation> | undefined

    const { result, unmount } = renderHook(
      () => {
        swipeNavValue = useSwipeNavigation()
        return useSwipeBack(onClose, { enabled: true })
      },
      { wrapper: SwipeNavigationProvider },
    )

    expect(result.current.bind).toBeDefined()
    expect(result.current.swipeStyles).toBeDefined()
    expect(swipeNavValue?.isSuspended()).toBe(true)

    unmount()
    expect(swipeNavValue?.isSuspended()).toBe(false)
  })
})

describe('useRightEdgeSwipe', () => {
  const onOpen = vi.fn()

  beforeEach(() => {
    onOpen.mockClear()
    installWindowSize(375)
  })

  it('opens when swiping left from the right edge', () => {
    const element = createElement()

    const { result } = renderHook(() => useRightEdgeSwipe(onOpen, { enabled: true, edgeWidth: 32, threshold: 72 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 365, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 285, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 285, clientY: 100 }]))

    expect(onOpen).toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('ignores swipes that do not start on the right edge', () => {
    const element = createElement()

    const { result } = renderHook(() => useRightEdgeSwipe(onOpen, { enabled: true, edgeWidth: 32, threshold: 72 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 220, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 220, clientY: 100 }]))

    expect(onOpen).not.toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })
})

describe('useSwipeDismiss', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
    installWindowSize(375)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('suspends route-level swipe-back while active', () => {
    let swipeNavValue: ReturnType<typeof useSwipeNavigation> | undefined

    const { unmount } = renderHook(
      () => {
        swipeNavValue = useSwipeNavigation()
        return useSwipeDismiss(onClose, { enabled: true })
      },
      { wrapper: SwipeNavigationProvider },
    )

    expect(swipeNavValue?.isSuspended()).toBe(true)

    unmount()
    expect(swipeNavValue?.isSuspended()).toBe(false)
  })

  it('does not require edge start in vertical mode', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 200, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 200 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 200, clientY: 200 }]))
    vi.advanceTimersByTime(300)

    expect(onClose).toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('closes on release past distance threshold', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 190 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 190 }]))
    vi.advanceTimersByTime(300)

    expect(onClose).toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('closes on release past velocity threshold even if short distance', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    vi.advanceTimersByTime(50)
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 140 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 140 }]))
    vi.advanceTimersByTime(300)

    expect(onClose).toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('does NOT close on short slow drag', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    vi.advanceTimersByTime(500)
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 140 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 140 }]))

    expect(onClose).not.toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('does NOT close on upward drag', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 200 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 0 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 0 }]))

    expect(onClose).not.toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('does NOT close when horizontal swipe dominates', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 250, clientY: 120 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 250, clientY: 120 }]))

    expect(onClose).not.toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('disabled when enabled: false', () => {
    const element = createElement()

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: false, threshold: 80 }))
    const cleanup = result.current.bind(element)

    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 200 }]))
    element.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 200 }]))

    expect(onClose).not.toHaveBeenCalled()

    cleanup()
    removeElement(element)
  })

  it('does not start drag when touch originates inside scrolled descendant', () => {
    const container = document.createElement('div')
    const scrollable = document.createElement('div')
    scrollable.style.overflowY = 'auto'
    scrollable.style.height = '100px'
    container.appendChild(scrollable)
    document.body.appendChild(container)

    Object.defineProperty(scrollable, 'scrollHeight', { value: 200, configurable: true })
    Object.defineProperty(scrollable, 'clientHeight', { value: 100, configurable: true })
    scrollable.scrollTop = 50

    const { result } = renderHook(() => useSwipeDismiss(onClose, { enabled: true, threshold: 80 }))
    const cleanup = result.current.bind(container)

    scrollable.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    scrollable.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 200 }]))
    scrollable.dispatchEvent(createTouchEvent('touchend', [], [{ clientX: 100, clientY: 200 }]))

    expect(onClose).not.toHaveBeenCalled()

    cleanup()
    document.body.removeChild(container)
  })
})
