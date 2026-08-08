import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRightEdgeSwipe, useSwipeBack, useSwipeDismiss } from './useMobile'
import { SwipeNavigationProvider, useSwipeNavigation } from '@/contexts/SwipeNavigationContext'

describe('useSwipeBack', () => {
  const mockOnClose = vi.fn()
  const mockOnBack = vi.fn()
  const mockCanBack = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
    mockOnBack.mockClear()
    mockCanBack.mockClear()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onClose when swipe completes and canBack is false', () => {
    mockCanBack.mockReturnValue(false)

    const element = document.createElement('div')
    document.body.appendChild(element)

    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: true,
        canBack: mockCanBack,
        onBack: mockOnBack,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 100 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockCanBack).toHaveBeenCalled()
    expect(mockOnBack).not.toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('calls onBack when swipe completes and canBack is true', () => {
    mockCanBack.mockReturnValue(true)

    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: true,
        canBack: mockCanBack,
        onBack: mockOnBack,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 100 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockCanBack).toHaveBeenCalled()
    expect(mockOnBack).toHaveBeenCalled()
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('does not call onBack when canBack was false at swipe start', () => {
    mockCanBack.mockReturnValueOnce(false).mockReturnValue(true)

    const element = document.createElement('div')
    document.body.appendChild(element)

    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: true,
        canBack: mockCanBack,
        onBack: mockOnBack,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)

    element.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 100 }] as any,
    }))
    element.dispatchEvent(new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    }))
    element.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 100 }] as any,
    }))

    expect(mockCanBack).toHaveBeenCalledTimes(1)
    expect(mockOnBack).not.toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()

    cleanup?.()
    document.body.removeChild(element)
  })

  it('falls back to onClose when canBack is not provided', () => {
    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    expect(result.current.bind).toBeDefined()
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('returns swipeStyles for visual feedback', () => {
    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: true,
      })
    )

    expect(result.current.swipeStyles).toBeDefined()
    expect(result.current.swipeStyles.transform).toBeUndefined()
    expect(result.current.swipeStyles.transition).toBe('transform 0.2s ease-out')
  })

  it('disables swipe when enabled is false', () => {
    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: false,
      })
    )

    expect(result.current.bind).toBeDefined()
  })

  it('binds touch event listeners to element', () => {
    const element = document.createElement('div')
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener')

    const { result } = renderHook(() =>
      useSwipeBack(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function), { passive: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function), { passive: true })

    if (cleanup) {
      cleanup()
      expect(removeEventListenerSpy).toHaveBeenCalled()
    }
  })

  it('suspends route-level swipe-back while active', () => {
    let swipeNavValue: ReturnType<typeof useSwipeNavigation>
    
    const { result, unmount } = renderHook(() => {
      swipeNavValue = useSwipeNavigation()
      return useSwipeBack(mockOnClose, {
        enabled: true,
      })
    }, {
      wrapper: SwipeNavigationProvider,
    })

    expect(result.current.bind).toBeDefined()
    expect(result.current.swipeStyles).toBeDefined()
    expect(swipeNavValue?.isSuspended()).toBe(true)
    
    unmount()
    expect(swipeNavValue?.isSuspended()).toBe(false)
  })
})

describe('useRightEdgeSwipe', () => {
  const mockOnOpen = vi.fn()

  beforeEach(() => {
    mockOnOpen.mockClear()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

  it('opens when swiping left from the right edge', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const { result } = renderHook(() =>
      useRightEdgeSwipe(mockOnOpen, {
        enabled: true,
        edgeWidth: 32,
        threshold: 72,
      })
    )

    const cleanup = result.current.bind(element)

    element.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 365, clientY: 100 }] as any,
    }))
    element.dispatchEvent(new TouchEvent('touchmove', {
      touches: [{ clientX: 285, clientY: 100 }] as any,
    }))
    element.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 285, clientY: 100 }] as any,
    }))

    expect(mockOnOpen).toHaveBeenCalled()

    cleanup?.()
    document.body.removeChild(element)
  })

  it('ignores swipes that do not start on the right edge', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const { result } = renderHook(() =>
      useRightEdgeSwipe(mockOnOpen, {
        enabled: true,
        edgeWidth: 32,
        threshold: 72,
      })
    )

    const cleanup = result.current.bind(element)

    element.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 300, clientY: 100 }] as any,
    }))
    element.dispatchEvent(new TouchEvent('touchmove', {
      touches: [{ clientX: 220, clientY: 100 }] as any,
    }))
    element.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 220, clientY: 100 }] as any,
    }))

    expect(mockOnOpen).not.toHaveBeenCalled()

    cleanup?.()
    document.body.removeChild(element)
  })
})

describe('useSwipeDismiss', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('suspends route-level swipe-back while active', () => {
    let swipeNavValue: ReturnType<typeof useSwipeNavigation>
    
    const { unmount } = renderHook(() => {
      swipeNavValue = useSwipeNavigation()
      return useSwipeDismiss(mockOnClose, {
        enabled: true,
      })
    }, {
      wrapper: SwipeNavigationProvider,
    })

    expect(swipeNavValue?.isSuspended()).toBe(true)
    
    unmount()
    expect(swipeNavValue?.isSuspended()).toBe(false)
  })

  it('does not require edge start in vertical mode', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 200, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 200, clientY: 200 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 200, clientY: 200 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    vi.advanceTimersByTime(300)
    
    expect(mockOnClose).toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('closes on release past distance threshold', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 190 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 190 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    vi.advanceTimersByTime(300)
    
    expect(mockOnClose).toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('closes on release past velocity threshold even if short distance', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    element.dispatchEvent(touchStart)
    
    vi.advanceTimersByTime(50)
    
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 140 }] as any,
    })
    element.dispatchEvent(touchMove)
    
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 140 }] as any,
    })
    element.dispatchEvent(touchEnd)
    vi.advanceTimersByTime(300)
    
    expect(mockOnClose).toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('does NOT close on short slow drag', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    element.dispatchEvent(touchStart)
    
    vi.advanceTimersByTime(500)
    
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 140 }] as any,
    })
    element.dispatchEvent(touchMove)
    
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 140 }] as any,
    })
    element.dispatchEvent(touchEnd)
    
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('does NOT close on upward drag', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 200 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 0 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 0 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('does NOT close when horizontal swipe dominates', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 250, clientY: 120 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 250, clientY: 120 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('disabled when enabled: false', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: false,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 200 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 200 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
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
    
    const { result } = renderHook(() =>
      useSwipeDismiss(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(container)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    Object.defineProperty(touchStart, 'target', { value: scrollable })
    
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 200 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 200 }] as any,
    })
    
    scrollable.dispatchEvent(touchStart)
    scrollable.dispatchEvent(touchMove)
    scrollable.dispatchEvent(touchEnd)
    
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(container)
  })
})
