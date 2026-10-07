import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

vi.mock('./useSettings', () => ({
  useSettings: () => ({
    preferences: { keyboardShortcuts: { submit: 'Return' }, directShortcuts: ['submit'] },
  }),
}))

describe('useKeyboardShortcuts', () => {
  it('runs a direct shortcut from a text input', () => {
    const submitPrompt = vi.fn()
    renderHook(() => useKeyboardShortcuts({ submitPrompt }))
    const textarea = document.body.appendChild(document.createElement('textarea'))

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(submitPrompt).toHaveBeenCalledTimes(1)
    textarea.remove()
  })

  it('ignores key events a component already handled', () => {
    const submitPrompt = vi.fn()
    renderHook(() => useKeyboardShortcuts({ submitPrompt }))
    const textarea = document.body.appendChild(document.createElement('textarea'))
    textarea.addEventListener('keydown', (event) => event.preventDefault())

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(submitPrompt).not.toHaveBeenCalled()
    textarea.remove()
  })
})
