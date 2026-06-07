import { useEffect, useRef, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useWorktreeTab } from './useWorktreeTab'
import { renderHookWithRouter } from '@/test/test-utils'

describe('useWorktreeTab', () => {
  it('defaults activeTab to repo when no repoTab param', () => {
    const { result } = renderHookWithRouter(() => useWorktreeTab())
    expect(result.current.activeTab).toBe('repo')
  })

  it('reads workspaces from repoTab param', () => {
    const { result } = renderHookWithRouter(() => useWorktreeTab(), ['/?repoTab=workspaces'])
    expect(result.current.activeTab).toBe('workspaces')
  })

  it('defaults to repo for unrecognized repoTab values', () => {
    const { result } = renderHookWithRouter(() => useWorktreeTab(), ['/?repoTab=invalid'])
    expect(result.current.activeTab).toBe('repo')
  })

  it('setActiveTab(workspaces) sets repoTab=workspaces', () => {
    const { result } = renderHookWithRouter(() => useWorktreeTab())
    act(() => { result.current.setActiveTab('workspaces') })
    expect(result.current.activeTab).toBe('workspaces')
  })

  it('setActiveTab(repo) removes repoTab param', () => {
    const { result } = renderHookWithRouter(() => useWorktreeTab(), ['/?repoTab=workspaces'])
    expect(result.current.activeTab).toBe('workspaces')
    act(() => { result.current.setActiveTab('repo') })
    expect(result.current.activeTab).toBe('repo')
  })

  it('setActiveTab uses replace so navigate(-1) does not step through tab changes', () => {
    function Harness() {
      const { activeTab, setActiveTab } = useWorktreeTab()
      const navigate = useNavigate()
      const [step, setStep] = useState<'start' | 'switched' | 'back'>('start')
      const handled = useRef(false)

      useEffect(() => {
        if (handled.current) return
        if (step === 'switched') {
          handled.current = true
          setActiveTab('workspaces')
        } else if (step === 'back') {
          handled.current = true
          navigate(-1)
        }
      }, [step, setActiveTab, navigate])

      return (
        <div>
          <span data-testid="activeTab">{activeTab}</span>
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
      <MemoryRouter initialEntries={['/other', '/']}>
        <Harness />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('activeTab').textContent).toBe('repo')

    act(() => { screen.getByText('switch').click() })
    expect(screen.getByTestId('activeTab').textContent).toBe('workspaces')

    act(() => { screen.getByText('back').click() })
    expect(screen.getByTestId('activeTab').textContent).toBe('repo')
  })

  describe('stable identity', () => {
    it('setActiveTab is stable across rerenders', () => {
      const { result, rerender } = renderHookWithRouter(() => useWorktreeTab())
      const firstSetActiveTab = result.current.setActiveTab
      rerender()
      expect(result.current.setActiveTab).toBe(firstSetActiveTab)
    })

    it('setActiveTab is stable across search changes', () => {
      const { result, rerender } = renderHookWithRouter(() => useWorktreeTab(), ['/?a=1'])
      const firstSetActiveTab = result.current.setActiveTab
      act(() => { result.current.setActiveTab('workspaces') })
      rerender()
      expect(result.current.setActiveTab).toBe(firstSetActiveTab)
    })
  })
})
