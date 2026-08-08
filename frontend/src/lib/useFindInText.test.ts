import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFindInText } from './useFindInText'

describe('useFindInText', () => {
  const sampleText = 'Hello World\nhello again\nGoodbye'

  it('returns empty matches for empty query', () => {
    const { result } = renderHook(() => useFindInText(sampleText))
    expect(result.current.matches).toEqual([])
    expect(result.current.hasMatches).toBe(false)
  })

  it('finds case-insensitive matches', () => {
    const { result } = renderHook(() => useFindInText(sampleText))
    act(() => result.current.setQuery('hello'))
    expect(result.current.matches).toHaveLength(2)
    expect(result.current.hasMatches).toBe(true)
  })

  it('navigates next and prev with wrapping', () => {
    const { result } = renderHook(() => useFindInText(sampleText))
    act(() => result.current.setQuery('hello'))
    expect(result.current.currentMatchIndex).toBe(0)
    act(() => result.current.next())
    expect(result.current.currentMatchIndex).toBe(1)
    act(() => result.current.next())
    expect(result.current.currentMatchIndex).toBe(0)
    act(() => result.current.prev())
    expect(result.current.currentMatchIndex).toBe(1)
  })

  it('resets currentMatchIndex when query changes', () => {
    const { result } = renderHook(() => useFindInText(sampleText))
    act(() => result.current.setQuery('hello'))
    act(() => result.current.next())
    expect(result.current.currentMatchIndex).toBe(1)
    act(() => result.current.setQuery('world'))
    expect(result.current.currentMatchIndex).toBe(0)
  })

  it('returns correct start/end indices', () => {
    const { result } = renderHook(() => useFindInText(sampleText))
    act(() => result.current.setQuery('World'))
    expect(result.current.matches[0].startIndex).toBe(6)
    expect(result.current.matches[0].endIndex).toBe(11)
  })

  it('clear resets everything', () => {
    const { result } = renderHook(() => useFindInText(sampleText))
    act(() => result.current.setQuery('hello'))
    expect(result.current.hasMatches).toBe(true)
    act(() => result.current.clear())
    expect(result.current.query).toBe('')
    expect(result.current.matches).toEqual([])
    expect(result.current.hasMatches).toBe(false)
  })
})
