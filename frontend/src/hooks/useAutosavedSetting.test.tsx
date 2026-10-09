import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutosavedSetting } from './useAutosavedSetting'

function renderTrimmedSetting(stored: string | undefined, save: (next: string, previous: string | undefined) => void) {
  return renderHook(
    ({ value }: { value: string | undefined }) =>
      useAutosavedSetting<string | undefined, string, string>({
        stored: value,
        toDraft: (draftStored) => draftStored ?? '',
        toCommitted: (draft) => draft.trim(),
        isEqual: (a, b) => a === b,
        save,
      }),
    { initialProps: { value: stored } },
  )
}

describe('useAutosavedSetting', () => {
  it('saves the normalized value once after the debounce', () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn()
      const { result } = renderTrimmedSetting(undefined, save)

      act(() => result.current.setDraft('  anthropic/claude  '))
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith('anthropic/claude', '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips an unchanged value and resyncs from the stored value', () => {
    const save = vi.fn()
    const { result, rerender } = renderTrimmedSetting('a', save)

    act(() => result.current.commit())
    expect(save).not.toHaveBeenCalled()

    act(() => result.current.setDraft('b'))
    act(() => result.current.commit())
    expect(save).toHaveBeenCalledWith('b', 'a')

    rerender({ value: 'c' })
    expect(result.current.draft).toBe('c')

    act(() => result.current.commit())
    expect(save).toHaveBeenCalledTimes(1)
  })
})
