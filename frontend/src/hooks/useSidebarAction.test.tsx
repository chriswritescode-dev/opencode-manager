import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSidebarAction } from './useSidebarAction'

describe('useSidebarAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls handler when matching event is dispatched', () => {
    const handler = vi.fn()

    renderHook(() => useSidebarAction('new-session', handler))

    window.dispatchEvent(
      new CustomEvent('oc:sidebar:action', {
        detail: { action: 'new-session' },
      })
    )

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not call handler for non-matching action', () => {
    const handler = vi.fn()

    renderHook(() => useSidebarAction('new-session', handler))

    window.dispatchEvent(
      new CustomEvent('oc:sidebar:action', {
        detail: { action: 'new-repo' },
      })
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('cleans up event listener on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useSidebarAction('new-session', handler))

    unmount()

    window.dispatchEvent(
      new CustomEvent('oc:sidebar:action', {
        detail: { action: 'new-session' },
      })
    )

    expect(handler).not.toHaveBeenCalled()
  })
})
