import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHeaderScrollVisibility } from '../useHeaderScrollVisibility'

interface ScrollContainerOptions {
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
}

function createContainerRef({
  scrollTop = 0,
  scrollHeight = 1000,
  clientHeight = 500,
}: ScrollContainerOptions = {}) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, writable: true, configurable: true })
  return { current: el }
}

function scroll(container: HTMLElement, scrollTop: number, scrollHeight?: number) {
  act(() => {
    container.scrollTop = scrollTop
    if (scrollHeight !== undefined) {
      Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true })
    }
    container.dispatchEvent(new Event('scroll'))
  })
}

describe('useHeaderScrollVisibility', () => {
  it('returns true initially', () => {
    const ref = createContainerRef()

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))

    expect(result.current.isHeaderVisible).toBe(true)
  })

  it('does not hide the header when disabled', () => {
    const ref = createContainerRef({ scrollTop: 100 })
    const addEventListenerSpy = vi.spyOn(ref.current, 'addEventListener')

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: false }))
    scroll(ref.current, 200)

    expect(result.current.isHeaderVisible).toBe(true)
    expect(addEventListenerSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything())
  })

  it('hides the header when scrolling down past the threshold', () => {
    const ref = createContainerRef({ scrollTop: 100 })

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))
    scroll(ref.current, 200)

    expect(result.current.isHeaderVisible).toBe(false)
  })

  it('shows the header after being hidden when scrolling up past the threshold', () => {
    const ref = createContainerRef({ scrollTop: 100 })

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))
    scroll(ref.current, 200)
    scroll(ref.current, 100)

    expect(result.current.isHeaderVisible).toBe(true)
  })

  it('keeps the header visible at the top', () => {
    const ref = createContainerRef({ scrollTop: 100 })

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))
    scroll(ref.current, 200)
    scroll(ref.current, 0)

    expect(result.current.isHeaderVisible).toBe(true)
  })

  it('forces the header visible near the bottom even while scrolling down', () => {
    const ref = createContainerRef({ scrollTop: 400, scrollHeight: 1000, clientHeight: 500 })


    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))
    scroll(ref.current, 450)
    scroll(ref.current, 460)

    expect(result.current.isHeaderVisible).toBe(true)
  })

  it('ignores small scroll deltas', () => {
    const ref = createContainerRef({ scrollTop: 100 })

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))
    scroll(ref.current, 200)
    scroll(ref.current, 205)

    expect(result.current.isHeaderVisible).toBe(false)
  })

  it('ignores scroll events where content height changed', () => {
    const ref = createContainerRef({ scrollTop: 100, scrollHeight: 1000 })

    const { result } = renderHook(() => useHeaderScrollVisibility({ containerRef: ref, enabled: true }))
    scroll(ref.current, 200, 1200)

    expect(result.current.isHeaderVisible).toBe(true)
  })

  it('forces visibility back to true when resetKey changes', () => {
    const ref = createContainerRef({ scrollTop: 100 })


    const { result, rerender } = renderHook(
      ({ resetKey }) => useHeaderScrollVisibility({ containerRef: ref, enabled: true, resetKey }),
      { initialProps: { resetKey: 'one' } },
    )
    scroll(ref.current, 200)

    expect(result.current.isHeaderVisible).toBe(false)

    rerender({ resetKey: 'two' })


    expect(result.current.isHeaderVisible).toBe(true)
  })
})
