import { useEffect, useRef, useState } from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useDialogParam } from './useDialogParam'
import { describe, it, expect } from 'vitest'

describe('useDialogParam', () => {
  const createWrapper = (initialEntries?: string[]) => {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    }
  }

  it('returns false when dialog param does not match name', () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => useDialogParam('mcp'), { wrapper })
    expect(result.current[0]).toBe(false)
  })

  it('returns true when dialog param matches name', () => {
    const wrapper = createWrapper(['/?dialog=mcp'])
    const { result } = renderHook(() => useDialogParam('mcp'), { wrapper })
    expect(result.current[0]).toBe(true)
  })

  it('opening sets dialog param and clears mobileTab', () => {
    const wrapper = createWrapper(['/?mobileTab=more'])
    const { result } = renderHook(() => useDialogParam('mcp'), { wrapper })

    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1](true)
    })

    expect(result.current[0]).toBe(true)
  })

  it('closing removes dialog param', () => {
    const wrapper = createWrapper(['/?dialog=mcp&other=value'])
    const { result } = renderHook(() => useDialogParam('mcp'), { wrapper })

    expect(result.current[0]).toBe(true)

    act(() => {
      result.current[1](false)
    })

    expect(result.current[0]).toBe(false)
  })

  it('isOpen is true only when dialog exactly matches name', () => {
    const wrapper1 = createWrapper(['/?dialog=skills'])
    const { result: result1 } = renderHook(() => useDialogParam('mcp'), { wrapper: wrapper1 })

    const wrapper2 = createWrapper(['/?dialog=skills'])
    const { result: result2 } = renderHook(() => useDialogParam('skills'), { wrapper: wrapper2 })

    expect(result1.current[0]).toBe(false)
    expect(result2.current[0]).toBe(true)
  })

  it('concurrent different names do not interfere', () => {
    const wrapper = createWrapper(['/?dialog=mcp'])
    const { result: result1 } = renderHook(() => useDialogParam('mcp'), { wrapper })
    const { result: result2 } = renderHook(() => useDialogParam('skills'), { wrapper })

    expect(result1.current[0]).toBe(true)
    expect(result2.current[0]).toBe(false)
  })

  it('open pushes so browser back closes the dialog', () => {
    function DialogPushHarness() {
      const [isOpen, setOpen] = useDialogParam('test')
      const navigate = useNavigate()
      const [step, setStep] = useState<'start' | 'opened' | 'back'>('start')
      const handled = useRef(false)

      useEffect(() => {
        if (handled.current) return
        if (step === 'opened') {
          handled.current = true
          setOpen(true)
        } else if (step === 'back') {
          handled.current = true
          navigate(-1)
        }
      }, [step, setOpen, navigate])

      return (
        <div>
          <span data-testid="dialog-state">{isOpen ? 'open' : 'closed'}</span>
          <button onClick={() => { handled.current = false; setStep('opened') }}>
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
        <DialogPushHarness />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('dialog-state').textContent).toBe('closed')

    act(() => { screen.getByText('open').click() })
    expect(screen.getByTestId('dialog-state').textContent).toBe('open')

    act(() => { screen.getByText('back').click() })
    expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
  })
})
