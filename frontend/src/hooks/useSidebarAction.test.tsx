import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSidebarAction, emitSidebarAction, SIDEBAR_ACTIONS } from './useSidebarAction'

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

describe('emitSidebarAction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reaches a registered handler without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = vi.fn()

    renderHook(() => useSidebarAction('new-schedule', handler))
    emitSidebarAction('new-schedule')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns when an action is dispatched with no mounted handler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    emitSidebarAction('new-schedule')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('new-schedule'))
  })

  it('warns again once the last handler unmounts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { unmount } = renderHook(() => useSidebarAction('new-repo', vi.fn()))

    emitSidebarAction('new-repo')
    expect(warn).not.toHaveBeenCalled()

    unmount()
    emitSidebarAction('new-repo')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('new-repo'))
  })

  it('exposes every action the nav model can emit', () => {
    expect([...SIDEBAR_ACTIONS]).toEqual(['new-session', 'new-repo', 'new-schedule'])
  })
})
