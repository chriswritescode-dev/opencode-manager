import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { SwipeNavigationProvider, useSwipeNavigation } from './SwipeNavigationContext'

describe('SwipeNavigationContext', () => {
  it('returns null when used outside provider', () => {
    const { result } = renderHook(() => useSwipeNavigation())
    expect(result.current).toBeNull()
  })

  it('provides suspend/resume/isSuspended when inside provider', () => {
    const { result } = renderHook(() => useSwipeNavigation(), {
      wrapper: SwipeNavigationProvider,
    })

    expect(result.current?.suspend).toBeDefined()
    expect(result.current?.resume).toBeDefined()
    expect(result.current?.isSuspended).toBeDefined()
  })

  it('tracks suspension with ref counting', () => {
    let current: ReturnType<typeof useSwipeNavigation>
    
    const { rerender } = renderHook(() => {
      current = useSwipeNavigation()
      return null
    }, {
      wrapper: SwipeNavigationProvider,
    })

    expect(current?.isSuspended()).toBe(false)
    
    current?.suspend()
    rerender()
    expect(current?.isSuspended()).toBe(true)
    
    current?.suspend()
    rerender()
    expect(current?.isSuspended()).toBe(true)
    
    current?.resume()
    rerender()
    expect(current?.isSuspended()).toBe(true)
    
    current?.resume()
    rerender()
    expect(current?.isSuspended()).toBe(false)
  })

  it('clamps resume below zero to zero', () => {
    let current: ReturnType<typeof useSwipeNavigation>
    
    const { rerender } = renderHook(() => {
      current = useSwipeNavigation()
      return null
    }, {
      wrapper: SwipeNavigationProvider,
    })

    current?.suspend()
    rerender()
    expect(current?.isSuspended()).toBe(true)
    
    current?.resume()
    rerender()
    expect(current?.isSuspended()).toBe(false)
    
    current?.resume()
    rerender()
    expect(current?.isSuspended()).toBe(false)
  })
})
