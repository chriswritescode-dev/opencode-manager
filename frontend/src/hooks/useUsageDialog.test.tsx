import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useUsageDialog } from './useUsageDialog'
import { renderHookWithRouter, renderHookWithRouterAndLocation } from '@/test/test-utils'

describe('useUsageDialog', () => {
  it('is closed when no params are present', () => {
    const { result } = renderHookWithRouter(() => useUsageDialog())
    expect(result.current.isOpen).toBe(false)
  })

  it('is open when the URL has usage=open', () => {
    const { result } = renderHookWithRouter(() => useUsageDialog(), ['/?usage=open'])
    expect(result.current.isOpen).toBe(true)
  })

  it('open sets usage=open and drops mobileTab while keeping other params', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useUsageDialog(),
      ['/?mobileTab=more&keep=1'],
    )
    expect(result.current.isOpen).toBe(false)

    act(() => { result.current.open() })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('usage')).toBe('open')
    expect(params.has('mobileTab')).toBe(false)
    expect(params.get('keep')).toBe('1')
    expect(result.current.isOpen).toBe(true)
  })

  it('open with replace history also sets usage=open and drops mobileTab', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useUsageDialog(),
      ['/?mobileTab=more&keep=1'],
    )

    act(() => { result.current.open('replace') })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('usage')).toBe('open')
    expect(params.has('mobileTab')).toBe(false)
    expect(params.get('keep')).toBe('1')
    expect(result.current.isOpen).toBe(true)
  })

  it('close removes usage and keeps other params for a direct entry', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useUsageDialog(),
      ['/?usage=open&keep=1'],
    )
    expect(result.current.isOpen).toBe(true)

    act(() => { result.current.close() })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.has('usage')).toBe(false)
    expect(params.get('keep')).toBe('1')
    expect(result.current.isOpen).toBe(false)
  })

  it('open then close returns to the original search', () => {
    const { result, capturedSearch, rerender } = renderHookWithRouterAndLocation(
      () => useUsageDialog(),
      ['/?keep=1'],
    )
    expect(result.current.isOpen).toBe(false)

    act(() => { result.current.open() })
    rerender()
    expect(result.current.isOpen).toBe(true)

    act(() => { result.current.close() })
    rerender()

    expect(result.current.isOpen).toBe(false)
    expect(new URLSearchParams(capturedSearch.current).toString()).toBe('keep=1')
  })

  describe('history entries', () => {
    function UsageHarness() {
      const { isOpen, open } = useUsageDialog()
      const location = useLocation()
      const navigate = useNavigate()

      return (
        <div>
          <span data-testid="dialog-state">{isOpen ? 'open' : 'closed'}</span>
          <span data-testid="pathname">{location.pathname}</span>
          <span data-testid="search">{location.search}</span>
          <button onClick={() => { open() }}>open</button>
          <button onClick={() => navigate(-1)}>back</button>
        </div>
      )
    }

    it('browser back after open closes the dialog and restores the URL', () => {
      render(
        <MemoryRouter initialEntries={['/?keep=1']}>
          <UsageHarness />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')

      act(() => { screen.getByText('open').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('open')
      expect(new URLSearchParams(screen.getByTestId('search').textContent ?? '').get('usage')).toBe('open')

      act(() => { screen.getByText('back').click() })
      expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
      expect(screen.getByTestId('pathname').textContent).toBe('/')
      expect(screen.getByTestId('search').textContent).toBe('?keep=1')
    })
  })
})
