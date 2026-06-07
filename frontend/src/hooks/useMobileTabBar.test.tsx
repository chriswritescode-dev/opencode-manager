import { useEffect, useRef, useState } from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useMobileTabBar } from './useMobileTabBar'
import { renderHookWithRouter, createRouterWrapper } from '@/test/test-utils'

describe('useMobileTabBar', () => {
  it('returns null for openSheet when no mobileTab param is present', () => {
    const { result } = renderHookWithRouter(() => useMobileTabBar())
    expect(result.current.openSheet).toBeNull()
  })

  it('returns the correct openSheet when mobileTab param is set', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: createRouterWrapper(['/?mobileTab=repos']),
    })
    expect(result.current.openSheet).toBe('repos')
  })

  it('open sets the mobileTab param', () => {
    const { result } = renderHookWithRouter(() => useMobileTabBar())
    act(() => {
      result.current.open('files')
    })
    expect(result.current.openSheet).toBe('files')
  })

  it('close removes the mobileTab param', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: createRouterWrapper(['/?mobileTab=notifications']),
    })
    expect(result.current.openSheet).toBe('notifications')
    act(() => {
      result.current.close()
    })
    expect(result.current.openSheet).toBeNull()
  })

  it('resolves invalid values to null', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: createRouterWrapper(['/?mobileTab=invalid']),
    })
    expect(result.current.openSheet).toBeNull()
  })

  it('handles all valid MobileSheetKey values', () => {
    const validKeys = ['repos', 'files', 'notifications', 'more'] as const
    validKeys.forEach((key) => {
      const { result } = renderHook(() => useMobileTabBar(), {
        wrapper: createRouterWrapper([`/?mobileTab=${key}`]),
      })
      expect(result.current.openSheet).toBe(key)
    })
  })

  it('returns stable openSheet identity across rerenders when search is unchanged', () => {
    const { result, rerender } = renderHook(() => useMobileTabBar(), {
      wrapper: createRouterWrapper(['/?mobileTab=repos']),
    })
    const firstOpenSheet = result.current.openSheet
    rerender()
    expect(result.current.openSheet).toBe(firstOpenSheet)
  })

  it('open and close callbacks maintain stable identity across rerenders', () => {
    const { result, rerender } = renderHookWithRouter(() => useMobileTabBar())
    const firstOpen = result.current.open
    const firstClose = result.current.close
    rerender()
    expect(result.current.open).toBe(firstOpen)
    expect(result.current.close).toBe(firstClose)
  })

  it('open callback identity is stable across location.search changes', () => {
    const { result, rerender } = renderHook(() => useMobileTabBar(), {
      wrapper: createRouterWrapper(['/?foo=1']),
    })
    const firstOpen = result.current.open
    rerender()
    expect(result.current.open).toBe(firstOpen)
  })

  it('open (push) then navigate(-1) sets openSheet to null', () => {
    function Harness() {
      const { openSheet, open } = useMobileTabBar()
      const navigate = useNavigate()
      const [step, setStep] = useState<'start' | 'pushed' | 'back'>('start')
      const handled = useRef(false)

      useEffect(() => {
        if (handled.current) return
        if (step === 'pushed') {
          handled.current = true
          open('files')
        } else if (step === 'back') {
          handled.current = true
          navigate(-1)
        }
      }, [step, open, navigate])

      return (
        <div>
          <span data-testid="openSheet">{openSheet}</span>
          <button onClick={() => { handled.current = false; setStep('pushed') }}>
            open
          </button>
          <button onClick={() => { handled.current = false; setStep('back') }}>
            back
          </button>
        </div>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('openSheet').textContent).toBe('')

    act(() => { screen.getByText('open').click() })
    expect(screen.getByTestId('openSheet').textContent).toBe('files')

    act(() => { screen.getByText('back').click() })
    expect(screen.getByTestId('openSheet').textContent).toBe('')
  })
})
