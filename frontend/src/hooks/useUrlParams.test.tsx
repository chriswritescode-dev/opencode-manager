import { useEffect, useRef, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useUrlParams } from './useUrlParams'
import { renderHookWithRouterAndLocation } from '@/test/test-utils'

describe('useUrlParams', () => {
  it('exports the expected API surface', () => {
    expect(typeof useUrlParams).toBe('function')
    const { result } = renderHookWithRouterAndLocation(() => useUrlParams())
    expect(typeof result.current.search).toBe('string')
    expect(typeof result.current.searchParams).toBe('object')
    expect(result.current.searchParams instanceof URLSearchParams).toBe(true)
    expect(typeof result.current.updateParams).toBe('function')
  })

  it('returns initial search string and searchParams from location', () => {
    const { result } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?foo=1&bar=2'])
    expect(result.current.search).toBe('?foo=1&bar=2')
    expect(result.current.searchParams.get('foo')).toBe('1')
    expect(result.current.searchParams.get('bar')).toBe('2')
  })

  it('returns empty search when no params', () => {
    const { result } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/'])
    expect(result.current.search).toBe('')
  })

  describe('updateParams', () => {
    it('sets a param and preserves unrelated params', () => {
      const { result, capturedSearch } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?keep=1'])
      act(() => {
        result.current.updateParams((p) => p.set('dialog', 'mcp'))
      })
      expect(result.current.search).toContain('dialog=mcp')
      expect(result.current.search).toContain('keep=1')
      expect(capturedSearch.current).toContain('dialog=mcp')
      expect(capturedSearch.current).toContain('keep=1')
    })

    it('deletes a param without affecting others', () => {
      const { result, capturedSearch } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?foo=1&bar=2'])
      act(() => {
        result.current.updateParams((p) => p.delete('foo'))
      })
      expect(result.current.search).not.toContain('foo')
      expect(result.current.search).toContain('bar=2')
      expect(capturedSearch.current).not.toContain('foo')
      expect(capturedSearch.current).toContain('bar=2')
    })

    it('sets and deletes multiple params atomically', () => {
      const { result, capturedSearch } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?a=1&b=2&c=3'])
      act(() => {
        result.current.updateParams((p) => {
          p.set('x', '10')
          p.delete('a')
          p.set('b', 'updated')
        })
      })
      expect(result.current.search).toContain('x=10')
      expect(result.current.search).toContain('b=updated')
      expect(result.current.search).toContain('c=3')
      expect(result.current.search).not.toContain('a=')
      expect(capturedSearch.current).toContain('x=10')
      expect(capturedSearch.current).toContain('b=updated')
      expect(capturedSearch.current).toContain('c=3')
      expect(capturedSearch.current).not.toContain('a=')
    })

    it('preserves all params when updater makes no changes', () => {
      const { result, capturedSearch } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?foo=1&bar=2'])
      act(() => {
        result.current.updateParams((_p) => {})
      })
      expect(result.current.search).toContain('foo=1')
      expect(result.current.search).toContain('bar=2')
      expect(capturedSearch.current).toContain('foo=1')
      expect(capturedSearch.current).toContain('bar=2')
    })

    it('handles special characters in param values', () => {
      const { result } = renderHookWithRouterAndLocation(() => useUrlParams())
      act(() => {
        result.current.updateParams((p) => p.set('q', 'hello world & more'))
      })
      expect(result.current.search).toContain('q=hello+world+%26+more')
    })
  })

  describe('mode: replace (default)', () => {
    it('defaults to replace mode when no mode arg passed', () => {
      const { result, capturedSearch } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?initial=1'])
      act(() => {
        result.current.updateParams((p) => p.set('added', 'yes'))
      })
      expect(capturedSearch.current).toContain('initial=1')
      expect(capturedSearch.current).toContain('added=yes')
    })

    it('explicit replace does not push a new history entry', () => {
      const { result } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?x=1'])
      act(() => {
        result.current.updateParams((p) => p.set('x', '2'), 'replace')
      })
      expect(result.current.search).toContain('x=2')
    })
  })

  describe('mode: push', () => {
    it('push adds a new history entry that navigate(-1) reverses', () => {
      function PushHarness() {
        const { search, updateParams } = useUrlParams()
        const navigate = useNavigate()
        const [step, setStep] = useState<'start' | 'pushed' | 'back'>('start')
        const handled = useRef(false)

        useEffect(() => {
          if (handled.current) return
          if (step === 'pushed') {
            handled.current = true
            updateParams((p) => p.set('dialog', 'open'), 'push')
          } else if (step === 'back') {
            handled.current = true
            navigate(-1)
          }
        }, [step, updateParams, navigate])

        return (
          <div>
            <span data-testid="search">{search}</span>
            <button onClick={() => { handled.current = false; setStep('pushed') }}>
              push
            </button>
            <button onClick={() => { handled.current = false; setStep('back') }}>
              back
            </button>
          </div>
        )
      }

      render(
        <MemoryRouter initialEntries={['/']}>
          <PushHarness />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('search').textContent).toBe('')

      act(() => {
        screen.getByText('push').click()
      })
      expect(screen.getByTestId('search').textContent).toContain('dialog=open')

      act(() => {
        screen.getByText('back').click()
      })
      expect(screen.getByTestId('search').textContent).not.toContain('dialog=open')
    })
  })

  describe('stable identity', () => {
    it('updateParams reference is stable across location.search changes', () => {
      const { result, rerender } = renderHookWithRouterAndLocation(() => useUrlParams(), ['/?a=1'])
      const firstUpdateParams = result.current.updateParams

      act(() => {
        result.current.updateParams((p) => p.set('b', '2'))
      })

      rerender()

      expect(result.current.updateParams).toBe(firstUpdateParams)
    })

    it('updateParams reference is stable across multiple updates', () => {
      const { result } = renderHookWithRouterAndLocation(() => useUrlParams())
      const firstUpdateParams = result.current.updateParams

      act(() => {
        result.current.updateParams((p) => p.set('a', '1'))
      })

      act(() => {
        result.current.updateParams((p) => p.set('b', '2'))
      })

      expect(result.current.updateParams).toBe(firstUpdateParams)
    })

    it('updateParams reference remains stable when no navigation occurs', () => {
      const { result, rerender } = renderHookWithRouterAndLocation(() => useUrlParams())
      const firstUpdateParams = result.current.updateParams

      rerender()

      expect(result.current.updateParams).toBe(firstUpdateParams)
    })
  })


})
