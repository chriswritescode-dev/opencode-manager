import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  DEFAULT_VOICE_PAUSE_MS,
  VOICE_PAUSE_STORAGE_KEY,
} from '@opencode-manager/shared/opencode'
import { useVoicePauseSetting } from './useVoicePauseSetting'

function readStoredPause(): string | null {
  return window.localStorage.getItem(VOICE_PAUSE_STORAGE_KEY)
}

function dispatchStorageEvent(key: string): void {
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

describe('useVoicePauseSetting', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('falls back to the default pause when storage holds nothing', () => {
    const { result } = renderHook(() => useVoicePauseSetting())

    expect(result.current.pauseMs).toBe(DEFAULT_VOICE_PAUSE_MS)
  })

  it('reads a valid stored pause', () => {
    window.localStorage.setItem(VOICE_PAUSE_STORAGE_KEY, '2000')

    const { result } = renderHook(() => useVoicePauseSetting())

    expect(result.current.pauseMs).toBe(2000)
  })

  it('falls back to the default pause when the stored value is not an option', () => {
    window.localStorage.setItem(VOICE_PAUSE_STORAGE_KEY, '1234')

    const { result } = renderHook(() => useVoicePauseSetting())

    expect(result.current.pauseMs).toBe(DEFAULT_VOICE_PAUSE_MS)
  })

  it('persists a selected pause and ignores values outside the options', () => {
    const { result } = renderHook(() => useVoicePauseSetting())

    act(() => {
      result.current.setPauseMs(3000)
    })

    expect(result.current.pauseMs).toBe(3000)
    expect(readStoredPause()).toBe('3000')

    act(() => {
      result.current.setPauseMs(1234)
    })

    expect(result.current.pauseMs).toBe(3000)
    expect(readStoredPause()).toBe('3000')
  })

  it('propagates changes to every consumer mounted in the same tab', () => {
    const first = renderHook(() => useVoicePauseSetting())
    const second = renderHook(() => useVoicePauseSetting())

    act(() => {
      first.result.current.setPauseMs(1600)
    })

    expect(first.result.current.pauseMs).toBe(1600)
    expect(second.result.current.pauseMs).toBe(1600)
  })

  it('follows changes written by another tab', () => {
    const { result } = renderHook(() => useVoicePauseSetting())

    act(() => {
      window.localStorage.setItem(VOICE_PAUSE_STORAGE_KEY, '800')
      dispatchStorageEvent(VOICE_PAUSE_STORAGE_KEY)
    })

    expect(result.current.pauseMs).toBe(800)
  })

  it('ignores storage events for unrelated keys', () => {
    window.localStorage.setItem(VOICE_PAUSE_STORAGE_KEY, '800')
    const { result } = renderHook(() => useVoicePauseSetting())

    window.localStorage.setItem(VOICE_PAUSE_STORAGE_KEY, '3000')
    act(() => {
      dispatchStorageEvent('some-other-key')
    })

    expect(result.current.pauseMs).toBe(800)
  })
})
