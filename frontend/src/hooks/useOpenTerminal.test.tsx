import { describe, it, expect } from 'vitest'
import { act } from '@testing-library/react'
import { renderHookWithRouterAndLocation } from '@/test/test-utils'
import { useRouteTerminalDialogParam } from './useOpenTerminal'

describe('useRouteTerminalDialogParam', () => {
  it('drops the selected terminal when the dialog closes so a later open is not tied to it', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useRouteTerminalDialogParam(),
      ['/repos/1?dialog=terminal&terminal=pty-1&keep=1'],
    )
    expect(result.current[0]).toBe(true)

    act(() => {
      result.current[1](false)
    })

    const params = new URLSearchParams(capturedSearch.current)
    expect(result.current[0]).toBe(false)
    expect(params.has('dialog')).toBe(false)
    expect(params.has('terminal')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('leaves another dialog and its params alone', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useRouteTerminalDialogParam(),
      ['/repos/1?dialog=preview&terminal=pty-1'],
    )

    act(() => {
      result.current[1](false)
    })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('dialog')).toBe('preview')
    expect(params.get('terminal')).toBe('pty-1')
  })
})
