import { useEffect, useRef, useState } from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { dialogSearch, openDialogParam, useDialogParam } from './useDialogParam'
import { describe, it, expect, vi } from 'vitest'

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

  it('openDialogParam sets the dialog and extra params in one push while clearing mobileTab', () => {
    const updateParams = vi.fn()
    openDialogParam(updateParams, 'terminal', { terminal: 'pty-1' })

    expect(updateParams).toHaveBeenCalledTimes(1)
    const [updater, mode] = updateParams.mock.calls[0]
    expect(mode).toBe('push')

    const params = new URLSearchParams('mobileTab=more&keep=1')
    updater(params)

    expect(params.get('dialog')).toBe('terminal')
    expect(params.get('terminal')).toBe('pty-1')
    expect(params.get('keep')).toBe('1')
    expect(params.has('mobileTab')).toBe(false)
  })

  it('openDialogParam without extra params only sets the dialog', () => {
    const updateParams = vi.fn()
    openDialogParam(updateParams, 'mcp')

    const [updater] = updateParams.mock.calls[0]
    const params = new URLSearchParams()
    updater(params)

    expect(params.get('dialog')).toBe('mcp')
    expect([...params.keys()]).toEqual(['dialog'])
  })

  it('dialogSearch builds a query string from the dialog name and extra params', () => {
    expect(dialogSearch('terminal')).toBe('?dialog=terminal')
    expect(dialogSearch('terminal', { terminal: 'pty-1' })).toBe('?dialog=terminal&terminal=pty-1')
    expect(dialogSearch('preview', { previewPort: '5173', previewPath: '/' })).toBe(
      '?dialog=preview&previewPort=5173&previewPath=%2F',
    )
  })

  it('dialogSearch URL-encodes extra params and omits mobileTab', () => {
    const search = dialogSearch('terminal', { terminal: 'pty 1/2' })

    expect(search).toBe('?dialog=terminal&terminal=pty+1%2F2')
    expect(search).not.toContain('mobileTab')
  })

  describe('history entries', () => {
    function DialogHistoryHarness() {
      const [isOpen, setOpen] = useDialogParam('mcp')
      const location = useLocation()
      const navigate = useNavigate()

      return (
        <div>
          <span data-testid="dialog-state">{isOpen ? 'open' : 'closed'}</span>
          <span data-testid="pathname">{location.pathname}</span>
          <button onClick={() => setOpen(true)}>open</button>
          <button onClick={() => setOpen(false)}>close</button>
          <button onClick={() => navigate(-1)}>back</button>
        </div>
      )
    }

    it('closing a dialog the app opened goes back instead of leaving a dead history entry', () => {
      render(
        <MemoryRouter initialEntries={['/repos/2', '/']} initialIndex={1}>
          <DialogHistoryHarness />
        </MemoryRouter>,
      )

      act(() => { screen.getByText('open').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('open')

      act(() => { screen.getByText('close').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
      expect(screen.getByTestId('pathname').textContent).toBe('/')

      act(() => { screen.getByText('back').click() })
      expect(screen.getByTestId('pathname').textContent).toBe('/repos/2')
    })

    it('closing a deep-linked dialog replaces the entry instead of leaving the route', () => {
      render(
        <MemoryRouter initialEntries={['/repos/2', '/?dialog=mcp']} initialIndex={1}>
          <DialogHistoryHarness />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('dialog-state').textContent).toBe('open')

      act(() => { screen.getByText('close').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
      expect(screen.getByTestId('pathname').textContent).toBe('/')

      act(() => { screen.getByText('back').click() })
      expect(screen.getByTestId('pathname').textContent).toBe('/repos/2')
    })
  })
})
