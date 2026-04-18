import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useMobileTabBar, type MobileSheetKey } from './useMobileTabBar'

function renderHookWithRouter<T>(renderFn: () => T) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={['/']}>
      {children}
    </MemoryRouter>
  )
  return renderHook(renderFn, { wrapper })
}

describe('useMobileTabBar', () => {
  it('returns null for openSheet when no mobileTab param is present', () => {
    const { result } = renderHookWithRouter(() => useMobileTabBar())
    expect(result.current.openSheet).toBeNull()
  })

  it('returns the correct openSheet when mobileTab param is set', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=repos']}>
          {children}
        </MemoryRouter>
      ),
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
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=notifications']}>
          {children}
        </MemoryRouter>
      ),
    })
    expect(result.current.openSheet).toBe('notifications')
    act(() => {
      result.current.close()
    })
    expect(result.current.openSheet).toBeNull()
  })

  it('resolves invalid values to null', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=invalid']}>
          {children}
        </MemoryRouter>
      ),
    })
    expect(result.current.openSheet).toBeNull()
  })

  it('handles all valid MobileSheetKey values', () => {
    const validKeys: MobileSheetKey[] = ['repos', 'files', 'notifications', 'more']
    validKeys.forEach((key) => {
      const { result } = renderHook(() => useMobileTabBar(), {
        wrapper: ({ children }) => (
          <MemoryRouter initialEntries={[`/?mobileTab=${key}`]}>
            {children}
          </MemoryRouter>
        ),
      })
      expect(result.current.openSheet).toBe(key)
    })
  })
})
