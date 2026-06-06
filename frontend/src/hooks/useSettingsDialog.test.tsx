import { useEffect, useRef, useState } from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useSettingsDialog } from './useSettingsDialog'

function renderHookWithRouter<T>(renderFn: () => T, initialEntries = ['/']) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>
      {children}
    </MemoryRouter>
  )
  return renderHook(renderFn, { wrapper })
}

describe('useSettingsDialog', () => {
  it('returns closed and account tab when no params present', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.activeTab).toBe('account')
  })

  it('reads open state and tab from URL', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog(), ['/?settings=open&settingsTab=git'])
    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeTab).toBe('git')
  })

  it('defaults activeTab to account when settingsTab is missing', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog(), ['/?settings=open'])
    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeTab).toBe('account')
  })

  it('open sets settings=open and settingsTab, clears mobileTab', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog(), ['/?mobileTab=more'])
    expect(result.current.isOpen).toBe(false)

    act(() => { result.current.open() })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeTab).toBe('account')
  })

  it('close removes settings and settingsTab params', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog(), ['/?settings=open&settingsTab=git&keep=1'])
    expect(result.current.isOpen).toBe(true)

    act(() => { result.current.close() })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.activeTab).toBe('account')
  })

  it('setActiveTab updates settingsTab param and keeps settings=open', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog(), ['/?settings=open&settingsTab=account'])

    act(() => { result.current.setActiveTab('git') })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeTab).toBe('git')
  })

  it('toggle opens when closed', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog())
    expect(result.current.isOpen).toBe(false)

    act(() => { result.current.toggle() })

    expect(result.current.isOpen).toBe(true)
  })

  it('toggle closes when open', () => {
    const { result } = renderHookWithRouter(() => useSettingsDialog(), ['/?settings=open&settingsTab=general'])
    expect(result.current.isOpen).toBe(true)

    act(() => { result.current.toggle() })

    expect(result.current.isOpen).toBe(false)
  })

  describe('stable identity', () => {
    it('open, close, setActiveTab are stable across rerenders', () => {
      const { result, rerender } = renderHookWithRouter(() => useSettingsDialog())
      const firstOpen = result.current.open
      const firstClose = result.current.close
      const firstSetActiveTab = result.current.setActiveTab

      rerender()

      expect(result.current.open).toBe(firstOpen)
      expect(result.current.close).toBe(firstClose)
      expect(result.current.setActiveTab).toBe(firstSetActiveTab)
    })

    it('open, close, setActiveTab are stable across search changes', () => {
      const { result, rerender } = renderHookWithRouter(() => useSettingsDialog(), ['/?a=1'])

      const firstOpen = result.current.open
      const firstClose = result.current.close
      const firstSetActiveTab = result.current.setActiveTab

      act(() => { result.current.open() })

      rerender()

      expect(result.current.open).toBe(firstOpen)
      expect(result.current.close).toBe(firstClose)
      expect(result.current.setActiveTab).toBe(firstSetActiveTab)
    })
  })

  describe('history mode', () => {
    it('open pushes so navigate(-1) closes settings', () => {
      function Harness() {
        const { isOpen, open } = useSettingsDialog()
        const navigate = useNavigate()
        const [step, setStep] = useState<'start' | 'opened' | 'back'>('start')
        const handled = useRef(false)

        useEffect(() => {
          if (handled.current) return
          if (step === 'opened') {
            handled.current = true
            open()
          } else if (step === 'back') {
            handled.current = true
            navigate(-1)
          }
        }, [step, open, navigate])

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
          <Harness />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')

      act(() => { screen.getByText('open').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('open')

      act(() => { screen.getByText('back').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
    })

    it('setActiveTab replaces so navigate(-1) does not step through old tab', () => {
      function Harness() {
        const { isOpen, activeTab, open, setActiveTab } = useSettingsDialog()
        const navigate = useNavigate()
        const [step, setStep] = useState<'start' | 'opened' | 'switched' | 'back'>('start')
        const handled = useRef(false)

        useEffect(() => {
          if (handled.current) return
          if (step === 'opened') {
            handled.current = true
            open()
          } else if (step === 'switched') {
            handled.current = true
            setActiveTab('git')
          } else if (step === 'back') {
            handled.current = true
            navigate(-1)
          }
        }, [step, open, setActiveTab, navigate])

        return (
          <div>
            <span data-testid="dialog-state">{isOpen ? 'open' : 'closed'}</span>
            <span data-testid="active-tab">{activeTab}</span>
            <button onClick={() => { handled.current = false; setStep('opened') }}>
              open
            </button>
            <button onClick={() => { handled.current = false; setStep('switched') }}>
              switch
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

      act(() => { screen.getByText('open').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('open')
      expect(screen.getByTestId('active-tab').textContent).toBe('account')

      act(() => { screen.getByText('switch').click() })
      expect(screen.getByTestId('active-tab').textContent).toBe('git')

      act(() => { screen.getByText('back').click() })
      // navigate(-1) goes directly to / (pre-settings page), not through old tab
      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
      expect(screen.getByTestId('active-tab').textContent).toBe('account')
    })
  })
})
