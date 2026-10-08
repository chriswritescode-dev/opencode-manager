import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSessionSearch } from './useSessionSearch'

const { sessionsData, lastArgsRef, flagsRef } = vi.hoisted(() => ({
  sessionsData: [] as Array<{ id: string; title: string; location: { directory: string }; parentID?: string; time: { updated: number } }>,
  lastArgsRef: { current: undefined as { directories: string[]; options?: { search?: string; limit?: number; keepPreviousResults?: boolean } } | undefined },
  flagsRef: { current: { hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false, isPlaceholderData: false } },
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (directories: string[], options?: { search?: string; limit?: number; keepPreviousResults?: boolean }) => {
      lastArgsRef.current = { directories, options }
      const search = options?.search?.toLowerCase() ?? ''
      const data = search
        ? sessionsData.filter((session) => session.title.toLowerCase().includes(search))
        : sessionsData
      return {
        data,
        isLoading: false,
        isPlaceholderData: flagsRef.current.isPlaceholderData,
        fetchNextPage: vi.fn(),
        hasNextPage: flagsRef.current.hasNextPage,
        isFetchingNextPage: flagsRef.current.isFetchingNextPage,
        isFetchNextPageError: flagsRef.current.isFetchNextPageError,
      }
    },
  }
})

describe('useSessionSearch', () => {
  beforeEach(() => {
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_alpha', title: 'alpha task', location: { directory: '/w/a' }, time: { updated: 2 } },
      { id: 'ses_beta', title: 'beta task', location: { directory: '/w/a' }, time: { updated: 1 } },
    )
    lastArgsRef.current = undefined
    flagsRef.current = { hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false, isPlaceholderData: false }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters sessions locally by title immediately', () => {
    const { result } = renderHook(() => useSessionSearch(['/w/a']))

    act(() => {
      result.current.setQuery('alpha')
    })

    expect(result.current.filteredSessions.map((session) => session.title)).toEqual(['alpha task'])
    expect(lastArgsRef.current?.options?.search).toBe('')
  })

  it('passes the debounced search to useSessionsAcrossDirectories with keepPreviousResults', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSessionSearch(['/w/a']))

    act(() => {
      result.current.setQuery('deploy')
    })
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(lastArgsRef.current?.options?.search).toBe('deploy')
    expect(lastArgsRef.current?.options?.limit).toBe(25)
    expect(lastArgsRef.current?.options?.keepPreviousResults).toBe(true)
  })

  it('reports a pending search before the debounce settles', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSessionSearch(['/w/a']))

    act(() => {
      result.current.setQuery('deploy')
    })

    expect(result.current.isSearchPending).toBe(true)

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(result.current.isSearchPending).toBe(false)
  })

  it('exposes canFetchNextPage only when paging is safe', () => {
    const { result, rerender } = renderHook(() => useSessionSearch(['/w/a']))
    expect(result.current.canFetchNextPage).toBe(false)

    flagsRef.current = { hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError: false, isPlaceholderData: false }
    rerender()
    expect(result.current.canFetchNextPage).toBe(true)

    flagsRef.current = { hasNextPage: true, isFetchingNextPage: true, isFetchNextPageError: false, isPlaceholderData: false }
    rerender()
    expect(result.current.canFetchNextPage).toBe(false)

    flagsRef.current = { hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError: true, isPlaceholderData: false }
    rerender()
    expect(result.current.canFetchNextPage).toBe(false)

    flagsRef.current = { hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError: false, isPlaceholderData: true }
    rerender()
    expect(result.current.canFetchNextPage).toBe(false)
  })
})
